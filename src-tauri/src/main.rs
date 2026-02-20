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
mod pty_manager;
mod agent_coordinator;
mod diff_parser;

use std::sync::Mutex;
use tauri::{Manager, State, Emitter};
use opencode_client::OpenCodeClient;
use jira_client::JiraClient;
use github_client::GitHubClient;
use base64::Engine as _;
use pty_manager::PtyManager;

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

/// Get list of available agents from OpenCode server
#[tauri::command]
async fn get_agents(
    client: State<'_, OpenCodeClient>,
) -> Result<Vec<opencode_client::AgentInfo>, String> {
    client
        .list_agents()
        .await
        .map_err(|e| format!("Failed to get agents: {}", e))
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
    db.get_all_tasks()
        .map_err(|e| format!("Failed to get tasks: {}", e))
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
async fn create_task(
    db: State<'_, Mutex<db::Database>>,
    app: tauri::AppHandle,
    title: String,
    status: String,
    jira_key: Option<String>,
    project_id: Option<String>,
) -> Result<db::TaskRow, String> {
    let db = db.lock().unwrap();
    let task = db.create_task(&title, &status, jira_key.as_deref(), project_id.as_deref())
        .map_err(|e| format!("Failed to create task: {}", e))?;
    let _ = app.emit("task-changed", serde_json::json!({ "action": "created", "task_id": task.id }));
    Ok(task)
}

#[tauri::command]
async fn update_task(
    db: State<'_, Mutex<db::Database>>,
    app: tauri::AppHandle,
    id: String,
    title: String,
    jira_key: Option<String>,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.update_task(&id, &title, jira_key.as_deref())
        .map_err(|e| format!("Failed to update task: {}", e))?;
    let _ = app.emit("task-changed", serde_json::json!({ "action": "updated", "task_id": id }));
    Ok(())
}

#[tauri::command]
async fn update_task_status(
    db: State<'_, Mutex<db::Database>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    sse_mgr: State<'_, sse_bridge::SseBridgeManager>,
    pty_mgr: State<'_, PtyManager>,
    app: tauri::AppHandle,
    id: String,
    status: String,
) -> Result<(), String> {
    {
        let db = db.lock().unwrap();
        db.update_task_status(&id, &status)
            .map_err(|e| format!("Failed to update task status: {}", e))?;
    }
    let _ = app.emit("task-changed", serde_json::json!({ "action": "updated", "task_id": id }));

    // Clean up worktree and associated processes when task moves to done
    if status == "done" {
        let _ = pty_mgr.kill_pty(&id).await;
        sse_mgr.stop_bridge(&id).await;
        let _ = server_mgr.stop_server(&id).await;

        let worktree = {
            let db_lock = db.lock().unwrap();
            db_lock
                .get_worktree_for_task(&id)
                .map_err(|e| format!("Failed to get worktree: {}", e))?
        };
        if let Some(worktree) = worktree {
            let repo_path = std::path::Path::new(&worktree.repo_path);
            let worktree_path = std::path::Path::new(&worktree.worktree_path);
            if let Err(e) = git_worktree::remove_worktree(repo_path, worktree_path).await {
                eprintln!(
                    "[update_task_status] Failed to remove worktree at {}: {}",
                    worktree_path.display(),
                    e
                );
            }

            let db_lock = db.lock().unwrap();
            if let Err(e) = db_lock.delete_worktree_record(&id) {
                eprintln!(
                    "[update_task_status] Failed to delete worktree record for {}: {}",
                    id, e
                );
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn delete_task(
    db: State<'_, Mutex<db::Database>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    sse_mgr: State<'_, sse_bridge::SseBridgeManager>,
    pty_mgr: State<'_, PtyManager>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let _ = pty_mgr.kill_pty(&id).await;
    sse_mgr.stop_bridge(&id).await;
    let _ = server_mgr.stop_server(&id).await;

    let worktree = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_worktree_for_task(&id)
            .map_err(|e| format!("Failed to get worktree: {}", e))?
    };
    if let Some(worktree) = worktree {
        let repo_path = std::path::Path::new(&worktree.repo_path);
        let worktree_path = std::path::Path::new(&worktree.worktree_path);
        if let Err(e) = git_worktree::remove_worktree_with_branch(repo_path, worktree_path, Some(&worktree.branch_name)).await {
            eprintln!(
                "[delete_task] Failed to remove worktree at {}: {}",
                worktree_path.display(),
                e
            );
        }
    }

    let db_lock = db.lock().unwrap();
    db_lock
        .delete_task(&id)
        .map_err(|e| format!("Failed to delete task: {}", e))?;
    let _ = app.emit("task-changed", serde_json::json!({ "action": "deleted", "task_id": id }));
    Ok(())
}

#[tauri::command]
async fn clear_done_tasks(
    db: State<'_, Mutex<db::Database>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    sse_mgr: State<'_, sse_bridge::SseBridgeManager>,
    pty_mgr: State<'_, PtyManager>,
    app: tauri::AppHandle,
    project_id: String,
) -> Result<u32, String> {
    let task_ids = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_task_ids_by_status(&project_id, "done")
            .map_err(|e| format!("Failed to get done tasks: {}", e))?
    };

    let mut deleted = 0u32;
    for id in &task_ids {
        let _ = pty_mgr.kill_pty(id).await;
        sse_mgr.stop_bridge(id).await;
        let _ = server_mgr.stop_server(id).await;

        let worktree = {
            let db_lock = db.lock().unwrap();
            db_lock
                .get_worktree_for_task(id)
                .map_err(|e| format!("Failed to get worktree: {}", e))?
        };
        if let Some(worktree) = worktree {
            let repo_path = std::path::Path::new(&worktree.repo_path);
            let worktree_path = std::path::Path::new(&worktree.worktree_path);
            if let Err(e) = git_worktree::remove_worktree_with_branch(
                repo_path,
                worktree_path,
                Some(&worktree.branch_name),
            )
            .await
            {
                eprintln!(
                    "[clear_done_tasks] Failed to remove worktree at {}: {}",
                    worktree_path.display(),
                    e
                );
            }
        }

        let db_lock = db.lock().unwrap();
        db_lock
            .delete_task(id)
            .map_err(|e| format!("Failed to delete task {}: {}", id, e))?;
        deleted += 1;
    }

    if deleted > 0 {
        let _ = app.emit(
            "task-changed",
            serde_json::json!({ "action": "cleared_done", "count": deleted }),
        );
    }

    Ok(deleted)
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

fn build_task_prompt(task: &db::TaskRow, action_instruction: &str, additional_instructions: Option<&str>) -> String {
    let mut prompt = String::new();
    
    if let Some(instructions) = additional_instructions {
        if !instructions.is_empty() {
            prompt.push_str(instructions);
            prompt.push_str("\n\n");
        }
    }
    
    prompt.push_str(&format!("You are working on task {}: {}\n\n", task.id, task.title));
    
    if let Some(ref plan_text) = task.plan_text {
        if !plan_text.is_empty() {
            prompt.push_str("Plan:\n");
            prompt.push_str(plan_text);
            prompt.push_str("\n\n");
        }
    }
    
    prompt.push_str(action_instruction);
    prompt
}

#[tauri::command]
async fn start_implementation(
    db: State<'_, Mutex<db::Database>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    sse_mgr: State<'_, sse_bridge::SseBridgeManager>,
    app: tauri::AppHandle,
    task_id: String,
    repo_path: String,
) -> Result<serde_json::Value, String> {
    let (task, project_id_owned, additional_instructions) = {
        let db = db.lock().unwrap();
        let task = db.get_task(&task_id)
            .map_err(|e| format!("Failed to get task: {}", e))?
            .ok_or("Task not found")?;
        let project_id = task.project_id.clone().unwrap_or_default();
        let instructions = db.get_project_config(&project_id, "additional_instructions")
            .ok()
            .flatten();
        (task, project_id, instructions)
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
        "origin/main",
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
    
    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    
    let opencode_session_id = client
        .create_session(format!("Task {}", task_id))
        .await
        .map_err(|e| format!("Failed to create session: {}", e))?;
    
    sse_mgr
        .start_bridge(app.clone(), task_id.clone(), Some(opencode_session_id.clone()), port)
        .await
        .map_err(|e| e.to_string())?;
    
    let prompt = build_task_prompt(&task, "Implement this task. Create a branch, make the changes, and create a pull request when done.", additional_instructions.as_deref());
    
    client
        .prompt_async(&opencode_session_id, prompt, None)
        .await
        .map_err(|e| format!("Failed to send prompt: {}", e))?;
    
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
    
    {
        let db = db.lock().unwrap();
        db.update_task_status(&task_id, "doing")
            .map_err(|e| format!("Failed to update task status: {}", e))?;
    }
    let _ = app.emit("task-changed", serde_json::json!({ "action": "updated", "task_id": task_id }));

    Ok(serde_json::json!({
        "task_id": task_id,
        "worktree_path": worktree_path.to_str().unwrap(),
        "port": port,
        "session_id": agent_session_id,
    }))
}

#[tauri::command]
async fn run_action(
    db: State<'_, Mutex<db::Database>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    sse_mgr: State<'_, sse_bridge::SseBridgeManager>,
    app: tauri::AppHandle,
    task_id: String,
    repo_path: String,
    action_prompt: String,
    agent: Option<String>,
) -> Result<serde_json::Value, String> {
    let (task, project_id_owned, additional_instructions) = {
        let db = db.lock().unwrap();
        let task = db.get_task(&task_id)
            .map_err(|e| format!("Failed to get task: {}", e))?
            .ok_or("Task not found")?;
        let project_id = task.project_id.clone().unwrap_or_default();
        let instructions = db.get_project_config(&project_id, "additional_instructions")
            .ok()
            .flatten();
        (task, project_id, instructions)
    };
    
    let existing_session = {
        let db = db.lock().unwrap();
        db.get_latest_session_for_ticket(&task_id)
            .map_err(|e| format!("Failed to get latest session: {}", e))?
    };
    
    if let Some(session) = existing_session {
        match session.status.as_str() {
            "running" => {
                return Err("Agent is busy".to_string());
            }
            "paused" => {
                return Err("Answer pending question first".to_string());
            }
            "completed" | "failed" | "interrupted" => {
                if let Some(port) = server_mgr.get_server_port(&task_id).await {
                    if let Some(ref opencode_session_id) = session.opencode_session_id {
                        {
                            let db = db.lock().unwrap();
                            let recheck_session = db.get_latest_session_for_ticket(&task_id)
                                .map_err(|e| format!("Failed to recheck session: {}", e))?;
                            if let Some(s) = recheck_session {
                                if s.status != "completed" && s.status != "failed" && s.status != "interrupted" {
                                    return Err("Session status changed, cannot reuse".to_string());
                                }
                            }
                        }
                        
                        let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
                        
                        let prompt = build_task_prompt(&task, &action_prompt, None);
                        
                        client
                            .prompt_async(opencode_session_id, prompt, agent.clone())
                            .await
                            .map_err(|e| format!("Failed to send prompt: {}", e))?;
                        
                        {
                            let db = db.lock().unwrap();
                            db.update_agent_session(&session.id, &session.stage, "running", None, None)
                                .map_err(|e| format!("Failed to update agent session: {}", e))?;
                        }
                        
                        match sse_mgr.start_bridge(app.clone(), task_id.clone(), Some(opencode_session_id.clone()), port).await {
                            Ok(_) => {},
                            Err(e) if e.to_string().contains("already running") => {},
                            Err(e) => return Err(e.to_string()),
                        }
                        
                        let worktree = {
                            let db = db.lock().unwrap();
                            db.get_worktree_for_task(&task_id)
                                .map_err(|e| format!("Failed to get worktree: {}", e))?
                        };
                        
                        let worktree_path = worktree
                            .map(|w| w.worktree_path)
                            .unwrap_or_default();
                        
                        // Auto-move task from backlog to doing when starting an action
                        if task.status == "backlog" {
                            let db = db.lock().unwrap();
                            db.update_task_status(&task_id, "doing")
                                .map_err(|e| format!("Failed to update task status: {}", e))?;
                            let _ = app.emit("task-changed", serde_json::json!({ "action": "updated", "task_id": task_id }));
                        }
                        
                        return Ok(serde_json::json!({
                            "task_id": task_id,
                            "session_id": session.id,
                            "worktree_path": worktree_path,
                            "port": port,
                        }));
                    }
                }
            }
            _ => {}
        }
    }
    
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
        "origin/main",
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
    
    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    
    let opencode_session_id = client
        .create_session(format!("Task {}", task_id))
        .await
        .map_err(|e| format!("Failed to create session: {}", e))?;
    
    sse_mgr
        .start_bridge(app.clone(), task_id.clone(), Some(opencode_session_id.clone()), port)
        .await
        .map_err(|e| e.to_string())?;
    
    let prompt = build_task_prompt(&task, &action_prompt, additional_instructions.as_deref());
    
    client
        .prompt_async(&opencode_session_id, prompt, agent)
        .await
        .map_err(|e| format!("Failed to send prompt: {}", e))?;
    
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
    
    // Auto-move task from backlog to doing when starting an action
    if task.status == "backlog" {
        let db = db.lock().unwrap();
        db.update_task_status(&task_id, "doing")
            .map_err(|e| format!("Failed to update task status: {}", e))?;
        let _ = app.emit("task-changed", serde_json::json!({ "action": "updated", "task_id": task_id }));
    }
    
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
    pty_mgr: State<'_, PtyManager>,
    _app: tauri::AppHandle,
    task_id: String,
) -> Result<(), String> {
    let _ = pty_mgr.kill_pty(&task_id).await;
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
        let jira_title = issue.fields.summary.clone();
        let jira_status = issue.fields.status.as_ref().map(|s| s.name.clone()).unwrap_or_default();
        let assignee = issue.fields.assignee.as_ref().map(|u| u.display_name.clone()).unwrap_or_default();
        let jira_description = issue.rendered_fields
            .as_ref()
            .and_then(|rf| rf.description.clone())
            .unwrap_or_default();
        let db_lock = db.lock().unwrap();
        match db_lock.update_task_jira_info(&issue.key, &jira_title, &jira_status, &assignee, &jira_description) {
            Ok(count) => updated += count,
            Err(e) => eprintln!("Failed to update JIRA info for {}: {}", issue.key, e),
        }
        drop(db_lock);
    }
    Ok(updated)
}

#[tauri::command]
async fn force_github_sync(
    app: tauri::AppHandle,
) -> Result<github_poller::PollResult, String> {
    let github_client = github_client::GitHubClient::new();
    let result = github_poller::poll_github_once(&app, &github_client).await;
    Ok(result)
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

#[tauri::command]
async fn get_latest_session(
    db: State<'_, Mutex<db::Database>>,
    task_id: String,
) -> Result<Option<db::AgentSessionRow>, String> {
    let db_lock = db.lock().unwrap();
    db_lock
        .get_latest_session_for_ticket(&task_id)
        .map_err(|e| format!("Failed to get latest session: {}", e))
}

#[tauri::command]
async fn get_latest_sessions(
    db: State<'_, Mutex<db::Database>>,
    task_ids: Vec<String>,
) -> Result<Vec<db::AgentSessionRow>, String> {
    let db_lock = db.lock().unwrap();
    db_lock
        .get_latest_sessions_for_tickets(&task_ids)
        .map_err(|e| format!("Failed to get sessions: {}", e))
}

#[tauri::command]
async fn get_session_output(
    db: State<'_, Mutex<db::Database>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    task_id: String,
) -> Result<String, String> {
    let (opencode_session_id, worktree_path) = {
        let db_lock = db.lock().unwrap();
        let session = db_lock
            .get_latest_session_for_ticket(&task_id)
            .map_err(|e| format!("Failed to get session: {}", e))?
            .ok_or_else(|| format!("No session found for task {}", task_id))?;
        let oc_id = session
            .opencode_session_id
            .ok_or_else(|| "Session has no OpenCode session ID".to_string())?;
        let wt = db_lock
            .get_worktree_for_task(&task_id)
            .map_err(|e| format!("Failed to get worktree: {}", e))?
            .map(|w| w.worktree_path);
        (oc_id, wt)
    };

    let port = match server_mgr.get_server_port(&task_id).await {
        Some(port) => port,
        None => {
            let wt_path = worktree_path
                .ok_or_else(|| "No worktree found for this task".to_string())?;
            server_mgr
                .spawn_server(&task_id, std::path::Path::new(&wt_path))
                .await
                .map_err(|e| format!("Failed to start OpenCode server: {}", e))?
        }
    };

    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    let messages = client
        .get_session_messages(&opencode_session_id)
        .await
        .map_err(|e| format!("Failed to fetch session messages: {}", e))?;

    let mut output = String::new();
    for msg in &messages {
        let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");
        if role != "assistant" {
            continue;
        }
        if let Some(parts) = msg.get("parts").and_then(|p| p.as_array()) {
            for part in parts {
                let part_type = part.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if part_type == "text" {
                    if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                        output.push_str(text);
                    }
                }
            }
        }
    }

    Ok(output)
}

// ============================================================================
// PTY Terminal Commands
// ============================================================================

#[tauri::command]
async fn pty_spawn(
    pty_mgr: State<'_, PtyManager>,
    app: tauri::AppHandle,
    task_id: String,
    server_port: u16,
    opencode_session_id: String,
    cols: u16,
    rows: u16,
) -> Result<u64, String> {
    pty_mgr
        .spawn_pty(&task_id, server_port, &opencode_session_id, cols, rows, app)
        .await
        .map_err(|e| format!("Failed to spawn PTY: {}", e))
}

#[tauri::command]
async fn pty_write(
    pty_mgr: State<'_, PtyManager>,
    task_id: String,
    data: String,
) -> Result<(), String> {
    pty_mgr
        .write_pty(&task_id, data.as_bytes())
        .await
        .map_err(|e| format!("Failed to write to PTY: {}", e))
}

#[tauri::command]
async fn pty_resize(
    pty_mgr: State<'_, PtyManager>,
    task_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty_mgr
        .resize_pty(&task_id, cols, rows)
        .await
        .map_err(|e| format!("Failed to resize PTY: {}", e))
}

#[tauri::command]
async fn pty_kill(
    pty_mgr: State<'_, PtyManager>,
    task_id: String,
) -> Result<(), String> {
    pty_mgr
        .kill_pty(&task_id)
        .await
        .map_err(|e| format!("Failed to kill PTY: {}", e))
}

// ============================================================================
// Utility Commands
// ============================================================================

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
// GitHub PR Review Commands
// ============================================================================

#[tauri::command]
async fn get_github_username(
    db: State<'_, Mutex<db::Database>>,
    github_client: State<'_, GitHubClient>,
) -> Result<String, String> {
    let cached_username = {
        let db_lock = db.lock().unwrap();
        db_lock.get_config("github_username")
            .map_err(|e| format!("Failed to get config: {}", e))?
    };

    if let Some(username) = cached_username {
        return Ok(username);
    }

    let token = {
        let db_lock = db.lock().unwrap();
        db_lock.get_config("github_token")
            .map_err(|e| format!("Failed to get config: {}", e))?
            .ok_or("github_token not configured")?
    };

    let username = github_client
        .get_authenticated_user(&token)
        .await
        .map_err(|e| format!("Failed to get authenticated user: {}", e))?;

    {
        let db_lock = db.lock().unwrap();
        db_lock.set_config("github_username", &username)
            .map_err(|e| format!("Failed to cache username: {}", e))?;
    }

    Ok(username)
}

#[tauri::command]
async fn fetch_review_prs(
    db: State<'_, Mutex<db::Database>>,
    github_client: State<'_, GitHubClient>,
) -> Result<Vec<db::ReviewPrRow>, String> {
    let cached_username = {
        let db_lock = db.lock().unwrap();
        db_lock.get_config("github_username")
            .map_err(|e| format!("Failed to get config: {}", e))?
    };

    let username = if let Some(u) = cached_username {
        u
    } else {
        let token_temp = {
            let db_lock = db.lock().unwrap();
            db_lock.get_config("github_token")
                .map_err(|e| format!("Failed to get config: {}", e))?
                .ok_or("github_token not configured")?
        };
        let u = github_client
            .get_authenticated_user(&token_temp)
            .await
            .map_err(|e| format!("Failed to get authenticated user: {}", e))?;
        {
            let db_lock = db.lock().unwrap();
            db_lock.set_config("github_username", &u)
                .map_err(|e| format!("Failed to cache username: {}", e))?;
        }
        u
    };

    let token = {
        let db_lock = db.lock().unwrap();
        db_lock.get_config("github_token")
            .map_err(|e| format!("Failed to get config: {}", e))?
            .ok_or("github_token not configured")?
    };

    let prs = github_client
        .search_review_requested_prs(&username, &token)
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

            db_lock.upsert_review_pr(
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
            ).map_err(|e| format!("Failed to upsert review PR: {}", e))?;
        }

        db_lock.delete_stale_review_prs(&current_ids)
            .map_err(|e| format!("Failed to delete stale review PRs: {}", e))?;
    }

    let db_lock = db.lock().unwrap();
    db_lock.get_all_review_prs()
        .map_err(|e| format!("Failed to get review PRs: {}", e))
}

#[tauri::command]
async fn get_review_prs(
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<db::ReviewPrRow>, String> {
    let db_lock = db.lock().unwrap();
    db_lock.get_all_review_prs()
        .map_err(|e| format!("Failed to get review PRs: {}", e))
}

#[tauri::command]
async fn get_pr_file_diffs(
    db: State<'_, Mutex<db::Database>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    pr_number: i64,
) -> Result<Vec<github_client::PrFileDiff>, String> {
    let token = {
        let db_lock = db.lock().unwrap();
        db_lock.get_config("github_token")
            .map_err(|e| format!("Failed to get config: {}", e))?
            .ok_or("github_token not configured")?
    };

    github_client
        .get_pr_files(&owner, &repo, pr_number, &token)
        .await
        .map_err(|e| format!("Failed to get PR files: {}", e))
}

#[tauri::command]
async fn get_file_content(
    db: State<'_, Mutex<db::Database>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    sha: String,
) -> Result<String, String> {
    let token = {
        let db_lock = db.lock().unwrap();
        db_lock.get_config("github_token")
            .map_err(|e| format!("Failed to get config: {}", e))?
            .ok_or("github_token not configured")?
    };

    github_client
        .get_blob_content(&owner, &repo, &sha, &token)
        .await
        .map_err(|e| format!("Failed to get blob content: {}", e))
}

#[tauri::command]
async fn get_file_at_ref(
    db: State<'_, Mutex<db::Database>>,
    _github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    path: String,
    ref_sha: String,
) -> Result<String, String> {
    let token = {
        let db_lock = db.lock().unwrap();
        db_lock.get_config("github_token")
            .map_err(|e| format!("Failed to get config: {}", e))?
            .ok_or("github_token not configured")?
    };

    let url = format!(
        "https://api.github.com/repos/{}/{}/contents/{}?ref={}",
        owner, repo, path, ref_sha
    );

    let response = reqwest::Client::new()
        .get(&url)
        .header("Authorization", format!("token {}", token))
        .header("User-Agent", "ai-command-center")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await
            .unwrap_or_else(|_| "Unable to read response body".to_string());
        return Err(format!("API error (status {}): {}", status, body));
    }

    let json: serde_json::Value = response.json().await
        .map_err(|e| format!("Parse error: {}", e))?;

    let content_b64 = json.get("content")
        .and_then(|c| c.as_str())
        .ok_or("No content field in response")?;

    let decoded = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &content_b64.replace('\n', "")
    ).map_err(|e| format!("Base64 decode error: {}", e))?;

    String::from_utf8(decoded)
        .map_err(|e| format!("UTF-8 decode error: {}", e))
}

#[tauri::command]
async fn get_review_comments(
    db: State<'_, Mutex<db::Database>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    pr_number: i64,
) -> Result<Vec<github_client::PrReviewComment>, String> {
    let token = {
        let db_lock = db.lock().unwrap();
        db_lock.get_config("github_token")
            .map_err(|e| format!("Failed to get config: {}", e))?
            .ok_or("github_token not configured")?
    };

    github_client
        .get_pr_review_comments(&owner, &repo, pr_number, &token)
        .await
        .map_err(|e| format!("Failed to get review comments: {}", e))
}

#[tauri::command]
async fn submit_pr_review(
    db: State<'_, Mutex<db::Database>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    pr_number: i64,
    event: String,
    body: String,
    comments: Vec<github_client::ReviewSubmitComment>,
    commit_id: String,
) -> Result<(), String> {
    let token = {
        let db_lock = db.lock().unwrap();
        db_lock.get_config("github_token")
            .map_err(|e| format!("Failed to get config: {}", e))?
            .ok_or("github_token not configured")?
    };

    github_client
        .submit_review(&owner, &repo, pr_number, &event, &body, comments, &commit_id, &token)
        .await
        .map_err(|e| format!("Failed to submit review: {}", e))
}

// ============================================================================
// Self-Review Commands
// ============================================================================

#[tauri::command]
async fn get_task_diff(
    task_id: String,
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<diff_parser::TaskFileDiff>, String> {
    let worktree_path = {
        let db = db.lock().unwrap();
        let row = db
            .get_worktree_for_task(&task_id)
            .map_err(|e| format!("Failed to get worktree for task: {}", e))?;
        row.ok_or_else(|| format!("No worktree found for task {}", task_id))?
            .worktree_path
    };

    // Find the merge-base between origin/main and HEAD
    let merge_base_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&worktree_path)
        .args(["merge-base", "origin/main", "HEAD"])
        .output()
        .await
        .map_err(|e| format!("Failed to run git merge-base: {}", e))?;

    if !merge_base_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_base_output.stderr);
        return Err(format!("git merge-base failed: {}", stderr));
    }

    let merge_base = String::from_utf8_lossy(&merge_base_output.stdout)
        .trim()
        .to_string();

    // Diff from merge-base to working tree (includes committed + staged + unstaged changes)
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&worktree_path)
        .arg("diff")
        .arg(&merge_base)
        .output()
        .await
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff failed: {}", stderr));
    }

    let diff_output = String::from_utf8_lossy(&output.stdout);
    Ok(diff_parser::parse_unified_diff(&diff_output, true))
}

/// Fetch old and new file content for a file in a task's worktree.
/// Old content comes from `git show <merge_base>:<path>`, new content from the worktree file.
#[tauri::command]
async fn get_task_file_contents(
    task_id: String,
    path: String,
    old_path: Option<String>,
    status: String,
    db: State<'_, Mutex<db::Database>>,
) -> Result<(String, String), String> {
    let worktree_path = {
        let db = db.lock().unwrap();
        let row = db
            .get_worktree_for_task(&task_id)
            .map_err(|e| format!("Failed to get worktree for task: {}", e))?;
        row.ok_or_else(|| format!("No worktree found for task {}", task_id))?
            .worktree_path
    };

    let merge_base_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&worktree_path)
        .args(["merge-base", "origin/main", "HEAD"])
        .output()
        .await
        .map_err(|e| format!("Failed to run git merge-base: {}", e))?;

    if !merge_base_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_base_output.stderr);
        return Err(format!("git merge-base failed: {}", stderr));
    }

    let merge_base = String::from_utf8_lossy(&merge_base_output.stdout)
        .trim()
        .to_string();

    let old_content = if status == "added" {
        String::new()
    } else {
        let old_file_path = old_path.as_deref().unwrap_or(&path);
        let old_output = tokio::process::Command::new("git")
            .arg("-C")
            .arg(&worktree_path)
            .args(["show", &format!("{}:{}", merge_base, old_file_path)])
            .output()
            .await
            .map_err(|e| format!("Failed to run git show: {}", e))?;

        if old_output.status.success() {
            String::from_utf8_lossy(&old_output.stdout).to_string()
        } else {
            String::new()
        }
    };

    let new_content = if status == "deleted" {
        String::new()
    } else {
        let full_path = std::path::Path::new(&worktree_path).join(&path);
        tokio::fs::read_to_string(&full_path)
            .await
            .unwrap_or_default()
    };

    Ok((old_content, new_content))
}

#[tauri::command]
async fn add_self_review_comment(
    task_id: String,
    comment_type: String,
    file_path: Option<String>,
    line_number: Option<i32>,
    body: String,
    db: State<'_, Mutex<db::Database>>,
) -> Result<i64, String> {
    let db = db.lock().unwrap();
    db.insert_self_review_comment(
        &task_id,
        &comment_type,
        file_path.as_deref(),
        line_number,
        &body,
    )
    .map_err(|e| format!("Failed to add self review comment: {}", e))
}

#[tauri::command]
async fn get_active_self_review_comments(
    task_id: String,
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<db::SelfReviewCommentRow>, String> {
    let db = db.lock().unwrap();
    db.get_active_self_review_comments(&task_id)
        .map_err(|e| format!("Failed to get active self review comments: {}", e))
}

#[tauri::command]
async fn get_archived_self_review_comments(
    task_id: String,
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<db::SelfReviewCommentRow>, String> {
    let db = db.lock().unwrap();
    db.get_archived_self_review_comments(&task_id)
        .map_err(|e| format!("Failed to get archived self review comments: {}", e))
}

#[tauri::command]
async fn delete_self_review_comment(
    comment_id: i64,
    db: State<'_, Mutex<db::Database>>,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.delete_self_review_comment(comment_id)
        .map_err(|e| format!("Failed to delete self review comment: {}", e))
}

#[tauri::command]
async fn archive_self_review_comments(
    task_id: String,
    db: State<'_, Mutex<db::Database>>,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.archive_self_review_comments(&task_id)
        .map_err(|e| format!("Failed to archive self review comments: {}", e))
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
// Startup: Resume OpenCode Servers
// ============================================================================

async fn resume_task_servers(app: tauri::AppHandle) {
    let worktrees = {
        let db = app.state::<Mutex<db::Database>>();
        let db_lock = db.lock().unwrap();
        match db_lock.get_resumable_worktrees() {
            Ok(wts) => wts,
            Err(e) => {
                eprintln!("[startup] Failed to get resumable worktrees: {}", e);
                return;
            }
        }
    };

    if worktrees.is_empty() {
        return;
    }

    println!("[startup] Resuming OpenCode servers for {} task(s)", worktrees.len());

    let server_mgr = app.state::<server_manager::ServerManager>();
    let sse_mgr = app.state::<sse_bridge::SseBridgeManager>();

    for worktree in worktrees {
        let worktree_path = std::path::Path::new(&worktree.worktree_path);
        if !worktree_path.exists() {
            eprintln!(
                "[startup] Worktree path missing for task {}, skipping: {}",
                worktree.task_id, worktree.worktree_path
            );
            continue;
        }

        match server_mgr.spawn_server(&worktree.task_id, worktree_path).await {
            Ok(port) => {
                {
                    let db = app.state::<Mutex<db::Database>>();
                    let db_lock = db.lock().unwrap();
                    if let Err(e) = db_lock.update_worktree_server(&worktree.task_id, port as i64, 0) {
                        eprintln!(
                            "[startup] Failed to update worktree server for {}: {}",
                            worktree.task_id, e
                        );
                    }
                }

                if let Err(e) = sse_mgr
                    .start_bridge(app.clone(), worktree.task_id.clone(), None, port)
                    .await
                {
                    eprintln!(
                        "[startup] Failed to start SSE bridge for {}: {}",
                        worktree.task_id, e
                    );
                }

                let _ = app.emit(
                    "server-resumed",
                    serde_json::json!({
                        "task_id": worktree.task_id,
                        "port": port,
                    }),
                );

                println!(
                    "[startup] Resumed server for task {} on port {}",
                    worktree.task_id, port
                );
            }
            Err(e) => {
                eprintln!(
                    "[startup] Failed to spawn server for task {}: {}",
                    worktree.task_id, e
                );
            }
        }
    }
}

// ============================================================================
// Main
// ============================================================================

fn main() {
    // Fix PATH for macOS GUI apps launched from Finder/Dock.
    // Without this, ~/.opencode/bin and other user PATH entries are missing.
    #[cfg(desktop)]
    let _ = fix_path_env::fix();

    ctrlc::set_handler(|| std::process::exit(0)).ok();

    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            let db_path = app_data_dir.join("ai_command_center.db");

            println!("Initializing database at: {:?}", db_path);

            let database = db::Database::new(db_path).expect("Failed to initialize database");

            match database.mark_running_sessions_interrupted() {
                Ok(count) if count > 0 => {
                    println!("[startup] Marked {} stale running sessions as interrupted", count);
                }
                Ok(_) => {}
                Err(e) => {
                    eprintln!("[startup] Failed to mark stale sessions: {}", e);
                }
            }

            match database.clear_stale_worktree_servers() {
                Ok(count) if count > 0 => {
                    println!("[startup] Cleared stale server info from {} worktree(s)", count);
                }
                Ok(_) => {}
                Err(e) => {
                    eprintln!("[startup] Failed to clear stale worktree servers: {}", e);
                }
            }

            app.manage(Mutex::new(database));

            println!("Database initialized successfully");

            let jira_client = JiraClient::new();
            let github_client = GitHubClient::new();

            let opencode_client = OpenCodeClient::with_base_url("http://127.0.0.1:4096".to_string());

            let server_manager = server_manager::ServerManager::new();
            let sse_bridge_manager = sse_bridge::SseBridgeManager::new();
            let pty_manager = PtyManager::new();

            app.manage(opencode_client);
            app.manage(jira_client);
            app.manage(github_client);
            app.manage(server_manager);
            app.manage(sse_bridge_manager);
            app.manage(pty_manager);

            if let Err(e) = server_manager::ServerManager::new().cleanup_stale_pids() {
                eprintln!("Failed to cleanup stale server PIDs: {}", e);
            }

            if let Err(e) = PtyManager::new().cleanup_stale_pids() {
                eprintln!("Failed to cleanup stale PTY PIDs: {}", e);
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

            let app_handle_resume = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                resume_task_servers(app_handle_resume).await;
            });

            println!("Server resume task started");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_opencode_status,
            get_agents,
            create_session,
            send_prompt,
            get_tasks,
            get_task_detail,
            create_task,
            update_task,
            update_task_status,
            delete_task,
            clear_done_tasks,
            create_project,
            get_projects,
            update_project,
            delete_project,
            get_project_config,
            set_project_config,
            get_tasks_for_project,
            get_worktree_for_task,
            start_implementation,
            run_action,
            abort_implementation,
            refresh_jira_info,
            force_github_sync,
            get_pull_requests,
            get_pr_comments,
            mark_comment_addressed,
            get_session_status,
            abort_session,
            get_agent_logs,
            get_latest_session,
            get_latest_sessions,
            get_session_output,
            open_url,
            get_config,
            set_config,
            check_opencode_installed,
            get_github_username,
            fetch_review_prs,
            get_review_prs,
            get_pr_file_diffs,
            get_file_content,
            get_file_at_ref,
            get_review_comments,
            submit_pr_review,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            get_task_diff,
            get_task_file_contents,
            add_self_review_comment,
            get_active_self_review_comments,
            get_archived_self_review_comments,
            delete_self_review_comment,
            archive_self_review_comments
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_task_prompt_all_fields() {
        let task = db::TaskRow {
            id: "T-123".to_string(),
            title: "Test Task".to_string(),
            plan_text: Some("Step 1: Do this\nStep 2: Do that".to_string()),
            status: "backlog".to_string(),
            jira_key: None,
            jira_title: None,
            jira_status: None,
            jira_assignee: None,
            jira_description: None,
            project_id: None,
            created_at: 0,
            updated_at: 0,
        };

        let prompt = build_task_prompt(&task, "Do the thing!", None);
        
        assert!(prompt.contains("You are working on task T-123: Test Task"));
        assert!(prompt.contains("Plan:"));
        assert!(prompt.contains("Step 1: Do this"));
        assert!(prompt.ends_with("Do the thing!"));
    }

    #[test]
    fn test_build_task_prompt_minimal_fields() {
        let task = db::TaskRow {
            id: "T-456".to_string(),
            title: "Minimal Task".to_string(),
            plan_text: None,
            status: "backlog".to_string(),
            jira_key: None,
            jira_title: None,
            jira_status: None,
            jira_assignee: None,
            jira_description: None,
            project_id: None,
            created_at: 0,
            updated_at: 0,
        };

        let prompt = build_task_prompt(&task, "Execute now!", None);
        
        assert!(prompt.contains("You are working on task T-456: Minimal Task"));
        assert!(!prompt.contains("Acceptance Criteria:"));
        assert!(!prompt.contains("Plan:"));
        assert!(prompt.ends_with("Execute now!"));
    }

    #[test]
    fn test_build_task_prompt_empty_optional_fields() {
        let task = db::TaskRow {
            id: "T-789".to_string(),
            title: "Empty Fields Task".to_string(),
            plan_text: Some("".to_string()),
            status: "backlog".to_string(),
            jira_key: None,
            jira_title: None,
            jira_status: None,
            jira_assignee: None,
            jira_description: None,
            project_id: None,
            created_at: 0,
            updated_at: 0,
        };

        let prompt = build_task_prompt(&task, "Run test!", None);
        
        assert!(prompt.contains("You are working on task T-789: Empty Fields Task"));
        assert!(!prompt.contains("Acceptance Criteria:"));
        assert!(!prompt.contains("Plan:"));
        assert!(prompt.ends_with("Run test!"));
    }

    #[test]
    fn test_build_task_prompt_with_additional_instructions() {
        let task = db::TaskRow {
            id: "T-999".to_string(),
            title: "Instructions Task".to_string(),
            plan_text: Some("Step 1: Do this\nStep 2: Do that".to_string()),
            status: "backlog".to_string(),
            jira_key: None,
            jira_title: None,
            jira_status: None,
            jira_assignee: None,
            jira_description: None,
            project_id: None,
            created_at: 0,
            updated_at: 0,
        };

        let prompt = build_task_prompt(&task, "Do the thing!", Some("Always use TypeScript strict mode.\nFollow the project coding standards."));
        
        assert!(prompt.starts_with("Always use TypeScript strict mode."));
        assert!(prompt.contains("You are working on task"));
        assert!(prompt.contains("Plan:\n"));
        assert!(prompt.ends_with("Do the thing!"));
    }

    #[test]
    fn test_build_task_prompt_with_empty_additional_instructions() {
        let task = db::TaskRow {
            id: "T-111".to_string(),
            title: "Empty Instructions Task".to_string(),
            plan_text: Some("Step 1: Do this\nStep 2: Do that".to_string()),
            status: "backlog".to_string(),
            jira_key: None,
            jira_title: None,
            jira_status: None,
            jira_assignee: None,
            jira_description: None,
            project_id: None,
            created_at: 0,
            updated_at: 0,
        };

        let prompt_with_empty = build_task_prompt(&task, "Do the thing!", Some(""));
        let prompt_with_none = build_task_prompt(&task, "Do the thing!", None);
        
        assert_eq!(prompt_with_empty, prompt_with_none);
    }

    #[test]
    fn test_build_task_prompt_with_none_additional_instructions() {
        let task = db::TaskRow {
            id: "T-222".to_string(),
            title: "None Instructions Task".to_string(),
            plan_text: Some("Step 1: Do this\nStep 2: Do that".to_string()),
            status: "backlog".to_string(),
            jira_key: None,
            jira_title: None,
            jira_status: None,
            jira_assignee: None,
            jira_description: None,
            project_id: None,
            created_at: 0,
            updated_at: 0,
        };

        let prompt = build_task_prompt(&task, "Do the thing!", None);
        
        assert!(prompt.starts_with("You are working on task"));
    }
}
