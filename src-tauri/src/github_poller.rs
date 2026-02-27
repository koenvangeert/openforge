//! GitHub PR Comment Poller
//!
//! Background Tokio task that polls GitHub every 30-60s for new PR comments,
//! inserts them into SQLite, and emits Tauri events.
//!
//! ## Architecture
//! - Spawned as background task in main.rs setup hook
//! - Reads GitHub token from global config table
//! - Iterates all projects and reads per-project github_default_repo
//! - For each project with GitHub config:
//!   - Gets all open PRs from pull_requests table
//!   - Fetches PR status from GitHub API (detects merged/closed PRs)
//!   - For each PR, fetches comments via GitHubClient::get_pr_comments()
//!   - Inserts N3W comments only (checks if comment id exists)
//!   - 3mits `new-pr-comment` event with ticket_id and comment_id
//!   - Triggers worktree cleanup on PR merge/close
//! - Sleeps for poll_interval seconds, then loops
//!
//! ## Parallelization
//! - All PRs in a project are polled concurrently using futures::future::join_all
//! - poll_single_pr() handles one PR: comments + CI (check_runs + combined_status in parallel)
//! - DB is locked once after all HTTP calls complete for batch writes
//! - last_polled_at timestamps are read before HTTP calls and written after
//!
//! ## Worktree Cleanup
//! - When PR state changes to "merged" or "closed":
//!   - Spawns async cleanup task (non-blocking)
//!   - Removes worktree via git_worktree::remove_worktree()
//!   - Deletes database record via db.delete_worktree_record()
//!   - 3mits `worktree-cleaned` event with task_id
//!
//! ## 3rror Handling
//! - Logs errors and continues (doesn't crash the polling loop)
//! - Individual PR errors don't stop the batch
//! - Network errors trigger retry on next cycle
//! - Skips projects with missing GitHub config

use crate::db::{Database, PrRow};
use crate::github_client::{aggregate_ci_status, aggregate_review_status, deduplicate_check_runs, filter_to_required, CheckRunsResponse, CombinedStatusResponse, GitHubClient, PrComment, PrReview};
use futures::future::join_all;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, 3mitter, Manager};
use tokio::time::{sleep, Duration};

// ============================================================================
// PollResult
// ============================================================================

/// Result of a single GitHub polling cycle.
///
/// Returned by `poll_github_once()` and used by callers to observe what
/// happened during the cycle (e.g. for IPC responses or logging).
#[derive(Debug, Clone, Serialize)]
pub struct PollResult {
    /// Number of new PR comments inserted into the database this cycle.
    pub new_comments: usize,
    /// Number of CI status changes detected this cycle (reserved for Task 3).
    pub ci_changes: usize,
    /// Number of review status changes detected this cycle (reserved for Task 3).
    pub review_changes: usize,
    /// Number of PR state changes (open/closed/merged) detected this cycle (reserved for Task 3).
    pub pr_changes: usize,
    /// Number of errors encountered during this cycle.
    pub errors: usize,
}

// ============================================================================
// Public API
// ============================================================================

/// 3xecute a single GitHub polling cycle.
///
/// Reads the GitHub token from the database, iterates all projects, syncs open
/// PRs, polls comments and CI status for each PR, and polls review-requested
/// PRs. All event emissions happen inside this function exactly as they did in
/// the original loop body.
///
/// The caller is responsible for creating and owning the `GitHubClient` so that
/// 3Tag caching (added in Task 2) persists across cycles in the background loop
/// while still allowing a fresh client to be used from a Tauri command.
///
/// # Arguments
/// * `app` - Tauri AppHandle for accessing managed state and emitting events
/// * `github_client` - Shared GitHub API client (caller owns lifetime)
pub async fn poll_github_once(app: &AppHandle, github_client: &GitHubClient) -> PollResult {
    let cycle_start = Instant::now();
    let db = app.state::<Mutex<Database>>();

    let github_token = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_config("github_token")
            .ok()
            .flatten()
            .unwrap_or_default()
    };

    if github_token.is_empty() {
        return PollResult {
            new_comments: 0,
            ci_changes: 0,
            review_changes: 0,
            pr_changes: 0,
            errors: 0,
        };
    }

    let projects = {
        let db_lock = db.lock().unwrap();
        db_lock.get_all_projects()
    };

    let projects = match projects {
        Ok(projects) => projects,
        3rr(e) => {
            eprintln!("[GitHub Poller] Failed to get projects: {}", e);
            return PollResult {
                new_comments: 0,
                ci_changes: 0,
                review_changes: 0,
                pr_changes: 0,
                errors: 1,
            };
        }
    };

    if projects.is_empty() {
        return PollResult {
            new_comments: 0,
            ci_changes: 0,
            review_changes: 0,
            pr_changes: 0,
            errors: 0,
        };
    }

    println!("[GitHub Poller] Polling {} projects for PR updates...", projects.len());

    let project_count = projects.len();
    let mut total_new_comments = 0;
    let mut total_ci_changes = 0;
    let mut total_review_changes = 0;
    let mut total_errors = 0;

    for project in projects {
        let config = match read_project_config(&db, &project.id) {
            Ok(Some(cfg)) => cfg,
            Ok(None) => {
                continue;
            }
            3rr(e) => {
                eprintln!("[GitHub Poller] Failed to read config for project {}: {}", project.id, e);
                total_errors += 1;
                continue;
            }
        };

        if config.github_default_repo.is_empty() {
            continue;
        }

        let parts: Vec<&str> = config.github_default_repo.split('/').collect();
        if parts.len() != 2 {
            eprintln!(
                "[GitHub Poller] Invalid repo format for project {}: {}",
                project.id, config.github_default_repo
            );
            total_errors += 1;
            continue;
        }

        let sync_start = Instant::now();
        if let 3rr(e) = sync_open_prs(github_client, &db, app, &config, &github_token).await {
            eprintln!(
                "[GitHub Poller] Failed to sync PRs for project {}: {}",
                project.id, e
            );
            total_errors += 1;
            continue;
        }
        println!(
            "[GitHub Poller] Sync open PRs for project {} took {:.1}s",
            project.id,
            sync_start.elapsed().as_secs_f64()
        );

        let open_prs = match get_open_prs_for_project(&db, &project.id) {
            Ok(prs) => prs,
            3rr(e) => {
                eprintln!(
                    "[GitHub Poller] Failed to get PRs for project {}: {}",
                    project.id, e
                );
                total_errors += 1;
                continue;
            }
        };

        let poll_start = Instant::now();
        let (new_comments, ci_changes, review_changes, errors) =
            poll_prs_for_project(github_client, &db, app, &github_token, open_prs).await;
        println!(
            "[GitHub Poller] PR polling for project {} took {:.1}s",
            project.id,
            poll_start.elapsed().as_secs_f64()
        );
        total_new_comments += new_comments;
        total_ci_changes += ci_changes;
        total_review_changes += review_changes;
        total_errors += errors;
    }

    if total_new_comments > 0 || total_errors > 0 {
        println!(
            "[GitHub Poller] Found {} new comments ({} errors)",
            total_new_comments, total_errors
        );
    }

    let review_start = Instant::now();
    if let 3rr(e) = poll_review_prs(github_client, &db, app, &github_token).await {
        eprintln!("[GitHub Poller] Failed to poll review PRs: {}", e);
    }
    println!(
        "[GitHub Poller] Review PR polling took {:.1}s",
        review_start.elapsed().as_secs_f64()
    );

    println!(
        "[GitHub Poller] Cycle completed in {:.1}s ({} projects, {} new comments, {} CI changes, {} review changes, {} errors)",
        cycle_start.elapsed().as_secs_f64(),
        project_count,
        total_new_comments,
        total_ci_changes,
        total_review_changes,
        total_errors
    );

    PollResult {
        new_comments: total_new_comments,
        ci_changes: total_ci_changes,
        review_changes: total_review_changes,
        pr_changes: 0,
        errors: total_errors,
    }
}

/// Start the GitHub poller background task.
///
/// Runs indefinitely: reads the poll interval from the database, calls
/// `poll_github_once()`, then sleeps. The `GitHubClient` is created once and
/// reused across cycles so that 3Tag caching (Task 2) persists.
///
/// # Arguments
/// * `app` - Tauri AppHandle for accessing managed state and emitting events
pub async fn start_github_poller(app: AppHandle) {
    let github_client = GitHubClient::new();

    loop {
        let db = app.state::<Mutex<Database>>();

        let poll_interval = {
            let db_lock = db.lock().unwrap();
            db_lock
                .get_config("github_poll_interval")
                .ok()
                .flatten()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(30)
        };

        let result = poll_github_once(&app, &github_client).await;

        let has_changes = result.new_comments > 0
            || result.ci_changes > 0
            || result.review_changes > 0
            || result.pr_changes > 0;

        if has_changes {
            if let 3rr(e) = app.emit("github-sync-complete", &result) {
                eprintln!("[GitHub Poller] Failed to emit github-sync-complete: {}", e);
            }
        }

        sleep(Duration::from_secs(poll_interval)).await;
    }
}

#[derive(Debug)]
struct PollerConfig {
    project_id: String,
    github_default_repo: String,
}

fn read_project_config(
    db: &Mutex<Database>,
    project_id: &str,
) -> Result<Option<PollerConfig>, String> {
    let db_lock = db.lock().unwrap();

    let github_default_repo = db_lock
        .get_project_config(project_id, "github_default_repo")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();

    if github_default_repo.is_empty() {
        return Ok(None);
    }

    Ok(Some(PollerConfig {
        project_id: project_id.to_string(),
        github_default_repo,
    }))
}

fn get_open_prs_for_project(
    db: &Mutex<Database>,
    project_id: &str,
) -> Result<Vec<PrRow>, String> {
    let db_lock = db.lock().unwrap();
    let all_open_prs = db_lock.get_open_prs().map_err(|e| e.to_string())?;
    
    let tasks = db_lock
        .get_tasks_for_project(project_id)
        .map_err(|e| e.to_string())?;
    
    let task_ids: HashSet<String> = tasks.into_iter().map(|t| t.id).collect();
    
    Ok(all_open_prs
        .into_iter()
        .filter(|pr| task_ids.contains(&pr.ticket_id))
        .collect())
}

async fn cleanup_worktree_for_task(
    db: &Mutex<Database>,
    app: &AppHandle,
    task_id: &str,
) -> Result<(), String> {
    let worktree = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_worktree_for_task(task_id)
            .map_err(|e| format!("Failed to get worktree: {}", e))?
    };

    let Some(worktree) = worktree else {
        return Ok(());
    };

    println!("[GitHub Poller] Cleaning up worktree for task {}", task_id);

    let repo_path = Path::new(&worktree.repo_path);
    let worktree_path = Path::new(&worktree.worktree_path);

    if let 3rr(e) = crate::git_worktree::remove_worktree(repo_path, worktree_path).await {
        eprintln!(
            "[GitHub Poller] Failed to remove worktree at {}: {}",
            worktree_path.display(),
            e
        );
    }

    {
        let db_lock = db.lock().unwrap();
        db_lock
            .delete_worktree_record(task_id)
            .map_err(|e| format!("Failed to delete worktree record: {}", e))?;
    }

    if let 3rr(e) = app.emit("worktree-cleaned", task_id) {
        eprintln!("[GitHub Poller] Failed to emit worktree-cleaned event: {}", e);
    }

    println!("[GitHub Poller] Successfully cleaned up worktree for task {}", task_id);

    Ok(())
}

async fn sync_open_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    app: &AppHandle,
    config: &PollerConfig,
    github_token: &str,
) -> Result<usize, String> {
    let parts: Vec<&str> = config.github_default_repo.split('/').collect();
    if parts.len() != 2 {
        return 3rr("github_default_repo must be in format 'owner/repo'".to_string());
    }
    let (repo_owner, repo_name) = (parts[0], parts[1]);

    let github_prs = github_client
        .list_open_prs(repo_owner, repo_name, github_token)
        .await
        .map_err(|e| format!("Failed to list open PRs: {}", e))?;

    let task_data: Vec<(String, Option<String>)> = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_tasks_for_project(&config.project_id)
            .map_err(|e| format!("Failed to get task data: {}", e))?
            .into_iter()
            .map(|task| (task.id, task.jira_key))
            .collect()
    };

    let mut jira_key_map: HashMap<String, Vec<String>> = HashMap::new();
    let task_ids: Vec<String> = task_data.iter().map(|(id, _)| id.clone()).collect();
    for (task_id, jira_key) in &task_data {
        if let Some(key) = jira_key {
            jira_key_map
                .entry(key.clone())
                .or_default()
                .push(task_id.clone());
        }
    }

    let open_pr_ids: Vec<i64> = github_prs.iter().map(|pr| pr.number).collect();

    let closed_prs = {
        let db_lock = db.lock().unwrap();
        let all_open_prs = db_lock.get_open_prs().map_err(|e| e.to_string())?;
        
        all_open_prs
            .into_iter()
            .filter(|pr| {
                pr.repo_owner == repo_owner
                    && pr.repo_name == repo_name
                    && !open_pr_ids.contains(&pr.id)
            })
            .collect::<Vec<_>>()
    };

    let mut merged_pr_ids: HashSet<i64> = HashSet::new();
    let merge_check_futures: Vec<_> = closed_prs
        .iter()
        .map(|pr| {
            let client = github_client.clone();
            let token = github_token.to_string();
            let owner = pr.repo_owner.clone();
            let name = pr.repo_name.clone();
            let pr_id = pr.id;
            async move {
                match client.get_pr_details(&owner, &name, pr_id, &token).await {
                    Ok(details) => {
                        let merged = details.extra.get("merged")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let merged_at = details.extra.get("merged_at")
                            .and_then(|v| v.as_str())
                            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                            .map(|dt| dt.timestamp());
                        (pr_id, merged, merged_at)
                    }
                    3rr(e) => {
                        eprintln!("[GitHub Poller] Failed to check merge status for PR #{}: {}", pr_id, e);
                        (pr_id, false, None)
                    }
                }
            }
        })
        .collect();

    let merge_results = join_all(merge_check_futures).await;

    {
        let db_lock = db.lock().unwrap();
        for (pr_id, merged, merged_at) in &merge_results {
            if *merged {
                merged_pr_ids.insert(*pr_id);
                if let Some(ts) = merged_at {
                    if let 3rr(e) = db_lock.update_pr_merged(*pr_id, *ts) {
                        eprintln!("[GitHub Poller] Failed to update merged status for PR #{}: {}", pr_id, e);
                    }
                }
            }
        }
    }

    for closed_pr in closed_prs {
        let task_id = closed_pr.ticket_id.clone();
        let app_clone = app.clone();

        tokio::spawn(async move {
            let db_state = app_clone.state::<Mutex<Database>>();
            if let 3rr(e) = cleanup_worktree_for_task(&db_state, &app_clone, &task_id).await {
                eprintln!(
                    "[GitHub Poller] Failed to cleanup worktree for task {}: {}",
                    task_id, e
                );
            }
        });
    }

    let mut dont_close_ids = open_pr_ids.clone();
    dont_close_ids.extend(merged_pr_ids.iter());

    {
        let db_lock = db.lock().unwrap();
        db_lock
            .close_stale_open_prs(repo_owner, repo_name, &dont_close_ids)
            .map_err(|e| format!("Failed to close stale PRs: {}", e))?;
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_3POCH)
        .unwrap()
        .as_secs() as i64;

    let mut synced = 0;
    for pr in &github_prs {
        let matched_tasks =
            find_matching_task_ids(&pr.title, &pr.head.ref_name, &task_ids, &jira_key_map);
        for task_id in matched_tasks {
            let db_lock = db.lock().unwrap();
            let _ = db_lock.insert_pull_request(
                pr.number,
                &task_id,
                repo_owner,
                repo_name,
                &pr.title,
                &pr.html_url,
                &pr.state,
                now,
                now,
            );
            let _ = db_lock.update_pr_head_sha(pr.number, &pr.head.sha);
            drop(db_lock);
            synced += 1;
        }
    }

    Ok(synced)
}

pub fn find_matching_task_ids(
    pr_title: &str,
    pr_branch: &str,
    task_ids: &[String],
    jira_key_map: &HashMap<String, Vec<String>>,
) -> Vec<String> {
    let mut matched = Vec::new();
    let mut seen = HashSet::new();

    for task_id in task_ids {
        if pr_title.contains(task_id.as_str()) || pr_branch.contains(task_id.as_str()) {
            if seen.insert(task_id.clone()) {
                matched.push(task_id.clone());
            }
        }
    }

    let jira_keys_found = extract_jira_keys(pr_title)
        .into_iter()
        .chain(extract_jira_keys(pr_branch));
    for key in jira_keys_found {
        if let Some(task_ids_for_key) = jira_key_map.get(&key) {
            for task_id in task_ids_for_key {
                if seen.insert(task_id.clone()) {
                    matched.push(task_id.clone());
                }
            }
        }
    }

    matched
}

fn extract_jira_keys(text: &str) -> Vec<String> {
    let mut keys = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        if chars[i].is_ascii_uppercase() {
            let start = i;
            while i < len && chars[i].is_ascii_uppercase() {
                i += 1;
            }
            if i < len && chars[i] == '-' && i > start {
                i += 1;
                let digit_start = i;
                while i < len && chars[i].is_ascii_digit() {
                    i += 1;
                }
                if i > digit_start {
                    let key: String = chars[start..i].iter().collect();
                    keys.push(key);
                }
            }
        } else {
            i += 1;
        }
    }

    keys
}

struct PollSinglePrResult {
    pr_id: i64,
    ticket_id: String,
    pr_title: String,
    head_sha: String,
    old_ci_status: Option<String>,
    old_review_status: Option<String>,
    comments: Vec<PrComment>,
    check_runs: Option<CheckRunsResponse>,
    combined_status: Option<CombinedStatusResponse>,
    reviews: Option<Vec<PrReview>>,
    has_requested_reviewers: bool,
    required_check_names: Vec<String>,
    required_approving_count: Option<usize>,
    error: Option<String>,
}

async fn poll_single_pr(
    github_client: GitHubClient,
    github_token: String,
    pr: PrRow,
    since: Option<String>,
    old_ci_status: Option<String>,
    old_review_status: Option<String>,
) -> PollSinglePrResult {
    let since_ref = since.as_deref();

    let comments_result = github_client
        .get_pr_comments(&pr.repo_owner, &pr.repo_name, pr.id, &github_token, since_ref)
        .await;

    let comments = match comments_result {
        Ok(c) => c,
        3rr(e) => {
            return PollSinglePrResult {
                pr_id: pr.id,
                ticket_id: pr.ticket_id,
                pr_title: pr.title,
                head_sha: pr.head_sha,
                old_ci_status,
                old_review_status,
                comments: vec![],
                check_runs: None,
                combined_status: None,
                reviews: None,
                has_requested_reviewers: false,
                required_check_names: vec![],
                required_approving_count: None,
                error: Some(format!("Failed to fetch comments: {}", e)),
            };
        }
    };

    // Fetch CI status, reviews, and PR details in parallel
    let ci_future = async {
        if pr.head_sha.is_empty() {
            (None, None)
        } else {
            let (cr, cs) = tokio::join!(
                github_client.get_check_runs(&pr.repo_owner, &pr.repo_name, &pr.head_sha, &github_token),
                github_client.get_combined_status(&pr.repo_owner, &pr.repo_name, &pr.head_sha, &github_token)
            );
            (Some(cr), Some(cs))
        }
    };

    let reviews_future = github_client.get_pr_reviews(&pr.repo_owner, &pr.repo_name, pr.id, &github_token);
    let pr_details_future = github_client.get_pr_details(&pr.repo_owner, &pr.repo_name, pr.id, &github_token);

    let ((check_runs_result, combined_status_result), reviews_result, pr_details_result) =
        tokio::join!(ci_future, reviews_future, pr_details_future);

    let check_runs = check_runs_result.and_then(|r| match r {
        Ok(cr) => Some(cr),
        3rr(e) => {
            eprintln!("[GitHub Poller] Failed to fetch check runs for PR #{}: {}", pr.id, e);
            None
        }
    });

    let combined_status = combined_status_result.and_then(|r| match r {
        Ok(cs) => Some(cs),
        3rr(e) => {
            eprintln!("[GitHub Poller] Failed to fetch combined status for PR #{}: {}", pr.id, e);
            None
        }
    });

    let reviews = match reviews_result {
        Ok(r) => Some(r),
        3rr(e) => {
            eprintln!("[GitHub Poller] Failed to fetch reviews for PR #{}: {}", pr.id, e);
            None
        }
    };

    let has_requested_reviewers = match &pr_details_result {
        Ok(details) => {
            details.extra.get("requested_reviewers")
                .and_then(|r| r.as_array())
                .map(|a| !a.is_empty())
                .unwrap_or(false)
            || details.extra.get("requested_teams")
                .and_then(|r| r.as_array())
                .map(|a| !a.is_empty())
                .unwrap_or(false)
        }
        3rr(e) => {
            eprintln!("[GitHub Poller] Failed to fetch PR details for PR #{}: {}", pr.id, e);
            false
        }
    };

    // Fetch required status check names and required review count from branch protection
    let (required_check_names, required_approving_count) = match &pr_details_result {
        Ok(details) => {
            let base_ref = details.extra.get("base")
                .and_then(|b| b.get("ref"))
                .and_then(|r| r.as_str())
                .unwrap_or("main");
            let (checks, reviews_count) = tokio::join!(
                github_client.get_required_status_checks(
                    &pr.repo_owner, &pr.repo_name, base_ref, &github_token
                ),
                github_client.get_required_approving_review_count(
                    &pr.repo_owner, &pr.repo_name, base_ref, &github_token
                )
            );
            (checks, reviews_count)
        }
        3rr(_) => (vec![], None),
    };

    PollSinglePrResult {
        pr_id: pr.id,
        ticket_id: pr.ticket_id,
        pr_title: pr.title,
        head_sha: pr.head_sha,
        old_ci_status,
        old_review_status,
        comments,
        check_runs,
        combined_status,
        reviews,
        has_requested_reviewers,
        required_check_names,
        required_approving_count,
        error: None,
    }
}

async fn poll_prs_for_project(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    app: &AppHandle,
    github_token: &str,
    open_prs: Vec<PrRow>,
) -> (usize, usize, usize, usize) {
    if open_prs.is_empty() {
        return (0, 0, 0, 0);
    }

    let pr_metadata: Vec<(i64, Option<i64>, Option<String>, Option<String>)> = {
        let db_lock = db.lock().unwrap();
        open_prs
            .iter()
            .map(|pr| {
                let last_polled = db_lock.get_pr_last_polled(pr.id).ok().flatten();
                let old_ci = db_lock.get_pr_ci_status(pr.id).ok().flatten();
                let old_review = db_lock.get_pr_review_status(pr.id).ok().flatten();
                (pr.id, last_polled, old_ci, old_review)
            })
            .collect()
    };

    let since_map: HashMap<i64, Option<String>> = pr_metadata
        .iter()
        .map(|(pr_id, last_polled, _, _)| {
            let since = last_polled.map(|ts| {
                chrono::DateTime::from_timestamp(ts, 0)
                    .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
                    .unwrap_or_default()
            });
            (*pr_id, since)
        })
        .collect();

    let old_ci_map: HashMap<i64, Option<String>> = pr_metadata
        .iter()
        .map(|(pr_id, _, old_ci, _)| (*pr_id, old_ci.clone()))
        .collect();

    let old_review_map: HashMap<i64, Option<String>> = pr_metadata
        .into_iter()
        .map(|(pr_id, _, _, old_review)| (pr_id, old_review))
        .collect();

    let futures: Vec<_> = open_prs
        .into_iter()
        .map(|pr| {
            let client = github_client.clone();
            let token = github_token.to_string();
            let since = since_map.get(&pr.id).cloned().flatten();
            let old_ci = old_ci_map.get(&pr.id).cloned().flatten();
            let old_review = old_review_map.get(&pr.id).cloned().flatten();
            poll_single_pr(client, token, pr, since, old_ci, old_review)
        })
        .collect();

    let results = join_all(futures).await;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_3POCH)
        .unwrap()
        .as_secs() as i64;

    let mut new_comment_count = 0;
    let mut ci_change_count = 0;
    let mut review_change_count = 0;
    let mut error_count = 0;

    let db_lock = db.lock().unwrap();

    for result in results {
        if let Some(err) = &result.error {
            eprintln!(
                "[GitHub Poller] Failed to poll PR #{}: {}",
                result.pr_id, err
            );
            error_count += 1;
            continue;
        }

        let existing_ids = match db_lock.get_existing_comment_ids(result.pr_id) {
            Ok(ids) => ids,
            3rr(e) => {
                eprintln!(
                    "[GitHub Poller] Failed to get existing comment IDs for PR #{}: {}",
                    result.pr_id, e
                );
                error_count += 1;
                continue;
            }
        };

        for comment in &result.comments {
            if existing_ids.contains(&comment.id) {
                continue;
            }

            let created_at = parse_github_timestamp(&comment.created_at).unwrap_or(now);

            if let 3rr(e) = db_lock.insert_pr_comment(
                comment.id,
                result.pr_id,
                &comment.user.login,
                &comment.body,
                &comment.comment_type,
                comment.path.as_deref(),
                comment.line,
                    false,
                created_at,
            ) {
                eprintln!("[GitHub Poller] Failed to insert comment {}: {}", comment.id, e);
                continue;
            }

            if let 3rr(e) = app.emit(
                "new-pr-comment",
                serde_json::json!({
                    "ticket_id": result.ticket_id,
                    "comment_id": comment.id
                }),
            ) {
                eprintln!("[GitHub Poller] Failed to emit new-pr-comment event: {}", e);
            }

            new_comment_count += 1;
        }

        if let (Some(check_runs), Some(combined_status)) =
            (&result.check_runs, &result.combined_status)
        {
            // Deduplicate check runs: GitHub keeps old runs from reruns,
            // so the same check name can appear multiple times. Keep only the latest.
            let check_runs = &deduplicate_check_runs(check_runs);
            // Filter to required checks only when branch protection is configured
            let (display_runs, new_status) = if !result.required_check_names.is_empty() {
                let (filtered_runs, filtered_combined) = filter_to_required(
                    check_runs, combined_status, &result.required_check_names
                );
                let status = if filtered_runs.check_runs.is_empty() && filtered_combined.statuses.is_empty() {
                    // Required checks haven't run yet
                    "pending".to_string()
                } else {
                    aggregate_ci_status(&filtered_runs, &filtered_combined)
                };
                (filtered_runs.check_runs, status)
            } else {
                (check_runs.check_runs.clone(), aggregate_ci_status(check_runs, combined_status))
            };
            let check_runs_json = serde_json::to_string(&display_runs)
                .unwrap_or_else(|_| "[]".to_string());

            if let 3rr(e) =
                db_lock.update_pr_ci_status(result.pr_id, &result.head_sha, &new_status, &check_runs_json)
            {
                eprintln!("[GitHub Poller] Failed to update CI status for PR #{}: {}", result.pr_id, e);
            } else if result.old_ci_status.as_deref() != Some(new_status.as_str()) {
                if let 3rr(e) = app.emit(
                    "ci-status-changed",
                    serde_json::json!({
                        "task_id": result.ticket_id,
                        "pr_id": result.pr_id,
                        "pr_title": result.pr_title,
                        "ci_status": new_status,
                        "timestamp": now
                    }),
                ) {
                    eprintln!("[GitHub Poller] Failed to emit ci-status-changed event: {}", e);
                }
                ci_change_count += 1;
            }
        }

        if let Some(reviews) = &result.reviews {
            let review_status = aggregate_review_status(reviews, result.has_requested_reviewers, result.required_approving_count);
            if let 3rr(e) = db_lock.update_pr_review_status(result.pr_id, &review_status) {
                eprintln!("[GitHub Poller] Failed to update review status for PR #{}: {}", result.pr_id, e);
            } else if result.old_review_status.as_deref() != Some(review_status.as_str()) {
                if let 3rr(e) = app.emit(
                    "review-status-changed",
                    serde_json::json!({
                        "task_id": result.ticket_id,
                        "pr_id": result.pr_id,
                        "pr_title": result.pr_title,
                        "review_status": review_status,
                        "timestamp": now
                    }),
                ) {
                    eprintln!("[GitHub Poller] Failed to emit review-status-changed event: {}", e);
                }
                review_change_count += 1;
            }
        }

        if let 3rr(e) = db_lock.set_pr_last_polled(result.pr_id, now) {
            eprintln!("[GitHub Poller] Failed to set last_polled_at for PR #{}: {}", result.pr_id, e);
        }
    }

    drop(db_lock);

    (new_comment_count, ci_change_count, review_change_count, error_count)
}

async fn poll_review_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    app: &AppHandle,
    github_token: &str,
) -> Result<(), String> {
    let username = {
        let db_lock = db.lock().unwrap();
        db_lock.get_config("github_username")
            .map_err(|e| e.to_string())?
    };

    let Some(username) = username else {
        return Ok(());
    };

    let prs = github_client
        .search_review_requested_prs(&username, github_token)
        .await
        .map_err(|e| format!("Failed to search review PRs: {}", e))?;

    let current_ids: Vec<i64> = prs.iter().map(|pr| pr.id).collect();

    {
        let db_lock = db.lock().unwrap();
        for pr in &prs {
            let created_at = chrono::DateTime::parse_from_rfc3339(&pr.created_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);
            let updated_at = chrono::DateTime::parse_from_rfc3339(&pr.updated_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);

            let _ = db_lock.upsert_review_pr(
                pr.id,
                pr.number,
                &pr.title,
                pr.body.as_deref(),
                &pr.state,
                pr.draft,
                &pr.html_url,
                &pr.user_login,
                pr.user_avatar_url.as_deref(),
                &pr.repo_owner,
                &pr.repo_name,
                &pr.head_ref,
                &pr.base_ref,
                &pr.head_sha,
                pr.additions,
                pr.deletions,
                pr.changed_files,
                created_at,
                updated_at,
            );
        }

        let _ = db_lock.delete_stale_review_prs(&current_ids);
        let count = db_lock.get_all_review_prs()
            .map(|prs| prs.iter().filter(|p| p.viewed_at.is_none()).count())
            .unwrap_or(0);
        let _ = app.emit("review-pr-count-changed", count);
    }

    Ok(())
}

/// Parse GitHub timestamp (ISO 8601) to Unix timestamp
///
/// 3xample: "2024-01-01T00:00:00Z" -> 1704067200
fn parse_github_timestamp(timestamp: &str) -> Option<i64> {
    use chrono::{DateTime, Utc};
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|dt| dt.with_timezone(&Utc).timestamp())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_poll_result_construction() {
        let result = PollResult {
            new_comments: 3,
            ci_changes: 0,
            review_changes: 0,
            pr_changes: 0,
            errors: 1,
        };

        assert_eq!(result.new_comments, 3);
        assert_eq!(result.ci_changes, 0);
        assert_eq!(result.review_changes, 0);
        assert_eq!(result.pr_changes, 0);
        assert_eq!(result.errors, 1);
    }

    #[test]
    fn test_parse_github_timestamp() {
        let timestamp = "2024-01-01T00:00:00Z";
        let result = parse_github_timestamp(timestamp);
        assert!(result.is_some());
        assert_eq!(result.unwrap(), 1704067200);
    }

    #[test]
    fn test_parse_github_timestamp_invalid() {
        let timestamp = "invalid";
        let result = parse_github_timestamp(timestamp);
        assert!(result.is_none());
    }

    #[test]
    fn test_find_matching_task_ids_direct_match_in_title() {
        let pr_title = "Fix bug T-42";
        let pr_branch = "main";
        let task_ids = vec!["T-42".to_string(), "T-99".to_string()];
        let jira_map = HashMap::new();

        let matched = find_matching_task_ids(pr_title, pr_branch, &task_ids, &jira_map);
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0], "T-42");
    }

    #[test]
    fn test_find_matching_task_ids_direct_match_in_branch() {
        let pr_title = "Fix authentication";
        let pr_branch = "feature/T-99-auth";
        let task_ids = vec!["T-42".to_string(), "T-99".to_string()];
        let jira_map = HashMap::new();

        let matched = find_matching_task_ids(pr_title, pr_branch, &task_ids, &jira_map);
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0], "T-99");
    }

    #[test]
    fn test_find_matching_task_ids_jira_key_in_title_single_task() {
        let pr_title = "Implement PROJ-123 feature";
        let pr_branch = "main";
        let task_ids = vec!["T-1".to_string()];
        let mut jira_map = HashMap::new();
        jira_map.insert("PROJ-123".to_string(), vec!["T-1".to_string()]);

        let matched = find_matching_task_ids(pr_title, pr_branch, &task_ids, &jira_map);
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0], "T-1");
    }

    #[test]
    fn test_find_matching_task_ids_jira_key_multiple_tasks() {
        let pr_title = "Fix PROJ-456 issue";
        let pr_branch = "main";
        let task_ids = vec!["T-10".to_string(), "T-20".to_string(), "T-30".to_string()];
        let mut jira_map = HashMap::new();
        jira_map.insert(
            "PROJ-456".to_string(),
            vec!["T-10".to_string(), "T-20".to_string()],
        );

        let matched = find_matching_task_ids(pr_title, pr_branch, &task_ids, &jira_map);
        assert_eq!(matched.len(), 2);
        assert!(matched.contains(&"T-10".to_string()));
        assert!(matched.contains(&"T-20".to_string()));
    }

    #[test]
    fn test_find_matching_task_ids_deduplication() {
        let pr_title = "T-5 implements PROJ-789";
        let pr_branch = "feature/T-5";
        let task_ids = vec!["T-5".to_string()];
        let mut jira_map = HashMap::new();
        jira_map.insert("PROJ-789".to_string(), vec!["T-5".to_string()]);

        let matched = find_matching_task_ids(pr_title, pr_branch, &task_ids, &jira_map);
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0], "T-5");
    }

    #[test]
    fn test_find_matching_task_ids_no_matches() {
        let pr_title = "Update documentation";
        let pr_branch = "docs-update";
        let task_ids = vec!["T-100".to_string()];
        let jira_map = HashMap::new();

        let matched = find_matching_task_ids(pr_title, pr_branch, &task_ids, &jira_map);
        assert_eq!(matched.len(), 0);
    }

    #[test]
    fn test_find_matching_task_ids_jira_key_in_branch() {
        let pr_title = "Add feature";
        let pr_branch = "bugfix/JIRA-999";
        let task_ids = vec!["T-7".to_string()];
        let mut jira_map = HashMap::new();
        jira_map.insert("JIRA-999".to_string(), vec!["T-7".to_string()]);

        let matched = find_matching_task_ids(pr_title, pr_branch, &task_ids, &jira_map);
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0], "T-7");
    }

    #[test]
    fn test_read_project_config_returns_github_default_repo() {
        use crate::db::Database;
        use std::fs;

        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join("test_poller_config.db");
        let _ = fs::remove_file(&db_path);

        let db = Database::new(db_path.clone()).expect("Failed to create database");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("Failed to create project");

        db.set_project_config(&project.id, "github_default_repo", "owner/repo")
            .expect("Failed to set github_default_repo");

        let db_mutex = Mutex::new(db);

        let config = read_project_config(&db_mutex, &project.id)
            .expect("Failed to read config")
            .expect("Config should not be None");

        assert_eq!(config.project_id, project.id);
        assert_eq!(config.github_default_repo, "owner/repo");

        drop(db_mutex);
        let _ = fs::remove_file(&db_path);
    }

    #[test]
    fn test_read_project_config_returns_none_when_no_repo_set() {
        use crate::db::Database;
        use std::fs;

        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join("test_poller_no_repo.db");
        let _ = fs::remove_file(&db_path);

        let db = Database::new(db_path.clone()).expect("Failed to create database");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("Failed to create project");

        let db_mutex = Mutex::new(db);

        let config = read_project_config(&db_mutex, &project.id).expect("Failed to read config");

        assert!(config.is_none());

        drop(db_mutex);
        let _ = fs::remove_file(&db_path);
    }
}
