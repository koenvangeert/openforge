// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod opencode_client;
mod jira_client;
mod jira_sync;
mod github_client;
mod github_poller;
mod git_worktree;
mod server_manager;
mod sse_bridge;
mod agent_coordinator;

use std::sync::Mutex;
use tauri::{Manager, State, Emitter};
use opencode_client::OpenCodeClient;
use jira_client::JiraClient;
use github_client::GitHubClient;

// ============================================================================
// Tauri Commands
// ============================================================================

/// Get OpenCode server status and API URL
#[tauri::command]
async fn get_opencode_status(
    client: State<'_, OpenCodeClient>,
) -> Result<OpenCodeStatus, String> {
    let health = client
        .health()
        .await
        .map_err(|e| format!("Health check failed: {}", e))?;
    
    Ok(OpenCodeStatus {
        api_url: "http://127.0.0.1:4096".to_string(),
        healthy: health.healthy,
        version: health.version,
    })
}

/// Create a new OpenCode session
#[tauri::command]
async fn create_session(
    client: State<'_, OpenCodeClient>,
    title: String,
) -> Result<String, String> {
    client
        .create_session(title)
        .await
        .map_err(|e| format!("Failed to create session: {}", e))
}

/// Send a prompt to an OpenCode session
#[tauri::command]
async fn send_prompt(
    client: State<'_, OpenCodeClient>,
    session_id: String,
    text: String,
) -> Result<serde_json::Value, String> {
    client
        .send_prompt(&session_id, text)
        .await
        .map_err(|e| format!("Failed to send prompt: {}", e))
}

/// Get all tasks from the database
#[tauri::command]
async fn get_tasks(
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<db::TaskRow>, String> {
    let db = db.lock().unwrap();
    match db.get_all_tasks() {
        Ok(tasks) => {
            println!("[get_tasks] Returning {} tasks", tasks.len());
            Ok(tasks)
        }
        Err(e) => {
            eprintln!("[get_tasks] Error: {}", e);
            Err(format!("Failed to get tasks: {}", e))
        }
    }
}

#[tauri::command]
async fn get_task_detail(
    db: State<'_, Mutex<db::Database>>,
    task_id: String,
) -> Result<db::TaskRow, String> {
    let db = db.lock().unwrap();
    db.get_task(&task_id)
        .map_err(|e| format!("Failed to get task: {}", e))?
        .ok_or_else(|| format!("Task {} not found", task_id))
}

#[tauri::command]
async fn update_task_fields(
    db: State<'_, Mutex<db::Database>>,
    task_id: String,
    acceptance_criteria: String,
    plan_text: String,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.update_task_fields(
        &task_id,
        Some(&acceptance_criteria),
        Some(&plan_text),
    )
    .map_err(|e| format!("Failed to update task fields: {}", e))
}

#[tauri::command]
async fn create_task(
    db: State<'_, Mutex<db::Database>>,
    title: String,
    description: String,
    status: String,
    jira_key: Option<String>,
    project_id: Option<String>,
) -> Result<db::TaskRow, String> {
    let db = db.lock().unwrap();
    db.create_task(&title, Some(&description), &status, jira_key.as_deref(), project_id.as_deref())
        .map_err(|e| format!("Failed to create task: {}", e))
}

#[tauri::command]
async fn update_task(
    db: State<'_, Mutex<db::Database>>,
    id: String,
    title: String,
    description: String,
    jira_key: Option<String>,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.update_task(&id, &title, Some(&description), jira_key.as_deref())
        .map_err(|e| format!("Failed to update task: {}", e))
}

#[tauri::command]
async fn update_task_status(
    db: State<'_, Mutex<db::Database>>,
    id: String,
    status: String,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.update_task_status(&id, &status)
        .map_err(|e| format!("Failed to update task status: {}", e))
}

#[tauri::command]
async fn delete_task(
    db: State<'_, Mutex<db::Database>>,
    id: String,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.delete_task(&id)
        .map_err(|e| format!("Failed to delete task: {}", e))
}

// ============================================================================
// Project Management Commands
// ============================================================================

#[tauri::command]
async fn create_project(
    db: State<'_, Mutex<db::Database>>,
    name: String,
    path: String,
) -> Result<db::ProjectRow, String> {
    let db = db.lock().unwrap();
    db.create_project(&name, &path)
        .map_err(|e| format!("Failed to create project: {}", e))
}

#[tauri::command]
async fn get_projects(
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<db::ProjectRow>, String> {
    let db = db.lock().unwrap();
    db.get_all_projects()
        .map_err(|e| format!("Failed to get projects: {}", e))
}

#[tauri::command]
async fn update_project(
    db: State<'_, Mutex<db::Database>>,
    id: String,
    name: String,
    path: String,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.update_project(&id, &name, &path)
        .map_err(|e| format!("Failed to update project: {}", e))
}

#[tauri::command]
async fn delete_project(
    db: State<'_, Mutex<db::Database>>,
    id: String,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.delete_project(&id)
        .map_err(|e| format!("Failed to delete project: {}", e))
}

#[tauri::command]
async fn get_project_config(
    db: State<'_, Mutex<db::Database>>,
    project_id: String,
    key: String,
) -> Result<Option<String>, String> {
    let db = db.lock().unwrap();
    db.get_project_config(&project_id, &key)
        .map_err(|e| format!("Failed to get project config: {}", e))
}

#[tauri::command]
async fn set_project_config(
    db: State<'_, Mutex<db::Database>>,
    project_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.set_project_config(&project_id, &key, &value)
        .map_err(|e| format!("Failed to set project config: {}", e))
}

#[tauri::command]
async fn get_tasks_for_project(
    db: State<'_, Mutex<db::Database>>,
    project_id: String,
) -> Result<Vec<db::TaskRow>, String> {
    let db = db.lock().unwrap();
    db.get_tasks_for_project(&project_id)
        .map_err(|e| format!("Failed to get tasks for project: {}", e))
}

#[tauri::command]
async fn get_worktree_for_task(
    db: State<'_, Mutex<db::Database>>,
    task_id: String,
) -> Result<Option<db::WorktreeRow>, String> {
    let db = db.lock().unwrap();
    db.get_worktree_for_task(&task_id)
        .map_err(|e| format!("Failed to get worktree for task: {}", e))
}

// ============================================================================
// Implementation Orchestration Commands
// ============================================================================

#[tauri::command]
async fn start_implementation(
    db: State<'_, Mutex<db::Database>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    sse_mgr: State<'_, sse_bridge::SseBridgeManager>,
    app: tauri::AppHandle,
    task_id: String,
    repo_path: String,
) -> Result<serde_json::Value, String> {
    let (task, project_id_owned) = {
        let db = db.lock().unwrap();
        let task = db.get_task(&task_id)
            .map_err(|e| format!("Failed to get task: {}", e))?
            .ok_or("Task not found")?;
        let project_id = task.project_id.clone().unwrap_or_default();
        (task, project_id)
    };
    
    let branch = git_worktree::slugify_branch_name(&task_id, &task.title);
    let home = dirs::home_dir().ok_or("Failed to get home directory")?;
    let repo_name = std::path::Path::new(&repo_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid repo path")?;
    let worktree_path = home
        .join(".ai-command-center")
        .join("worktrees")
        .join(repo_name)
        .join(&task_id);
    
    git_worktree::create_worktree(
        std::path::Path::new(&repo_path),
        &worktree_path,
        &branch,
        "HEAD",
    )
    .await
    .map_err(|e| e.to_string())?;
    
    {
        let db = db.lock().unwrap();
        db.create_worktree_record(
            &task_id,
            &project_id_owned,
            &repo_path,
            worktree_path.to_str().unwrap(),
            &branch,
        )
        .map_err(|e| e.to_string())?;
    }
    
    let port = server_mgr
        .spawn_server(&task_id, &worktree_path)
        .await
        .map_err(|e| e.to_string())?;
    
    {
        let db = db.lock().unwrap();
        db.update_worktree_server(&task_id, port as i64, 0)
            .map_err(|e| e.to_string())?;
    }
    
    sse_mgr
        .start_bridge(app.clone(), task_id.clone(), port)
        .await
        .map_err(|e| e.to_string())?;
    
    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    
    let opencode_session_id = client
        .create_session(format!("Task {}", task_id))
        .await
        .map_err(|e| format!("Failed to create session: {}", e))?;
    
    println!("[start_implementation] OpenCode session created: {} for task {} on port {}", opencode_session_id, task_id, port);

    let mut prompt = format!("You are working on task {}: {}\n\n", task_id, task.title);
    
    if let Some(ref description) = task.description {
        if !description.is_empty() {
            prompt.push_str(description);
            prompt.push_str("\n\n");
        }
    }
    
    if let Some(ref acceptance_criteria) = task.acceptance_criteria {
        if !acceptance_criteria.is_empty() {
            prompt.push_str("Acceptance Criteria:\n");
            prompt.push_str(acceptance_criteria);
            prompt.push_str("\n\n");
        }
    }
    
    if let Some(ref plan_text) = task.plan_text {
        if !plan_text.is_empty() {
            prompt.push_str("Plan:\n");
            prompt.push_str(plan_text);
            prompt.push_str("\n\n");
        }
    }
    
    prompt.push_str("Implement this task. Create a branch, make the changes, and create a pull request when done.");
    
    println!("[start_implementation] Sending prompt_async to opencode session {}", opencode_session_id);
    client
        .prompt_async(&opencode_session_id, prompt, None)
        .await
        .map_err(|e| format!("Failed to send prompt: {}", e))?;
    println!("[start_implementation] Prompt sent successfully to opencode session {}", opencode_session_id);
    
    let agent_session_id = uuid::Uuid::new_v4().to_string();
    {
        let db = db.lock().unwrap();
        db.create_agent_session(
            &agent_session_id,
            &task_id,
            Some(&opencode_session_id),
            "implementing",
            "running",
        )
        .map_err(|e| format!("Failed to create agent session: {}", e))?;
    }
    
    println!(
        "[start_implementation] Agent session created: {} (opencode: {}) for task {}",
        agent_session_id, opencode_session_id, task_id
    );

    Ok(serde_json::json!({
        "task_id": task_id,
        "worktree_path": worktree_path.to_str().unwrap(),
        "port": port,
        "session_id": agent_session_id,
    }))
}

#[tauri::command]
async fn abort_implementation(
    db: State<'_, Mutex<db::Database>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    sse_mgr: State<'_, sse_bridge::SseBridgeManager>,
    _app: tauri::AppHandle,
    task_id: String,
) -> Result<(), String> {
    let port = server_mgr.get_server_port(&task_id).await;
    if let Some(port) = port {
        let (session, opencode_session_id) = {
            let db_lock = db.lock().unwrap();
            let session = db_lock
                .get_latest_session_for_ticket(&task_id)
                .map_err(|e| format!("Failed to get session: {}", e))?;
            let opencode_session_id = session
                .as_ref()
                .and_then(|s| s.opencode_session_id.clone());
            (session, opencode_session_id)
        };
        
        if let Some(opencode_session_id) = opencode_session_id {
            let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
            let _ = client.abort_session(&opencode_session_id).await;
        }
        
        if let Some(session) = session {
            let db_lock = db.lock().unwrap();
            let _ = db_lock.update_agent_session(&session.id, "implementing", "failed", None, Some("Aborted by user"));
        }
    }
    
    sse_mgr.stop_bridge(&task_id).await;
    
    let _ = server_mgr.stop_server(&task_id).await;
    
    {
        let db = db.lock().unwrap();
        let _ = db.update_worktree_status(&task_id, "stopped");
    }
    
    Ok(())
}

// ============================================================================
// JIRA Integration Commands
// ============================================================================

#[tauri::command]
async fn refresh_jira_info(
    db: State<'_, Mutex<db::Database>>,
    jira_client: State<'_, JiraClient>,
) -> Result<usize, String> {
    let (jira_base_url, jira_username, jira_api_token) = {
        let db_lock = db.lock().unwrap();
        let base = db_lock.get_config("jira_base_url").map_err(|e| format!("{}", e))?.ok_or("jira_base_url not configured")?;
        let user = db_lock.get_config("jira_username").map_err(|e| format!("{}", e))?.ok_or("jira_username not configured")?;
        let token = db_lock.get_config("jira_api_token").map_err(|e| format!("{}", e))?.ok_or("jira_api_token not configured")?;
        (base, user, token)
    };

    let jira_keys: Vec<String> = {
        let db_lock = db.lock().unwrap();
        db_lock.get_tasks_with_jira_links()
            .map_err(|e| format!("Failed to get linked tasks: {}", e))?
            .into_iter()
            .filter_map(|t| t.jira_key)
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect()
    };

    if jira_keys.is_empty() {
        return Ok(0);
    }

    let jql = format!("key IN ({}) ORDER BY updated DESC", jira_keys.join(","));
    let issues = jira_client.search_issues(&jira_base_url, &jira_username, &jira_api_token, &jql).await
        .map_err(|e| format!("Failed to fetch JIRA issues: {}", e))?;

    let mut updated = 0;
    for issue in issues {
        let jira_status = issue.fields.status.as_ref().map(|s| s.name.clone()).unwrap_or_default();
        let assignee = issue.fields.assignee.as_ref().map(|u| u.display_name.clone()).unwrap_or_default();
        let db_lock = db.lock().unwrap();
        match db_lock.update_task_jira_info(&issue.key, &jira_status, &assignee) {
            Ok(count) => updated += count,
            Err(e) => eprintln!("Failed to update JIRA info for {}: {}", issue.key, e),
        }
        drop(db_lock);
    }
    Ok(updated)
}

#[tauri::command]
async fn poll_pr_comments_now(
    db: State<'_, Mutex<db::Database>>,
    github_client: State<'_, GitHubClient>,
    app: tauri::AppHandle,
) -> Result<usize, String> {
    let (github_token, github_default_repo) = {
        let db_lock = db.lock().unwrap();

        let github_token = db_lock
            .get_config("github_token")
            .map_err(|e| format!("Failed to read config: {}", e))?
            .unwrap_or_default();

        let github_default_repo = db_lock
            .get_config("github_default_repo")
            .map_err(|e| format!("Failed to read config: {}", e))?
            .unwrap_or_default();

        (github_token, github_default_repo)
    };

    if github_token.is_empty() {
        return Err("github_token not configured".to_string());
    }

    let parts: Vec<&str> = github_default_repo.split('/').collect();
    if parts.len() != 2 {
        return Err("github_default_repo must be in format 'owner/repo'".to_string());
    }
    let (repo_owner, repo_name) = (parts[0].to_string(), parts[1].to_string());

    let github_prs = github_client
        .list_open_prs(&repo_owner, &repo_name, &github_token)
        .await
        .map_err(|e| format!("Failed to list open PRs: {}", e))?;

    let ticket_ids = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_all_task_ids()
            .map_err(|e| format!("Failed to get task IDs: {}", e))?
    };

    let open_pr_ids: Vec<i64> = github_prs.iter().map(|pr| pr.number).collect();

    {
        let db_lock = db.lock().unwrap();
        db_lock
            .close_stale_open_prs(&repo_owner, &repo_name, &open_pr_ids)
            .map_err(|e| format!("Failed to close stale PRs: {}", e))?;
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    for pr in &github_prs {
        let matched_ticket = ticket_ids.iter().find(|tid| {
            pr.title.contains(tid.as_str()) || pr.head.ref_name.contains(tid.as_str())
        });
        if let Some(ticket_id) = matched_ticket {
            let db_lock = db.lock().unwrap();
            let _ = db_lock.insert_pull_request(
                pr.number,
                ticket_id,
                &repo_owner,
                &repo_name,
                &pr.title,
                &pr.html_url,
                &pr.state,
                now,
                now,
            );
        }
    }

    let open_prs = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_open_prs()
            .map_err(|e| format!("Failed to get open PRs: {}", e))?
    };

    let mut new_comment_count = 0;

    for pr in open_prs {
        let comments = github_client
            .get_pr_comments(&pr.repo_owner, &pr.repo_name, pr.id, &github_token)
            .await
            .map_err(|e| format!("Failed to fetch PR comments: {}", e))?;

        for comment in comments {
            let db_lock = db.lock().unwrap();
            let exists = db_lock
                .comment_exists(comment.id)
                .map_err(|e| format!("Failed to check comment existence: {}", e))?;

            if !exists {
                let created_at = chrono::DateTime::parse_from_rfc3339(&comment.created_at)
                    .map_err(|e| format!("Failed to parse timestamp: {}", e))?
                    .timestamp();

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

                new_comment_count += 1;

                let _ = app.emit("new-pr-comment", serde_json::json!({
                    "pr_id": pr.id,
                    "comment_id": comment.id,
                    "author": comment.user.login,
                    "body": comment.body,
                }));
            }
            drop(db_lock);
        }
    }

    Ok(new_comment_count)
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "linux")]
    let cmd = "xdg-open";
    #[cfg(target_os = "windows")]
    let cmd = "start";

    std::process::Command::new(cmd)
        .arg(&url)
        .spawn()
        .map_err(|e| format!("Failed to open URL: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn get_pull_requests(
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<db::PrRow>, String> {
    let db_lock = db.lock().unwrap();
    db_lock
        .get_all_pull_requests()
        .map_err(|e| format!("Failed to get pull requests: {}", e))
}

#[tauri::command]
async fn get_pr_comments(
    db: State<'_, Mutex<db::Database>>,
    pr_id: i64,
) -> Result<Vec<db::PrCommentRow>, String> {
    let db_lock = db.lock().unwrap();
    db_lock
        .get_comments_for_pr(pr_id)
        .map_err(|e| format!("Failed to get PR comments: {}", e))
}

/// Mark a PR comment as addressed
#[tauri::command]
async fn mark_comment_addressed(
    db: State<'_, Mutex<db::Database>>,
    comment_id: i64,
) -> Result<(), String> {
    let db_lock = db.lock().unwrap();
    db_lock
        .mark_comment_addressed(comment_id)
        .map_err(|e| format!("Failed to mark comment addressed: {}", e))
}

#[tauri::command]
async fn get_session_status(
    db: State<'_, Mutex<db::Database>>,
    session_id: String,
) -> Result<db::AgentSessionRow, String> {
    let db_lock = db.lock().unwrap();
    db_lock
        .get_agent_session(&session_id)
        .map_err(|e| format!("Failed to get session status: {}", e))?
        .ok_or_else(|| format!("Session {} not found", session_id))
}

#[tauri::command]
async fn abort_session(
    db: State<'_, Mutex<db::Database>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    sse_mgr: State<'_, sse_bridge::SseBridgeManager>,
    _app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    let task_id = {
        let db_lock = db.lock().unwrap();
        let session = db_lock
            .get_agent_session(&session_id)
            .map_err(|e| format!("Failed to get session: {}", e))?
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        session.ticket_id
    };
    
    let port = server_mgr.get_server_port(&task_id).await;
    if let Some(port) = port {
        let (session_opt, opencode_session_id) = {
            let db_lock = db.lock().unwrap();
            let session = db_lock
                .get_latest_session_for_ticket(&task_id)
                .map_err(|e| format!("Failed to get session: {}", e))?;
            let opencode_session_id = session
                .as_ref()
                .and_then(|s| s.opencode_session_id.clone());
            (session, opencode_session_id)
        };
        
        if let Some(opencode_session_id) = opencode_session_id {
            let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
            let _ = client.abort_session(&opencode_session_id).await;
        }
        
        if let Some(session) = session_opt {
            let db_lock = db.lock().unwrap();
            let _ = db_lock.update_agent_session(&session.id, "implementing", "failed", None, Some("Aborted by user"));
        }
    }
    
    sse_mgr.stop_bridge(&task_id).await;
    
    let _ = server_mgr.stop_server(&task_id).await;
    
    {
        let db = db.lock().unwrap();
        let _ = db.update_worktree_status(&task_id, "stopped");
    }
    
    Ok(())
}

/// Get agent logs for a session
#[tauri::command]
async fn get_agent_logs(
    db: State<'_, Mutex<db::Database>>,
    session_id: String,
) -> Result<Vec<db::AgentLogRow>, String> {
    let db_lock = db.lock().unwrap();
    db_lock.get_agent_logs(&session_id)
        .map_err(|e| format!("Failed to get agent logs: {}", e))
}

/// Check if OpenCode CLI is installed on the system
#[tauri::command]
async fn check_opencode_installed() -> Result<OpenCodeInstallStatus, String> {
    let output = std::process::Command::new("which")
        .arg("opencode")
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let version = std::process::Command::new("opencode")
                .arg("--version")
                .output()
                .ok()
                .and_then(|v| {
                    if v.status.success() {
                        Some(String::from_utf8_lossy(&v.stdout).trim().to_string())
                    } else {
                        None
                    }
                });
            Ok(OpenCodeInstallStatus {
                installed: true,
                path: Some(path),
                version,
            })
        }
        _ => Ok(OpenCodeInstallStatus {
            installed: false,
            path: None,
            version: None,
        }),
    }
}

#[tauri::command]
async fn get_config(
    db: State<'_, Mutex<db::Database>>,
    key: String,
) -> Result<Option<String>, String> {
    let db_lock = db.lock().unwrap();
    db_lock.get_config(&key)
        .map_err(|e| format!("Failed to get config: {}", e))
}

#[tauri::command]
async fn set_config(
    db: State<'_, Mutex<db::Database>>,
    key: String,
    value: String,
) -> Result<(), String> {
    let db_lock = db.lock().unwrap();
    db_lock.set_config(&key, &value)
        .map_err(|e| format!("Failed to set config: {}", e))
}

// ============================================================================
// Response Types
// ============================================================================

#[derive(serde::Serialize)]
struct OpenCodeStatus {
    api_url: String,
    healthy: bool,
    version: Option<String>,
}

#[derive(serde::Serialize)]
struct OpenCodeInstallStatus {
    installed: bool,
    path: Option<String>,
    version: Option<String>,
}

// ============================================================================
// Main
// ============================================================================

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            let db_path = app_data_dir.join("ai_command_center.db");

            println!("Initializing database at: {:?}", db_path);

            let database = db::Database::new(db_path).expect("Failed to initialize database");

            app.manage(Mutex::new(database));

            println!("Database initialized successfully");

            let jira_client = JiraClient::new();
            let github_client = GitHubClient::new();

            let opencode_client = OpenCodeClient::with_base_url("http://127.0.0.1:4096".to_string());

            let server_manager = server_manager::ServerManager::new();
            let sse_bridge_manager = sse_bridge::SseBridgeManager::new();

            app.manage(opencode_client);
            app.manage(jira_client);
            app.manage(github_client);
            app.manage(server_manager);
            app.manage(sse_bridge_manager);

            if let Err(e) = server_manager::ServerManager::new().cleanup_stale_pids() {
                eprintln!("Failed to cleanup stale PIDs: {}", e);
            }

            println!("Server manager initialized");

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                jira_sync::start_jira_sync(app_handle).await;
            });

            println!("JIRA sync task started");

            let app_handle_github = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                github_poller::start_github_poller(app_handle_github).await;
            });

            println!("GitHub poller task started");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_opencode_status,
            create_session,
            send_prompt,
            get_tasks,
            get_task_detail,
            update_task_fields,
            create_task,
            update_task,
            update_task_status,
            delete_task,
            create_project,
            get_projects,
            update_project,
            delete_project,
            get_project_config,
            set_project_config,
            get_tasks_for_project,
            get_worktree_for_task,
            start_implementation,
            abort_implementation,
            refresh_jira_info,
            poll_pr_comments_now,
            get_pull_requests,
            get_pr_comments,
            mark_comment_addressed,
            get_session_status,
            abort_session,
            get_agent_logs,
            open_url,
            get_config,
            set_config,
            check_opencode_installed
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
