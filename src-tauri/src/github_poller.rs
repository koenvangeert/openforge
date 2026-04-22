//! GitHub PR Comment Poller
//!
//! Background Tokio task that polls GitHub at a configurable interval for new PR comments,
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
//!   - Inserts NEW comments only (checks if comment id exists)
//!   - Emits `new-pr-comment` event with ticket_id and comment_id
//! - Sleeps for poll_interval seconds, then loops
//!
//! ## Parallelization
//! - All PRs in a project are polled concurrently using futures::future::join_all
//! - poll_single_pr() handles one PR: comments + CI (check_runs + combined_status in parallel)
//! - DB is locked once after all HTTP calls complete for batch writes
//! - last_polled_at timestamps are read before HTTP calls and written after
//!
//! ## Error Handling
//! - Logs errors and continues (doesn't crash the polling loop)
//! - Individual PR errors don't stop the batch
//! - Network errors trigger retry on next cycle
//! - Skips projects with missing GitHub config

use crate::db::{Database, PrRow};
use crate::github_client::{
    aggregate_ci_status, aggregate_review_status, deduplicate_check_runs, filter_to_required,
    parse_repo_event_changes, CheckRunsResponse, CombinedStatusResponse, GitHubClient, PrComment,
    PrReview,
};
use futures::future::join_all;
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{sleep, Duration};

const DEFAULT_GITHUB_POLL_INTERVAL_SECS: u64 = 60;
const MIN_GITHUB_POLL_INTERVAL_SECS: u64 = 15;
const MAX_GITHUB_POLL_INTERVAL_SECS: u64 = 300;

// ============================================================================
// PollResult
// ============================================================================

/// Result of a single GitHub polling cycle.
///
/// Returned by `poll_github_once()` and used by callers to observe what
/// happened during the cycle (e.g. for IPC responses or logging).
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    /// Whether the GitHub API rate limit was exceeded during this cycle.
    #[serde(default)]
    pub rate_limited: bool,
    /// Unix timestamp when the rate limit resets, if rate_limited is true.
    #[serde(default)]
    pub rate_limit_reset_at: Option<i64>,
}

fn parse_poll_interval_seconds(raw: Option<String>) -> u64 {
    raw.and_then(|value| value.parse::<u64>().ok())
        .map(|value| value.clamp(MIN_GITHUB_POLL_INTERVAL_SECS, MAX_GITHUB_POLL_INTERVAL_SECS))
        .unwrap_or(DEFAULT_GITHUB_POLL_INTERVAL_SECS)
}

// ============================================================================
// Public API
// ============================================================================

/// Execute a single GitHub polling cycle.
///
/// Reads the GitHub token from the database, iterates all projects, syncs open
/// PRs, polls comments and CI status for each PR, and polls review-requested
/// PRs. All event emissions happen inside this function exactly as they did in
/// the original loop body.
///
/// The caller is responsible for creating and owning the `GitHubClient` so that
/// ETag caching (added in Task 2) persists across cycles in the background loop
/// while still allowing a fresh client to be used from a Tauri command.
///
/// # Arguments
/// * `app` - Tauri AppHandle for accessing managed state and emitting events
/// * `github_client` - Shared GitHub API client (caller owns lifetime)
pub async fn poll_github_once(app: &AppHandle, github_client: &GitHubClient) -> PollResult {
    let cycle_start = Instant::now();
    github_client.clear_rate_limit_reset();
    let db = app.state::<Arc<Mutex<Database>>>();

    let github_token = crate::secure_store::get_secret("github_token")
        .unwrap_or(None)
        .unwrap_or_default();

    if github_token.is_empty() {
        return PollResult {
            new_comments: 0,
            ci_changes: 0,
            review_changes: 0,
            pr_changes: 0,
            errors: 0,
            rate_limited: false,
            rate_limit_reset_at: None,
        };
    }

    let projects = {
        let db_lock = db.lock().unwrap();
        db_lock.get_all_projects()
    };

    let projects = match projects {
        Ok(projects) => projects,
        Err(e) => {
            error!("[GitHub Poller] Failed to get projects: {}", e);
            return PollResult {
                new_comments: 0,
                ci_changes: 0,
                review_changes: 0,
                pr_changes: 0,
                errors: 1,
                rate_limited: false,
                rate_limit_reset_at: None,
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
            rate_limited: false,
            rate_limit_reset_at: None,
        };
    }

    debug!(
        "[GitHub Poller] Polling {} projects for PR updates...",
        projects.len()
    );

    let project_count = projects.len();
    let mut total_new_comments = 0;
    let mut total_ci_changes = 0;
    let mut total_review_changes = 0;
    let mut total_errors = 0;
    let mut rate_limit_count = 0;

    for project in projects {
        let config = match read_project_config(&db, &project.id) {
            Ok(Some(cfg)) => cfg,
            Ok(None) => {
                continue;
            }
            Err(e) => {
                error!(
                    "[GitHub Poller] Failed to read config for project {}: {}",
                    project.id, e
                );
                total_errors += 1;
                continue;
            }
        };

        if config.github_default_repo.is_empty() {
            continue;
        }

        let parts: Vec<&str> = config.github_default_repo.split('/').collect();
        if parts.len() != 2 {
            error!(
                "[GitHub Poller] Invalid repo format for project {}: {}",
                project.id, config.github_default_repo
            );
            total_errors += 1;
            continue;
        }

        let sync_start = Instant::now();
        if let Err(e) = sync_open_prs(github_client, &db, app, &config, &github_token).await {
            error!(
                "[GitHub Poller] Failed to sync PRs for project {}: {}",
                project.id, e
            );
            total_errors += 1;
            if e.should_increment_rate_limit_count() {
                rate_limit_count += 1;
            }
            continue;
        }
        debug!(
            "[GitHub Poller] Sync open PRs for project {} took {:.1}s",
            project.id,
            sync_start.elapsed().as_secs_f64()
        );

        let open_prs = match get_open_prs_for_project(&db, &project.id) {
            Ok(prs) => prs,
            Err(e) => {
                error!(
                    "[GitHub Poller] Failed to get PRs for project {}: {}",
                    project.id, e
                );
                total_errors += 1;
                continue;
            }
        };

        let activity_pr_numbers = match github_client
            .list_repo_events(parts[0], parts[1], &github_token)
            .await
        {
            Ok(events) => parse_repo_event_changes(&events).touched_pr_numbers,
            Err(e) => {
                error!(
                    "[GitHub Poller] Failed to fetch repo events for {}/{}: {}",
                    parts[0], parts[1], e
                );
                Vec::new()
            }
        };

        let poll_start = Instant::now();
        let (new_comments, ci_changes, review_changes, errors) = poll_prs_for_project(
            github_client,
            &db,
            app,
            &github_token,
            open_prs,
            &activity_pr_numbers,
        )
        .await;
        debug!(
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
        info!(
            "[GitHub Poller] Found {} new comments ({} errors)",
            total_new_comments, total_errors
        );
    }

    let review_start = Instant::now();
    count_poll_phase_error(
        "review PRs",
        poll_review_prs(github_client, &db, app, &github_token).await,
        &mut total_errors,
        &mut rate_limit_count,
    );
    debug!(
        "[GitHub Poller] Review PR polling took {:.1}s",
        review_start.elapsed().as_secs_f64()
    );

    let authored_start = Instant::now();
    count_poll_phase_error(
        "authored PRs",
        poll_authored_prs(github_client, &db, app, &github_token).await,
        &mut total_errors,
        &mut rate_limit_count,
    );
    debug!(
        "[GitHub Poller] Authored PR polling took {:.1}s",
        authored_start.elapsed().as_secs_f64()
    );

    let rate_limit_reset = github_client.get_last_rate_limit_reset();
    let rate_limited = rate_limit_reset.is_some() || rate_limit_count > 0;

    debug!(
        "[GitHub Poller] Cycle completed in {:.1}s ({} projects, {} new comments, {} CI changes, {} review changes, {} errors, rate_limited={}, reset_at={})",
        cycle_start.elapsed().as_secs_f64(),
        project_count,
        total_new_comments,
        total_ci_changes,
        total_review_changes,
        total_errors,
        rate_limited,
        rate_limit_reset.map(|ts| ts.to_string()).unwrap_or_else(|| "none".to_string())
    );

    if rate_limited {
        let has_changes =
            total_new_comments > 0 || total_ci_changes > 0 || total_review_changes > 0;

        if has_changes {
            warn!(
                "[GitHub Poller] Rate limit detected BUT cycle has changes: {} new comments, {} CI changes, {} review changes",
                total_new_comments, total_ci_changes, total_review_changes
            );
        } else if let Some(reset_at) = rate_limit_reset {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;
            let seconds_until_reset = (reset_at - now).max(0);

            warn!(
                "[GitHub Poller] Rate limit detected, no changes this cycle (resets in {} seconds)",
                seconds_until_reset
            );
        } else {
            warn!(
                "[GitHub Poller] Rate limit detected, no changes this cycle (reset time unknown)"
            );
        }
    }

    PollResult {
        new_comments: total_new_comments,
        ci_changes: total_ci_changes,
        review_changes: total_review_changes,
        pr_changes: 0,
        errors: total_errors,
        rate_limited,
        rate_limit_reset_at: rate_limit_reset,
    }
}

/// Start the GitHub poller background task.
///
/// Runs indefinitely: reads the poll interval from the database, calls
/// `poll_github_once()`, then sleeps. The `GitHubClient` is created once and
/// reused across cycles so that ETag caching (Task 2) persists.
///
/// # Arguments
/// * `app` - Tauri AppHandle for accessing managed state and emitting events
pub async fn start_github_poller(app: AppHandle) {
    let github_client = app.state::<GitHubClient>().inner().clone();

    loop {
        let db = app.state::<Arc<Mutex<Database>>>();

        let poll_interval = {
            let db_lock = db.lock().unwrap();
            parse_poll_interval_seconds(db_lock.get_config("github_poll_interval").ok().flatten())
        };

        let result = poll_github_once(&app, &github_client).await;

        let has_changes = result.new_comments > 0
            || result.ci_changes > 0
            || result.review_changes > 0
            || result.pr_changes > 0;

        if has_changes {
            if let Err(e) = app.emit("github-sync-complete", &result) {
                warn!("[GitHub Poller] Failed to emit github-sync-complete: {}", e);
            }
        }

        if result.rate_limited {
            if let Err(e) = app.emit(
                "github-rate-limited",
                serde_json::json!({
                    "reset_at": result.rate_limit_reset_at
                }),
            ) {
                warn!("[GitHub Poller] Failed to emit github-rate-limited: {}", e);
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

fn get_open_prs_for_project(db: &Mutex<Database>, project_id: &str) -> Result<Vec<PrRow>, String> {
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

fn should_fetch_comments_for_pr(pr_id: i64, changed_pr_numbers: &HashSet<i64>) -> bool {
    changed_pr_numbers.is_empty() || changed_pr_numbers.contains(&pr_id)
}

#[derive(Debug)]
enum PollPhaseError {
    GitHub(crate::github_client::GitHubError),
    Db(String),
}

impl PollPhaseError {
    fn should_increment_rate_limit_count(&self) -> bool {
        matches!(
            self,
            Self::GitHub(crate::github_client::GitHubError::ApiError { status: 429, .. })
        )
    }
}

impl fmt::Display for PollPhaseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::GitHub(error) => write!(f, "{}", error),
            Self::Db(message) => f.write_str(message),
        }
    }
}

#[derive(Debug)]
enum SyncOpenPrsError {
    InvalidRepoFormat(String),
    GitHub(crate::github_client::GitHubError),
    Db(String),
}

impl SyncOpenPrsError {
    fn should_increment_rate_limit_count(&self) -> bool {
        matches!(self, Self::GitHub(error) if error.is_rate_limited())
    }
}

impl fmt::Display for SyncOpenPrsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRepoFormat(message) | Self::Db(message) => f.write_str(message),
            Self::GitHub(error) => write!(f, "{}", error),
        }
    }
}

async fn sync_open_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    _app: &AppHandle,
    config: &PollerConfig,
    github_token: &str,
) -> Result<usize, SyncOpenPrsError> {
    let parts: Vec<&str> = config.github_default_repo.split('/').collect();
    if parts.len() != 2 {
        return Err(SyncOpenPrsError::InvalidRepoFormat(
            "github_default_repo must be in format 'owner/repo'".to_string(),
        ));
    }
    let (repo_owner, repo_name) = (parts[0], parts[1]);

    let github_prs = github_client
        .list_open_prs(repo_owner, repo_name, github_token)
        .await
        .map_err(SyncOpenPrsError::GitHub)?;

    let task_ids: Vec<String> = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_tasks_for_project(&config.project_id)
            .map_err(|e| SyncOpenPrsError::Db(format!("Failed to get task data: {}", e)))?
            .into_iter()
            .map(|task| task.id)
            .collect()
    };

    let open_pr_ids: Vec<i64> = github_prs.iter().map(|pr| pr.number).collect();

    let closed_prs = {
        let db_lock = db.lock().unwrap();
        let all_open_prs = db_lock
            .get_open_prs()
            .map_err(|e| SyncOpenPrsError::Db(e.to_string()))?;

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
                        let merged = details
                            .extra
                            .get("merged")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let merged_at = details
                            .extra
                            .get("merged_at")
                            .and_then(|v| v.as_str())
                            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                            .map(|dt| dt.timestamp());
                        (pr_id, merged, merged_at)
                    }
                    Err(e) => {
                        warn!(
                            "[GitHub Poller] Failed to check merge status for PR #{}: {}",
                            pr_id, e
                        );
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
                    if let Err(e) = db_lock.update_pr_merged(*pr_id, *ts) {
                        error!(
                            "[GitHub Poller] Failed to update merged status for PR #{}: {}",
                            pr_id, e
                        );
                    }
                }
            }
        }
    }

    let mut dont_close_ids = open_pr_ids.clone();
    dont_close_ids.extend(merged_pr_ids.iter());

    {
        let db_lock = db.lock().unwrap();
        db_lock
            .close_stale_open_prs(repo_owner, repo_name, &dont_close_ids)
            .map_err(|e| SyncOpenPrsError::Db(format!("Failed to close stale PRs: {}", e)))?;
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let mut synced = 0;
    for pr in &github_prs {
        if let Some(task_id) =
            find_authoritative_task_id(&pr.title, &pr.head.ref_name, &task_ids)
        {
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
                pr.draft.unwrap_or(false),
            );
            let _ = db_lock.update_pr_head_sha(pr.number, &pr.head.sha);
            drop(db_lock);
            synced += 1;
        }
    }

    Ok(synced)
}

fn find_task_id_position(text: &str, task_id: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let pattern = task_id.as_bytes();
    let pat_len = pattern.len();
    if pat_len > bytes.len() {
        return None;
    }
    for i in 0..=(bytes.len() - pat_len) {
        if &bytes[i..i + pat_len] == pattern {
            // Check left boundary: must be start-of-string or non-alphanumeric
            if i > 0 && (bytes[i - 1] as char).is_alphanumeric() {
                continue;
            }
            // Check right boundary: must be end-of-string or non-digit
            let after = i + pat_len;
            if after < bytes.len() && (bytes[after] as char).is_ascii_digit() {
                continue;
            }
            return Some(i);
        }
    }
    None
}

fn contains_task_id(text: &str, task_id: &str) -> bool {
    find_task_id_position(text, task_id).is_some()
}

enum TaskMatchOutcome {
    None,
    Unique(String),
    Ambiguous,
}

fn classify_task_matches(text: &str, task_ids: &[String]) -> TaskMatchOutcome {
    let mut matched_task_ids = task_ids
        .iter()
        .filter(|task_id| contains_task_id(text, task_id.as_str()))
        .cloned();

    let Some(first_match) = matched_task_ids.next() else {
        return TaskMatchOutcome::None;
    };

    if matched_task_ids.next().is_some() {
        TaskMatchOutcome::Ambiguous
    } else {
        TaskMatchOutcome::Unique(first_match)
    }
}

fn find_authoritative_task_id(
    pr_title: &str,
    pr_branch: &str,
    task_ids: &[String],
) -> Option<String> {
    match classify_task_matches(pr_branch, task_ids) {
        TaskMatchOutcome::Unique(task_id) => Some(task_id),
        TaskMatchOutcome::Ambiguous => None,
        TaskMatchOutcome::None => match classify_task_matches(pr_title, task_ids) {
            TaskMatchOutcome::Unique(task_id) => Some(task_id),
            TaskMatchOutcome::Ambiguous | TaskMatchOutcome::None => None,
        },
    }
}

pub fn find_matching_task_ids(pr_title: &str, pr_branch: &str, task_ids: &[String]) -> Vec<String> {
    let mut matched = Vec::new();
    let mut seen = HashSet::new();

    for task_id in task_ids {
        if (contains_task_id(pr_title, task_id.as_str())
            || contains_task_id(pr_branch, task_id.as_str()))
            && seen.insert(task_id.clone())
        {
            matched.push(task_id.clone());
        }
    }

    matched
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
    mergeable: Option<bool>,
    mergeable_state: Option<String>,
    is_queued: bool,
    required_check_names: Vec<String>,
    required_approving_count: Option<usize>,
    error: Option<String>,
}

#[derive(Debug, Default)]
struct PersistCommentsResult {
    new_comment_count: usize,
    failed_insert_count: usize,
}

fn persist_polled_comments<R: tauri::Runtime>(
    app: &impl Emitter<R>,
    db: &Database,
    result: &PollSinglePrResult,
    existing_ids: &HashSet<i64>,
    now: i64,
) -> PersistCommentsResult {
    let mut persist_result = PersistCommentsResult::default();
    let mut inserted_this_batch: HashSet<i64> = HashSet::new();

    for comment in &result.comments {
        if existing_ids.contains(&comment.id) || inserted_this_batch.contains(&comment.id) {
            continue;
        }

        let created_at = parse_github_timestamp(&comment.created_at).unwrap_or(now);

        if let Err(e) = db.insert_pr_comment(
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
            error!(
                "[GitHub Poller] Failed to insert comment {}: {}",
                comment.id, e
            );
            persist_result.failed_insert_count += 1;
            continue;
        }

        if let Err(e) = app.emit(
            "new-pr-comment",
            serde_json::json!({
                "ticket_id": result.ticket_id,
                "comment_id": comment.id
            }),
        ) {
            warn!("[GitHub Poller] Failed to emit new-pr-comment event: {}", e);
        }

        persist_result.new_comment_count += 1;
        inserted_this_batch.insert(comment.id);
    }

    persist_result
}

#[allow(clippy::too_many_arguments)]
async fn poll_single_pr(
    github_client: GitHubClient,
    github_token: String,
    pr: PrRow,
    since: Option<String>,
    old_ci_status: Option<String>,
    old_review_status: Option<String>,
    old_mergeable: Option<bool>,
    old_mergeable_state: Option<String>,
    fetch_comments: bool,
) -> PollSinglePrResult {
    let since_ref = since.as_deref();

    let comments = if fetch_comments {
        let comments_result = github_client
            .get_pr_comments(
                &pr.repo_owner,
                &pr.repo_name,
                pr.id,
                &github_token,
                since_ref,
            )
            .await;

        match comments_result {
            Ok(c) => c,
            Err(e) => {
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
                    mergeable: old_mergeable,
                    mergeable_state: old_mergeable_state,
                    is_queued: false,
                    required_check_names: vec![],
                    required_approving_count: None,
                    error: Some(format!("Failed to fetch comments: {}", e)),
                };
            }
        }
    } else {
        Vec::new()
    };

    // Fetch CI status, reviews, and PR details in parallel
    let ci_future = async {
        if pr.head_sha.is_empty() {
            (None, None)
        } else {
            let (cr, cs) = tokio::join!(
                github_client.get_check_runs(
                    &pr.repo_owner,
                    &pr.repo_name,
                    &pr.head_sha,
                    &github_token
                ),
                github_client.get_combined_status(
                    &pr.repo_owner,
                    &pr.repo_name,
                    &pr.head_sha,
                    &github_token
                )
            );
            (Some(cr), Some(cs))
        }
    };

    let reviews_future =
        github_client.get_pr_reviews(&pr.repo_owner, &pr.repo_name, pr.id, &github_token);
    let pr_details_future =
        github_client.get_pr_details(&pr.repo_owner, &pr.repo_name, pr.id, &github_token);

    let ((check_runs_result, combined_status_result), reviews_result, pr_details_result) =
        tokio::join!(ci_future, reviews_future, pr_details_future);

    let check_runs = check_runs_result.and_then(|r| match r {
        Ok(cr) => Some(cr),
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to fetch check runs for PR #{}: {}",
                pr.id, e
            );
            None
        }
    });

    let combined_status = combined_status_result.and_then(|r| match r {
        Ok(cs) => Some(cs),
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to fetch combined status for PR #{}: {}",
                pr.id, e
            );
            None
        }
    });

    let reviews = match reviews_result {
        Ok(r) => Some(r),
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to fetch reviews for PR #{}: {}",
                pr.id, e
            );
            None
        }
    };

    let has_requested_reviewers = match &pr_details_result {
        Ok(details) => {
            details
                .extra
                .get("requested_reviewers")
                .and_then(|r| r.as_array())
                .map(|a| !a.is_empty())
                .unwrap_or(false)
                || details
                    .extra
                    .get("requested_teams")
                    .and_then(|r| r.as_array())
                    .map(|a| !a.is_empty())
                    .unwrap_or(false)
        }
        Err(e) => {
            warn!(
                "[GitHub Poller] Failed to fetch PR details for PR #{}: {}",
                pr.id, e
            );
            false
        }
    };

    let is_queued = match &pr_details_result {
        Ok(details) => details
            .extra
            .get("merge_queue_entry")
            .map(|v| !v.is_null())
            .unwrap_or(false),
        Err(_) => false,
    };

    let (mergeable, mergeable_state) =
        mergeability_after_pr_details(&pr_details_result, old_mergeable, old_mergeable_state);

    // Fetch required status check names and required review count from branch protection
    let (required_check_names, required_approving_count) = match &pr_details_result {
        Ok(details) => {
            let base_ref = details
                .extra
                .get("base")
                .and_then(|b| b.get("ref"))
                .and_then(|r| r.as_str())
                .unwrap_or("main");
            let (checks, reviews_count) = tokio::join!(
                github_client.get_required_status_checks(
                    &pr.repo_owner,
                    &pr.repo_name,
                    base_ref,
                    &github_token
                ),
                github_client.get_required_approving_review_count(
                    &pr.repo_owner,
                    &pr.repo_name,
                    base_ref,
                    &github_token
                )
            );
            (checks, reviews_count)
        }
        Err(_) => (vec![], None),
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
        mergeable,
        mergeable_state,
        is_queued,
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
    changed_pr_numbers: &[i64],
) -> (usize, usize, usize, usize) {
    if open_prs.is_empty() {
        return (0, 0, 0, 0);
    }

    type PrMetadata = (
        i64,
        Option<i64>,
        Option<String>,
        Option<String>,
        Option<bool>,
        Option<String>,
    );
    let pr_metadata: Vec<PrMetadata> = {
        let db_lock = db.lock().unwrap();
        open_prs
            .iter()
            .map(|pr| {
                let last_polled = db_lock.get_pr_last_polled(pr.id).ok().flatten();
                let old_ci = db_lock.get_pr_ci_status(pr.id).ok().flatten();
                let old_review = db_lock.get_pr_review_status(pr.id).ok().flatten();
                (
                    pr.id,
                    last_polled,
                    old_ci,
                    old_review,
                    pr.mergeable,
                    pr.mergeable_state.clone(),
                )
            })
            .collect()
    };

    let since_map: HashMap<i64, Option<String>> = pr_metadata
        .iter()
        .map(|(pr_id, last_polled, _, _, _, _)| {
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
        .map(|(pr_id, _, old_ci, _, _, _)| (*pr_id, old_ci.clone()))
        .collect();

    let old_review_map: HashMap<i64, Option<String>> = pr_metadata
        .iter()
        .map(|(pr_id, _, _, old_review, _, _)| (*pr_id, old_review.clone()))
        .collect();

    let old_mergeability_map: HashMap<i64, (Option<bool>, Option<String>)> = pr_metadata
        .into_iter()
        .map(|(pr_id, _, _, _, old_mergeable, old_mergeable_state)| {
            (pr_id, (old_mergeable, old_mergeable_state))
        })
        .collect();

    let changed_pr_numbers: HashSet<i64> = changed_pr_numbers.iter().copied().collect();

    let futures: Vec<_> = open_prs
        .into_iter()
        .map(|pr| {
            let client = github_client.clone();
            let token = github_token.to_string();
            let since = since_map.get(&pr.id).cloned().flatten();
            let old_ci = old_ci_map.get(&pr.id).cloned().flatten();
            let old_review = old_review_map.get(&pr.id).cloned().flatten();
            let (old_mergeable, old_mergeable_state) = old_mergeability_map
                .get(&pr.id)
                .cloned()
                .unwrap_or((None, None));
            let fetch_comments = should_fetch_comments_for_pr(pr.id, &changed_pr_numbers);
            poll_single_pr(
                client,
                token,
                pr,
                since,
                old_ci,
                old_review,
                old_mergeable,
                old_mergeable_state,
                fetch_comments,
            )
        })
        .collect();

    let results = join_all(futures).await;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let mut new_comment_count = 0;
    let mut ci_change_count = 0;
    let mut review_change_count = 0;
    let mut error_count = 0;

    let db_lock = db.lock().unwrap();

    for result in results {
        if let Some(err) = &result.error {
            error!(
                "[GitHub Poller] Failed to poll PR #{}: {}",
                result.pr_id, err
            );
            error_count += 1;
            continue;
        }

        let existing_ids = match db_lock.get_existing_comment_ids(result.pr_id) {
            Ok(ids) => ids,
            Err(e) => {
                error!(
                    "[GitHub Poller] Failed to get existing comment IDs for PR #{}: {}",
                    result.pr_id, e
                );
                error_count += 1;
                continue;
            }
        };

        let persist_result = persist_polled_comments(app, &db_lock, &result, &existing_ids, now);
        new_comment_count += persist_result.new_comment_count;

        if let (Some(check_runs), Some(combined_status)) =
            (&result.check_runs, &result.combined_status)
        {
            // Deduplicate check runs: GitHub keeps old runs from reruns,
            // so the same check name can appear multiple times. Keep only the latest.
            let check_runs = &deduplicate_check_runs(check_runs);
            // Filter to required checks only when branch protection is configured
            let (display_runs, new_status) = if !result.required_check_names.is_empty() {
                let (filtered_runs, filtered_combined) =
                    filter_to_required(check_runs, combined_status, &result.required_check_names);
                let status = if filtered_runs.check_runs.is_empty()
                    && filtered_combined.statuses.is_empty()
                {
                    // Required checks haven't run yet
                    "pending".to_string()
                } else {
                    aggregate_ci_status(&filtered_runs, &filtered_combined)
                };
                (filtered_runs.check_runs, status)
            } else {
                (
                    check_runs.check_runs.clone(),
                    aggregate_ci_status(check_runs, combined_status),
                )
            };
            let check_runs_json =
                serde_json::to_string(&display_runs).unwrap_or_else(|_| "[]".to_string());

            if let Err(e) = db_lock.update_pr_ci_status(
                result.pr_id,
                &result.head_sha,
                &new_status,
                &check_runs_json,
            ) {
                error!(
                    "[GitHub Poller] Failed to update CI status for PR #{}: {}",
                    result.pr_id, e
                );
            } else if result.old_ci_status.as_deref() != Some(new_status.as_str()) {
                if let Err(e) = app.emit(
                    "ci-status-changed",
                    serde_json::json!({
                        "task_id": result.ticket_id,
                        "pr_id": result.pr_id,
                        "pr_title": result.pr_title,
                        "ci_status": new_status,
                        "timestamp": now
                    }),
                ) {
                    warn!(
                        "[GitHub Poller] Failed to emit ci-status-changed event: {}",
                        e
                    );
                }
                ci_change_count += 1;
            }
        }

        if let Some(reviews) = &result.reviews {
            let review_status = aggregate_review_status(
                reviews,
                result.has_requested_reviewers,
                result.required_approving_count,
            );
            if let Err(e) = db_lock.update_pr_review_status(result.pr_id, &review_status) {
                error!(
                    "[GitHub Poller] Failed to update review status for PR #{}: {}",
                    result.pr_id, e
                );
            } else if result.old_review_status.as_deref() != Some(review_status.as_str()) {
                if let Err(e) = app.emit(
                    "review-status-changed",
                    serde_json::json!({
                        "task_id": result.ticket_id,
                        "pr_id": result.pr_id,
                        "pr_title": result.pr_title,
                        "review_status": review_status,
                        "timestamp": now
                    }),
                ) {
                    warn!(
                        "[GitHub Poller] Failed to emit review-status-changed event: {}",
                        e
                    );
                }
                review_change_count += 1;
            }
        }

        if let Err(e) = db_lock.update_pr_is_queued(result.pr_id, result.is_queued) {
            error!(
                "[GitHub Poller] Failed to update is_queued for PR #{}: {}",
                result.pr_id, e
            );
        }

        if let Err(e) = db_lock.update_pr_mergeability(
            result.pr_id,
            result.mergeable,
            result.mergeable_state.as_deref(),
        ) {
            error!(
                "[GitHub Poller] Failed to update mergeability for PR #{}: {}",
                result.pr_id, e
            );
        }

        if let Err(e) = db_lock.set_pr_last_polled(result.pr_id, now) {
            error!(
                "[GitHub Poller] Failed to set last_polled_at for PR #{}: {}",
                result.pr_id, e
            );
        }
    }

    drop(db_lock);

    (
        new_comment_count,
        ci_change_count,
        review_change_count,
        error_count,
    )
}

fn count_poll_phase_error(
    phase: &str,
    result: Result<(), PollPhaseError>,
    total_errors: &mut usize,
    rate_limit_count: &mut usize,
) {
    if let Err(e) = result {
        error!("[GitHub Poller] Failed to poll {}: {}", phase, e);
        *total_errors += 1;
        if e.should_increment_rate_limit_count() {
            *rate_limit_count += 1;
        }
    }
}

async fn poll_review_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    app: &AppHandle,
    github_token: &str,
) -> Result<(), PollPhaseError> {
    let username = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_config("github_username")
            .map_err(|e| PollPhaseError::Db(e.to_string()))?
    };

    let Some(username) = username else {
        return Ok(());
    };

    let (prs, all_search_ids) = github_client
        .search_review_requested_prs(&username, github_token)
        .await
        .map_err(PollPhaseError::GitHub)?;

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
            let _ = db_lock.update_review_pr_mergeability(
                pr.id,
                pr.mergeable,
                pr.mergeable_state.as_deref(),
            );
        }

        if !all_search_ids.is_empty() || prs.is_empty() {
            let _ = db_lock.delete_stale_review_prs(&all_search_ids);
        }
        let count = db_lock
            .get_all_review_prs()
            .map(|prs| prs.iter().filter(|p| p.viewed_at.is_none()).count())
            .unwrap_or(0);
        let _ = app.emit("review-pr-count-changed", count);
    }

    Ok(())
}

async fn poll_authored_prs(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    app: &AppHandle,
    github_token: &str,
) -> Result<(), PollPhaseError> {
    let username = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_config("github_username")
            .map_err(|e| PollPhaseError::Db(e.to_string()))?
    };

    let Some(username) = username else {
        return Ok(());
    };

    let (prs, all_search_ids) = github_client
        .search_authored_prs(&username, github_token)
        .await
        .map_err(PollPhaseError::GitHub)?;

    type EnrichedPrData = (
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<bool>,
        Option<String>,
        bool,
    );
    let mut enriched: HashMap<i64, EnrichedPrData> = HashMap::with_capacity(prs.len());

    for pr in &prs {
        let created_at = chrono::DateTime::parse_from_rfc3339(&pr.created_at)
            .map(|dt| dt.timestamp())
            .unwrap_or(0);
        let (check_runs_result, combined_status_result, reviews_result, pr_details_result) = tokio::join!(
            github_client.get_check_runs(&pr.repo_owner, &pr.repo_name, &pr.head_sha, github_token),
            github_client.get_combined_status(
                &pr.repo_owner,
                &pr.repo_name,
                &pr.head_sha,
                github_token
            ),
            github_client.get_pr_reviews(&pr.repo_owner, &pr.repo_name, pr.number, github_token),
            github_client.get_pr_details(&pr.repo_owner, &pr.repo_name, pr.number, github_token)
        );

        let (ci_status, ci_check_runs) = match (check_runs_result, combined_status_result) {
            (Ok(check_runs), Ok(combined_status)) => {
                let status =
                    crate::github_client::aggregate_ci_status(&check_runs, &combined_status);
                let check_runs_json = serde_json::to_string(&check_runs.check_runs)
                    .unwrap_or_else(|_| "[]".to_string());
                (Some(status), Some(check_runs_json))
            }
            _ => (None, None),
        };

        let review_status = reviews_result
            .ok()
            .map(|reviews| crate::github_client::aggregate_review_status(&reviews, false, None));

        let pr_details = pr_details_result.ok();

        let is_queued = pr_details
            .as_ref()
            .and_then(|details| details.extra.get("merge_queue_entry").map(|v| !v.is_null()))
            .unwrap_or(false);

        enriched.insert(
            pr.id,
            (
                created_at,
                ci_status,
                ci_check_runs,
                review_status,
                pr_details.as_ref().and_then(|details| details.mergeable),
                pr_details
                    .as_ref()
                    .and_then(|details| details.mergeable_state.clone()),
                is_queued,
            ),
        );
    }

    {
        let db_lock = db.lock().unwrap();
        for pr in &prs {
            let (
                created_at,
                ci_status,
                ci_check_runs,
                review_status,
                mergeable,
                mergeable_state,
                is_queued,
            ) = match enriched.get(&pr.id) {
                Some(data) => data,
                None => continue,
            };

            let updated_at = chrono::DateTime::parse_from_rfc3339(&pr.updated_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);

            let task_id = db_lock.get_task_id_for_pr(pr.id).ok().flatten();

            let _ = db_lock.upsert_authored_pr(
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
                ci_status.as_deref(),
                ci_check_runs.as_deref(),
                review_status.as_deref(),
                None,
                *is_queued,
                task_id.as_deref(),
                *created_at,
                updated_at,
            );
            let _ = db_lock.update_authored_pr_mergeability(
                pr.id,
                *mergeable,
                mergeable_state.as_deref(),
            );
        }

        if !all_search_ids.is_empty() || prs.is_empty() {
            let _ = db_lock.delete_stale_authored_prs(&all_search_ids);
        }

        let _ = app.emit("authored-prs-updated", ());
    }

    Ok(())
}

fn parse_github_timestamp(timestamp: &str) -> Option<i64> {
    use chrono::{DateTime, Utc};
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|dt| dt.with_timezone(&Utc).timestamp())
}

fn mergeability_after_pr_details(
    pr_details_result: &Result<
        crate::github_client::PullRequest,
        crate::github_client::GitHubError,
    >,
    old_mergeable: Option<bool>,
    old_mergeable_state: Option<String>,
) -> (Option<bool>, Option<String>) {
    match pr_details_result {
        Ok(details) => (details.mergeable, details.mergeable_state.clone()),
        Err(_) => (old_mergeable, old_mergeable_state),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::{insert_test_task, make_test_db};
    use crate::github_client::GitHubClient;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    #[test]
    fn test_poll_result_construction() {
        let result = PollResult {
            new_comments: 3,
            ci_changes: 0,
            review_changes: 0,
            pr_changes: 0,
            errors: 1,
            rate_limited: false,
            rate_limit_reset_at: None,
        };

        assert_eq!(result.new_comments, 3);
        assert_eq!(result.ci_changes, 0);
        assert_eq!(result.review_changes, 0);
        assert_eq!(result.pr_changes, 0);
        assert_eq!(result.errors, 1);
        assert!(!result.rate_limited);
        assert_eq!(result.rate_limit_reset_at, None);
    }

    #[test]
    fn test_poll_result_rate_limit_fields_default() {
        let result = PollResult {
            new_comments: 0,
            ci_changes: 0,
            review_changes: 0,
            pr_changes: 0,
            errors: 0,
            rate_limited: false,
            rate_limit_reset_at: None,
        };

        assert!(!result.rate_limited);
        assert_eq!(result.rate_limit_reset_at, None);
    }

    #[test]
    fn test_poll_result_serialization_includes_rate_limit() {
        let result = PollResult {
            new_comments: 5,
            ci_changes: 2,
            review_changes: 1,
            pr_changes: 0,
            errors: 0,
            rate_limited: true,
            rate_limit_reset_at: Some(1704067200),
        };

        let json = serde_json::to_string(&result).expect("serialization failed");
        assert!(json.contains("\"rate_limited\":true"));
        assert!(json.contains("\"rate_limit_reset_at\":1704067200"));
    }

    #[test]
    fn test_poll_result_deserialization_backward_compat() {
        let old_json = r#"{
            "new_comments": 3,
            "ci_changes": 1,
            "review_changes": 0,
            "pr_changes": 0,
            "errors": 0
        }"#;

        let result: PollResult = serde_json::from_str(old_json).expect("deserialization failed");
        assert_eq!(result.new_comments, 3);
        assert_eq!(result.ci_changes, 1);
        assert_eq!(result.review_changes, 0);
        assert_eq!(result.pr_changes, 0);
        assert_eq!(result.errors, 0);
        assert!(!result.rate_limited);
        assert_eq!(result.rate_limit_reset_at, None);
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
    fn test_mergeability_after_pr_details_preserves_previous_values_on_error() {
        let result = mergeability_after_pr_details(
            &Err(crate::github_client::GitHubError::NetworkError(
                "boom".to_string(),
            )),
            Some(false),
            Some("dirty".to_string()),
        );

        assert_eq!(result, (Some(false), Some("dirty".to_string())));
    }

    #[test]
    fn test_mergeability_after_pr_details_uses_fetched_unknown_state() {
        let details = crate::github_client::PullRequest {
            number: 1,
            title: "Test PR".to_string(),
            state: "open".to_string(),
            html_url: "https://github.com/acme/repo/pull/1".to_string(),
            user: crate::github_client::GitHubUser {
                login: "octocat".to_string(),
                extra: serde_json::json!({}),
            },
            head: crate::github_client::GitHubHead {
                ref_name: "feature/test".to_string(),
                sha: "abc123".to_string(),
                extra: serde_json::json!({}),
            },
            draft: Some(false),
            mergeable: None,
            mergeable_state: Some("unknown".to_string()),
            extra: serde_json::json!({}),
        };

        let result =
            mergeability_after_pr_details(&Ok(details), Some(false), Some("dirty".to_string()));

        assert_eq!(result, (None, Some("unknown".to_string())));
    }

    #[test]
    fn test_sync_open_prs_error_rate_limit_detection_uses_typed_github_error() {
        let rate_limited = SyncOpenPrsError::GitHub(crate::github_client::GitHubError::ApiError {
            status: 429,
            message: "Too Many Requests".to_string(),
        });
        assert!(rate_limited.should_increment_rate_limit_count());

        let forbidden = SyncOpenPrsError::GitHub(crate::github_client::GitHubError::ApiError {
            status: 403,
            message: "Forbidden".to_string(),
        });
        assert!(forbidden.should_increment_rate_limit_count());

        let non_rate_limited = SyncOpenPrsError::Db("boom".to_string());
        assert!(!non_rate_limited.should_increment_rate_limit_count());
    }

    #[test]
    fn test_find_matching_task_ids_direct_match_in_title() {
        let pr_title = "Fix bug T-42";
        let pr_branch = "main";
        let task_ids = vec!["T-42".to_string(), "T-99".to_string()];

        let matched = find_matching_task_ids(pr_title, pr_branch, &task_ids);
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0], "T-42");
    }

    #[test]
    fn test_find_matching_task_ids_direct_match_in_branch() {
        let pr_title = "Fix authentication";
        let pr_branch = "feature/T-99-auth";
        let task_ids = vec!["T-42".to_string(), "T-99".to_string()];

        let matched = find_matching_task_ids(pr_title, pr_branch, &task_ids);
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0], "T-99");
    }

    #[test]
    fn test_find_matching_task_ids_deduplication() {
        let pr_title = "T-5 implements feature";
        let pr_branch = "feature/T-5";
        let task_ids = vec!["T-5".to_string()];
        let matched = find_matching_task_ids(pr_title, pr_branch, &task_ids);
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0], "T-5");
    }

    #[test]
    fn test_find_matching_task_ids_no_matches() {
        let pr_title = "Update documentation";
        let pr_branch = "docs-update";
        let task_ids = vec!["T-100".to_string()];

        let matched = find_matching_task_ids(pr_title, pr_branch, &task_ids);
        assert_eq!(matched.len(), 0);
    }

    #[test]
    fn test_find_matching_task_ids_no_substring_false_positive() {
        let pr_title = "Fix T-12 issue";
        let pr_branch = "feature/T-123";
        let task_ids = vec!["T-1".to_string(), "T-12".to_string(), "T-123".to_string()];
        let matched = find_matching_task_ids(pr_title, pr_branch, &task_ids);
        // T-1 must NOT match (T-12 contains T-1 as substring, but boundary check prevents it)
        assert!(!matched.contains(&"T-1".to_string()));
        // T-12 SHOULD match in title
        assert!(matched.contains(&"T-12".to_string()));
        // T-123 SHOULD match in branch
        assert!(matched.contains(&"T-123".to_string()));
    }

    #[test]
    fn test_find_matching_task_ids_boundary_cases() {
        let task_ids = vec!["T-42".to_string()];

        // Start of string
        assert_eq!(
            find_matching_task_ids("T-42 fix auth", "", &task_ids).len(),
            1
        );
        // End of string
        assert_eq!(
            find_matching_task_ids("fix auth T-42", "", &task_ids).len(),
            1
        );
        // Slash-delimited
        assert_eq!(
            find_matching_task_ids("", "feature/T-42/auth", &task_ids).len(),
            1
        );
        // Hyphen after number (OK — not a digit)
        assert_eq!(
            find_matching_task_ids("", "feature/T-42-auth", &task_ids).len(),
            1
        );
        // Colon-delimited
        assert_eq!(
            find_matching_task_ids("T-42: fix auth", "", &task_ids).len(),
            1
        );
        // Alphanumeric before T — should NOT match
        assert_eq!(find_matching_task_ids("fixT-42bug", "", &task_ids).len(), 0);
    }

    #[test]
    fn test_find_matching_task_ids_multiple_ids_in_title() {
        let pr_title = "Fix T-1 and T-2";
        let pr_branch = "";
        let task_ids = vec!["T-1".to_string(), "T-2".to_string()];
        let matched = find_matching_task_ids(pr_title, pr_branch, &task_ids);
        assert_eq!(matched.len(), 2);
        assert!(matched.contains(&"T-1".to_string()));
        assert!(matched.contains(&"T-2".to_string()));
    }

    #[test]
    fn test_find_authoritative_task_id_prefers_branch_match_over_title_match() {
        let task_ids = vec!["T-2".to_string(), "T-1".to_string()];

        let matched = find_authoritative_task_id("Fix T-2", "feature/T-1-auth", &task_ids);

        assert_eq!(matched.as_deref(), Some("T-1"));
    }

    #[test]
    fn test_find_authoritative_task_id_uses_unique_title_match_when_branch_has_none() {
        let task_ids = vec!["T-2".to_string(), "T-1".to_string(), "T-3".to_string()];

        let matched = find_authoritative_task_id("Fix T-3", "feature/auth", &task_ids);

        assert_eq!(matched.as_deref(), Some("T-3"));
    }

    #[test]
    fn test_find_authoritative_task_id_rejects_ambiguous_title_matches() {
        let task_ids = vec!["T-2".to_string(), "T-1".to_string()];

        let matched = find_authoritative_task_id("Fix T-1 before T-2", "feature/auth", &task_ids);

        assert_eq!(matched, None);
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

    #[test]
    fn test_should_fetch_comments_for_pr_uses_changed_pr_subset() {
        let changed_pr_numbers = HashSet::from([11]);

        assert!(!should_fetch_comments_for_pr(10, &changed_pr_numbers));
        assert!(should_fetch_comments_for_pr(11, &changed_pr_numbers));
    }

    #[test]
    fn test_should_fetch_comments_for_pr_falls_back_to_all_prs_without_events() {
        let changed_pr_numbers = HashSet::new();

        assert!(should_fetch_comments_for_pr(20, &changed_pr_numbers));
        assert!(should_fetch_comments_for_pr(21, &changed_pr_numbers));
    }

    #[test]
    fn test_poller_uses_managed_github_client() {
        let managed_client = GitHubClient::new();
        let app = mock_builder()
            .manage(managed_client.clone())
            .build(mock_context(noop_assets()))
            .expect("mock app should build");

        let state_client = app.state::<GitHubClient>();
        let poller_client = state_client.inner();

        assert!(poller_client.shares_cache_with(&managed_client));
    }

    #[test]
    fn test_poll_result_rate_limited_true_with_reset_timestamp() {
        let result = PollResult {
            new_comments: 5,
            ci_changes: 0,
            review_changes: 0,
            pr_changes: 0,
            errors: 0,
            rate_limited: true,
            rate_limit_reset_at: Some(1704067200),
        };

        assert!(result.rate_limited);
        assert_eq!(result.rate_limit_reset_at, Some(1704067200));
    }

    #[test]
    fn test_poll_result_rate_limited_with_changes_can_coexist() {
        // This test verifies that rate_limited=true and new_comments>0 can both be true
        // (the confusing case where a cycle detects rate limit but still has changes)
        let result = PollResult {
            new_comments: 3,
            ci_changes: 1,
            review_changes: 0,
            pr_changes: 0,
            errors: 0,
            rate_limited: true,
            rate_limit_reset_at: Some(1704067200),
        };

        // Verify both conditions are true simultaneously
        assert!(result.rate_limited);
        assert!(result.new_comments > 0);
        assert!(result.ci_changes > 0);
        assert_eq!(result.rate_limit_reset_at, Some(1704067200));
    }

    #[test]
    fn test_poll_result_rate_limited_false_when_no_reset_detected() {
        let result = PollResult {
            new_comments: 2,
            ci_changes: 0,
            review_changes: 0,
            pr_changes: 0,
            errors: 0,
            rate_limited: false,
            rate_limit_reset_at: None,
        };

        assert!(!result.rate_limited);
        assert_eq!(result.rate_limit_reset_at, None);
    }

    fn make_review_body_poll_result(pr_id: i64) -> PollSinglePrResult {
        let review = PrReview {
            id: 42,
            user: crate::github_client::GitHubUser {
                login: "reviewer".to_string(),
                extra: serde_json::json!({}),
            },
            state: "COMMENTED".to_string(),
            body: Some("Looks good overall".to_string()),
            submitted_at: Some("2024-01-01T00:00:00Z".to_string()),
            extra: serde_json::json!({}),
        };

        PollSinglePrResult {
            pr_id,
            ticket_id: "T-100".to_string(),
            pr_title: "Review body test".to_string(),
            head_sha: "abc123".to_string(),
            old_ci_status: None,
            old_review_status: None,
            comments: vec![PrComment {
                id: -review.id,
                body: review.body.clone().expect("review body should exist"),
                user: review.user.clone(),
                path: None,
                line: None,
                comment_type: "review_body".to_string(),
                created_at: review
                    .submitted_at
                    .clone()
                    .expect("submitted_at should exist"),
            }],
            check_runs: None,
            combined_status: None,
            reviews: Some(vec![review]),
            has_requested_reviewers: false,
            mergeable: None,
            mergeable_state: None,
            is_queued: false,
            required_check_names: vec![],
            required_approving_count: None,
            error: None,
        }
    }

    #[test]
    fn test_persist_polled_comments_does_not_fail_when_review_body_exists_in_both_sources() {
        let (db, path) = make_test_db("persist_polled_comments_review_body_once");
        insert_test_task(&db);
        db.insert_pull_request(
            42,
            "T-100",
            "acme",
            "repo",
            "Review body test",
            "https://example.com/pr/42",
            "open",
            1000,
            1000,
            false,
        )
        .expect("insert pr failed");

        let result = make_review_body_poll_result(42);
        let existing_ids = db
            .get_existing_comment_ids(42)
            .expect("get existing ids failed");
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app should build");
        let app_handle = app.handle().clone();

        let persist_result =
            persist_polled_comments(&app_handle, &db, &result, &existing_ids, 1000);
        let comments = db.get_comments_for_pr(42).expect("get comments failed");

        assert_eq!(persist_result.failed_insert_count, 0);
        assert_eq!(persist_result.new_comment_count, 1);
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, -42);
        assert_eq!(comments[0].comment_type, "review_body");

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_persist_polled_comments_is_idempotent_across_poll_cycles_for_review_bodies() {
        let (db, path) = make_test_db("persist_polled_comments_review_body_idempotent");
        insert_test_task(&db);
        db.insert_pull_request(
            84,
            "T-100",
            "acme",
            "repo",
            "Review body test",
            "https://example.com/pr/84",
            "open",
            1000,
            1000,
            false,
        )
        .expect("insert pr failed");

        let result = make_review_body_poll_result(84);
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app should build");
        let app_handle = app.handle().clone();

        let first_existing_ids = db
            .get_existing_comment_ids(84)
            .expect("get initial existing ids failed");
        let first_persist = persist_polled_comments(
            &app_handle,
            &db,
            &result,
            &first_existing_ids,
            1000,
        );

        let second_existing_ids = db
            .get_existing_comment_ids(84)
            .expect("get second existing ids failed");
        let second_persist = persist_polled_comments(
            &app_handle,
            &db,
            &result,
            &second_existing_ids,
            1000,
        );

        let comments = db.get_comments_for_pr(84).expect("get comments failed");

        assert_eq!(first_persist.failed_insert_count, 0);
        assert_eq!(first_persist.new_comment_count, 1);
        assert_eq!(second_persist.failed_insert_count, 0);
        assert_eq!(second_persist.new_comment_count, 0);
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, -42);

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_persist_polled_comments_deduplicates_repeated_ids_within_batch() {
        let (db, path) = make_test_db("persist_polled_comments_batch_dedup");
        insert_test_task(&db);
        db.insert_pull_request(
            126,
            "T-100",
            "acme",
            "repo",
            "Review body test",
            "https://example.com/pr/126",
            "open",
            1000,
            1000,
            false,
        )
        .expect("insert pr failed");

        let mut result = make_review_body_poll_result(126);
        result.comments.push(
            result
                .comments
                .first()
                .expect("review body comment should exist")
                .clone(),
        );

        let existing_ids = db
            .get_existing_comment_ids(126)
            .expect("get existing ids failed");
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app should build");
        let app_handle = app.handle().clone();

        let persist_result =
            persist_polled_comments(&app_handle, &db, &result, &existing_ids, 1000);
        let comments = db.get_comments_for_pr(126).expect("get comments failed");

        assert_eq!(persist_result.failed_insert_count, 0);
        assert_eq!(persist_result.new_comment_count, 1);
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, -42);

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_poll_phase_error_rate_limit_detection_uses_typed_github_error() {
        let rate_limited = PollPhaseError::GitHub(crate::github_client::GitHubError::ApiError {
            status: 429,
            message: "Too Many Requests".to_string(),
        });
        assert!(rate_limited.should_increment_rate_limit_count());

        let forbidden = PollPhaseError::GitHub(crate::github_client::GitHubError::ApiError {
            status: 403,
            message: "Forbidden".to_string(),
        });
        assert!(!forbidden.should_increment_rate_limit_count());

        let non_rate_limited = PollPhaseError::Db("boom".to_string());
        assert!(!non_rate_limited.should_increment_rate_limit_count());
    }

    #[test]
    fn test_count_poll_phase_error_increments_total_errors_and_rate_limit_count_on_failure() {
        let mut total_errors = 0;
        let mut rate_limit_count = 0;

        count_poll_phase_error(
            "review PRs",
            Err(PollPhaseError::GitHub(
                crate::github_client::GitHubError::ApiError {
                    status: 429,
                    message: "Too Many Requests".to_string(),
                },
            )),
            &mut total_errors,
            &mut rate_limit_count,
        );
        count_poll_phase_error(
            "authored PRs",
            Err(PollPhaseError::Db("boom".to_string())),
            &mut total_errors,
            &mut rate_limit_count,
        );

        assert_eq!(total_errors, 2);
        assert_eq!(rate_limit_count, 1);
    }

    #[test]
    fn test_count_poll_phase_error_leaves_counters_unchanged_on_success() {
        let mut total_errors = 3;
        let mut rate_limit_count = 2;

        count_poll_phase_error(
            "review PRs",
            Ok(()),
            &mut total_errors,
            &mut rate_limit_count,
        );

        assert_eq!(total_errors, 3);
        assert_eq!(rate_limit_count, 2);
    }

    #[test]
    fn test_parse_poll_interval_seconds_defaults_to_seed_value_when_missing() {
        assert_eq!(parse_poll_interval_seconds(None), 60);
    }

    #[test]
    fn test_parse_poll_interval_seconds_defaults_to_seed_value_when_invalid() {
        assert_eq!(
            parse_poll_interval_seconds(Some("not-a-number".to_string())),
            60
        );
    }

    #[test]
    fn test_parse_poll_interval_seconds_uses_configured_value_when_valid() {
        assert_eq!(parse_poll_interval_seconds(Some("45".to_string())), 45);
    }

    #[test]
    fn test_parse_poll_interval_seconds_clamps_zero_to_minimum_supported_value() {
        assert_eq!(parse_poll_interval_seconds(Some("0".to_string())), 15);
    }

    #[test]
    fn test_parse_poll_interval_seconds_clamps_below_minimum_supported_value() {
        assert_eq!(parse_poll_interval_seconds(Some("10".to_string())), 15);
    }

    #[test]
    fn test_parse_poll_interval_seconds_clamps_above_maximum_supported_value() {
        assert_eq!(parse_poll_interval_seconds(Some("301".to_string())), 300);
    }
}
