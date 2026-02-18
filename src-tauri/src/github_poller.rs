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
//!   - Inserts NEW comments only (checks if comment id exists)
//!   - Emits `new-pr-comment` event with ticket_id and comment_id
//!   - Triggers worktree cleanup on PR merge/close
//! - Sleeps for poll_interval seconds, then loops
//!
//! ## Worktree Cleanup
//! - When PR state changes to "merged" or "closed":
//!   - Spawns async cleanup task (non-blocking)
//!   - Removes worktree via git_worktree::remove_worktree()
//!   - Deletes database record via db.delete_worktree_record()
//!   - Emits `worktree-cleaned` event with task_id
//!
//! ## Error Handling
//! - Logs errors and continues (doesn't crash the polling loop)
//! - Individual PR errors don't stop the batch
//! - Network errors trigger retry on next cycle
//! - Skips projects with missing GitHub config

use crate::db::{Database, PrRow};
use crate::github_client::GitHubClient;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{sleep, Duration};

pub async fn start_github_poller(app: AppHandle) {
    let github_client = GitHubClient::new();

    loop {
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
            sleep(Duration::from_secs(60)).await;
            continue;
        }

        let projects = {
            let db_lock = db.lock().unwrap();
            db_lock.get_all_projects()
        };

        let projects = match projects {
            Ok(projects) => projects,
            Err(e) => {
                eprintln!("[GitHub Poller] Failed to get projects: {}", e);
                sleep(Duration::from_secs(60)).await;
                continue;
            }
        };

        if projects.is_empty() {
            sleep(Duration::from_secs(60)).await;
            continue;
        }

        println!("[GitHub Poller] Polling {} projects for PR updates...", projects.len());

        let mut total_new_comments = 0;
        let mut total_errors = 0;

        for project in projects {
            let config = match read_project_config(&db, &project.id) {
                Ok(Some(cfg)) => cfg,
                Ok(None) => {
                    continue;
                }
                Err(e) => {
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

            if let Err(e) = sync_open_prs(&github_client, &db, &app, &config, &github_token).await {
                eprintln!(
                    "[GitHub Poller] Failed to sync PRs for project {}: {}",
                    project.id, e
                );
                total_errors += 1;
                continue;
            }

            let open_prs = match get_open_prs_for_project(&db, &project.id) {
                Ok(prs) => prs,
                Err(e) => {
                    eprintln!(
                        "[GitHub Poller] Failed to get PRs for project {}: {}",
                        project.id, e
                    );
                    total_errors += 1;
                    continue;
                }
            };

            for pr in open_prs {
                match poll_pr_comments(&github_client, &db, &app, &github_token, &pr).await {
                    Ok(count) => total_new_comments += count,
                    Err(e) => {
                        eprintln!(
                            "[GitHub Poller] Failed to poll PR {}/{} #{}: {}",
                            pr.repo_owner, pr.repo_name, pr.id, e
                        );
                        total_errors += 1;
                    }
                }
            }
        }

        if total_new_comments > 0 || total_errors > 0 {
            println!(
                "[GitHub Poller] Found {} new comments ({} errors)",
                total_new_comments, total_errors
            );
        }

        sleep(Duration::from_secs(30)).await;
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

    if let Err(e) = crate::git_worktree::remove_worktree(repo_path, worktree_path).await {
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

    if let Err(e) = app.emit("worktree-cleaned", task_id) {
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
        return Err("github_default_repo must be in format 'owner/repo'".to_string());
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

    for closed_pr in closed_prs {
        let task_id = closed_pr.ticket_id.clone();
        let app_clone = app.clone();

        tokio::spawn(async move {
            let db_state = app_clone.state::<Mutex<Database>>();
            if let Err(e) = cleanup_worktree_for_task(&db_state, &app_clone, &task_id).await {
                eprintln!(
                    "[GitHub Poller] Failed to cleanup worktree for task {}: {}",
                    task_id, e
                );
            }
        });
    }

    {
        let db_lock = db.lock().unwrap();
        db_lock
            .close_stale_open_prs(repo_owner, repo_name, &open_pr_ids)
            .map_err(|e| format!("Failed to close stale PRs: {}", e))?;
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
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

async fn poll_pr_comments(
    github_client: &GitHubClient,
    db: &Mutex<Database>,
    app: &AppHandle,
    github_token: &str,
    pr: &PrRow,
) -> Result<usize, String> {
    let comments = github_client
        .get_pr_comments(&pr.repo_owner, &pr.repo_name, pr.id, github_token)
        .await
        .map_err(|e| format!("Failed to fetch comments: {}", e))?;

    let mut new_count = 0;

    // Insert new comments
    for comment in comments {
        // Check if comment already exists
        let exists = {
            let db_lock = db.lock().unwrap();
            db_lock
                .comment_exists(comment.id)
                .map_err(|e| format!("Failed to check comment existence: {}", e))?
        };

        if exists {
            continue; // Skip existing comments
        }

        // Parse created_at timestamp (ISO 8601 format)
        let created_at = parse_github_timestamp(&comment.created_at).unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64
        });

        // Insert new comment
        {
            let db_lock = db.lock().unwrap();
            db_lock
                .insert_pr_comment(
                    comment.id,
                    pr.id,
                    &comment.user.login,
                    &comment.body,
                    &comment.comment_type,
                    comment.path.as_deref(),
                    comment.line,
                    created_at,
                )
                .map_err(|e| format!("Failed to insert comment: {}", e))?;
        }

        // Emit event to notify frontend
        if let Err(e) = app.emit(
            "new-pr-comment",
            serde_json::json!({
                "ticket_id": pr.ticket_id,
                "comment_id": comment.id
            }),
        ) {
            eprintln!("[GitHub Poller] Failed to emit event: {}", e);
        }

        new_count += 1;
    }

    Ok(new_count)
}

/// Parse GitHub timestamp (ISO 8601) to Unix timestamp
///
/// Example: "2024-01-01T00:00:00Z" -> 1704067200
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
}
