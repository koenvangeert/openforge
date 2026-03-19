//! JIRA Sync Service
//!
//! Background Tokio task that polls JIRA every N seconds, refreshes JIRA info on tasks
//! that have JIRA links, and emits Tauri events to notify the frontend.
//!
//! ## Architecture
//! - Spawned as background task in main.rs setup hook
//! - Reads JIRA credentials from global config table
//! - Iterates all projects and queries tasks with JIRA links
//! - Fetches JIRA issue data for those specific keys
//! - Updates JIRA status and assignee fields in database (read-only display info)
//! - Emits `jira-sync-complete` event to frontend
//! - Sleeps for poll_interval seconds, then loops
//!
//! ## Error Handling
//! - Logs errors and continues (doesn't crash the sync loop)
//! - Individual ticket errors don't stop the batch
//! - Network errors trigger retry on next cycle

use crate::db::Database;
use crate::jira_client::JiraClient;
use log::{error, info, warn};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{sleep, Duration};

/// Start the JIRA sync background task
///
/// This function spawns a Tokio task that runs indefinitely, iterating all projects
/// and syncing JIRA info for projects that have JIRA configuration.
///
/// # Arguments
/// * `app` - Tauri AppHandle for accessing managed state and emitting events
///
/// # Example
/// ```no_run
/// // In main.rs setup hook:
/// tauri::async_runtime::spawn(start_jira_sync(app.handle().clone()));
/// ```
pub async fn start_jira_sync(app: AppHandle) {
    let jira_client = JiraClient::new();

    loop {
        let db = app.state::<Arc<Mutex<Database>>>();
        
        let poll_interval = {
            let db_lock = db.lock().unwrap();
            db_lock
                .get_config("jira_poll_interval")
                .ok()
                .flatten()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(60)
        };

        let jira_api_token = crate::secure_store::get_secret("jira_api_token")
            .unwrap_or(None)
            .unwrap_or_default();
        let (jira_base_url, jira_username) = {
            let db_lock = db.lock().unwrap();
            let base_url = db_lock
                .get_config("jira_base_url")
                .ok()
                .flatten()
                .unwrap_or_default();
            let username = db_lock
                .get_config("jira_username")
                .ok()
                .flatten()
                .unwrap_or_default();
            (base_url, username)
        };

        if jira_base_url.is_empty() || jira_api_token.is_empty() {
            info!("[JIRA Sync] JIRA credentials not configured, sleeping");
            sleep(Duration::from_secs(poll_interval)).await;
            continue;
        }

        let projects_result = {
            let db_lock = db.lock().unwrap();
            db_lock.get_all_projects()
        };

        let projects = match projects_result {
            Ok(projects) => projects,
            Err(e) => {
                error!("[JIRA Sync] Failed to get projects: {}", e);
                sleep(Duration::from_secs(poll_interval)).await;
                continue;
            }
        };

        if projects.is_empty() {
            info!("[JIRA Sync] No projects found, sleeping");
            sleep(Duration::from_secs(poll_interval)).await;
            continue;
        }

        let mut total_updated = 0;

        for project in projects {

            let tasks_result = {
                let db_lock = db.lock().unwrap();
                db_lock.get_tasks_for_project(&project.id)
            };

            let jira_keys: Vec<String> = match tasks_result {
                Ok(tasks) => tasks
                    .into_iter()
                    .filter_map(|t| t.jira_key)
                    .collect::<HashSet<_>>()
                    .into_iter()
                    .collect(),
                Err(e) => {
                    warn!(
                        "[JIRA Sync] Failed to get tasks for project {}: {}",
                        project.id, e
                    );
                    continue;
                }
            };

            if jira_keys.is_empty() {
                info!(
                    "[JIRA Sync] No tasks with JIRA links for project {}, skipping",
                    project.id
                );
                continue;
            }

            let jql = format!(
                "key IN ({}) ORDER BY updated DESC",
                jira_keys
                    .iter()
                    .map(|k| format!("\"{}\"", k))
                    .collect::<Vec<_>>()
                    .join(",")
            );
            info!(
                "[JIRA Sync] Refreshing JIRA info for project {} with JQL: {}",
                project.id, jql
            );

            match jira_client
                .search_issues(
                    &jira_base_url,
                    &jira_username,
                    &jira_api_token,
                    &jql,
                )
                .await
            {
                Ok(issues) => {
                    let mut updated = 0;
                    for issue in issues {
                        let jira_title = issue.fields.summary.clone();
                        let jira_status = issue
                            .fields
                            .status
                            .as_ref()
                            .map(|s| s.name.clone())
                            .unwrap_or_default();
                        let assignee = issue
                            .fields
                            .assignee
                            .as_ref()
                            .map(|u| u.display_name.clone())
                            .unwrap_or_default();
                        let jira_description = issue.rendered_fields
                            .as_ref()
                            .and_then(|rf| rf.description.clone())
                            .unwrap_or_default();

                        let db_lock = db.lock().unwrap();
                        match db_lock.update_task_jira_info(&issue.key, &jira_title, &jira_status, &assignee, &jira_description) {
                            Ok(count) => updated += count,
                            Err(e) => {
                                warn!("[JIRA Sync] Failed to update {}: {}", issue.key, e)
                            }
                        }
                        drop(db_lock);
                    }

                    info!(
                        "[JIRA Sync] Updated JIRA info for {} tasks in project {}",
                        updated, project.id
                    );
                    total_updated += updated;
                }
                Err(e) => error!(
                    "[JIRA Sync] Failed to fetch issues for project {}: {}",
                    project.id, e
                ),
            }
        }

        if total_updated > 0 {
            info!(
                "[JIRA Sync] Total updated: {} tasks across all projects",
                total_updated
            );
            if let Err(e) = app.emit("jira-sync-complete", ()) {
                warn!("[JIRA Sync] Failed to emit event: {}", e);
            }
        }

        sleep(Duration::from_secs(poll_interval)).await;
    }
}

