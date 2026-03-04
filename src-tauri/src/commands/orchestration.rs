use std::sync::{Mutex, Arc};
use tauri::{State, Emitter};
use crate::{db, opencode_client::OpenCodeClient, server_manager::ServerManager, sse_bridge::SseBridgeManager, git_worktree, pty_manager::PtyManager};

pub fn build_task_prompt(task: &db::TaskRow, action_instruction: &str, additional_instructions: Option<&str>) -> String {
    let mut prompt = String::new();
    
    if let Some(instructions) = additional_instructions {
        if !instructions.is_empty() {
            prompt.push_str(instructions);
            prompt.push_str("\n\n");
        }
    }
    
    prompt.push_str(&task.title);
    prompt.push('\n');
    
    if let Some(ref key) = task.jira_key {
        if !key.is_empty() {
            prompt.push_str(&format!("Jira: {}\n", key));
        }
    }
    
    prompt.push('\n');
    
    prompt.push_str(action_instruction);
    prompt
}


    pub(crate) async fn abort_task_agent(
    db: &State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: &State<'_, ServerManager>,
    sse_mgr: &State<'_, SseBridgeManager>,
    pty_mgr: &State<'_, PtyManager>,
    task_id: &str,
) -> Result<(), String> {
    let (provider, session) = {
        let db_lock = db.lock().unwrap();
        let session = db_lock.get_latest_session_for_ticket(task_id).ok().flatten();
        let provider = session.as_ref().map(|s| s.provider.clone()).unwrap_or_else(|| "claude-code".to_string());
        (provider, session)
    };

    if provider == "claude-code" {
        let _ = pty_mgr.kill_pty(task_id).await;

        if let Some(s) = session {
            let db_lock = db.lock().unwrap();
            let _ = db_lock.update_agent_session(&s.id, &s.stage, "interrupted", None, Some("Aborted by user"));
        }
    } else {
        // OpenCode path - existing logic unchanged
        let port = server_mgr.get_server_port(task_id).await;
        if let Some(port) = port {
            let (session, opencode_session_id) = {
                let db_lock = db.lock().unwrap();
                let session = db_lock
                    .get_latest_session_for_ticket(task_id)
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

        sse_mgr.stop_bridge(task_id).await;
        let _ = server_mgr.stop_server(task_id).await;

        {
            let db = db.lock().unwrap();
            let _ = db.update_worktree_status(task_id, "stopped");
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn start_implementation(
    db: State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: State<'_, ServerManager>,
    sse_mgr: State<'_, SseBridgeManager>,
    pty_mgr: State<'_, PtyManager>,
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

    let provider = {
        let db_lock = db.lock().unwrap();
        db_lock.get_config("ai_provider").ok().flatten().unwrap_or_else(|| "claude-code".to_string())
    };

    // Shared: create worktree (both providers use the same logic)
    let branch = git_worktree::slugify_branch_name(&task_id, &task.title);
    let home = dirs::home_dir().ok_or("Failed to get home directory")?;
    let repo_name = std::path::Path::new(&repo_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid repo path")?;
    let worktree_path = home
        .join(".openforge")
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

    if provider == "claude-code" {
        let port = crate::claude_hooks::get_http_server_port();
        let hooks_path = crate::claude_hooks::generate_hooks_settings(port).map_err(|e| e.to_string())?;
        let prompt = build_task_prompt(&task, "Implement this task. Create a branch, make the changes, and create a pull request when done.", additional_instructions.as_deref());

        pty_mgr.spawn_claude_pty(
            &task_id,
            &worktree_path,
            &prompt,
            None,
            false,
            &hooks_path,
            80,
            24,
            app.clone(),
        ).await.map_err(|e| e.to_string())?;

        let agent_session_id = uuid::Uuid::new_v4().to_string();
        {
            let db = db.lock().unwrap();
            db.create_agent_session(
                &agent_session_id,
                &task_id,
                None,
                "implementing",
                "running",
                "claude-code",
            ).map_err(|e| format!("Failed to create agent session: {}", e))?;
        }

        if task.status == "backlog" {
            let db = db.lock().unwrap();
            db.update_task_status(&task_id, "doing")
                .map_err(|e| format!("Failed to update task status: {}", e))?;
        }
        let _ = app.emit("task-changed", serde_json::json!({ "action": "updated", "task_id": task_id }));

        return Ok(serde_json::json!({
            "task_id": task_id,
            "session_id": agent_session_id,
            "worktree_path": worktree_path.to_str().unwrap(),
            "port": 0,
        }));
    } else {
        // OpenCode path - existing logic unchanged
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
                "opencode",
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
}

#[tauri::command]
pub async fn run_action(
    db: State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: State<'_, ServerManager>,
    sse_mgr: State<'_, SseBridgeManager>,
    pty_mgr: State<'_, PtyManager>,
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

    let provider = {
        let db_lock = db.lock().unwrap();
        db_lock.get_config("ai_provider").ok().flatten().unwrap_or_else(|| "claude-code".to_string())
    };

    if provider == "claude-code" {
        let existing_session = {
            let db = db.lock().unwrap();
            db.get_latest_session_for_ticket(&task_id)
                .map_err(|e| format!("Failed to get latest session: {}", e))?
        };

        if let Some(ref session) = existing_session {
            match session.status.as_str() {
                "running" => return Err("Agent is busy".to_string()),
                "paused" => return Err("Answer pending question first".to_string()),
                "completed" | "failed" | "interrupted" => {
                    let worktree = {
                        let db = db.lock().unwrap();
                        db.get_worktree_for_task(&task_id)
                            .map_err(|e| format!("Failed to get worktree: {}", e))?
                    };

                    if let Some(w) = worktree {
                        let port = crate::claude_hooks::get_http_server_port();
                        let hooks_path = crate::claude_hooks::generate_hooks_settings(port).map_err(|e| e.to_string())?;

                        // Resume existing session if we have a session ID, otherwise start fresh
                        let resume_id = session.claude_session_id.as_deref();

                        pty_mgr.spawn_claude_pty(
                            &task_id,
                            std::path::Path::new(&w.worktree_path),
                            &action_prompt,
                            resume_id,
                            false,
                            &hooks_path,
                            80,
                            24,
                            app.clone(),
                        ).await.map_err(|e| e.to_string())?;

                        {
                            let db = db.lock().unwrap();
                            db.update_agent_session(&session.id, &session.stage, "running", None, None)
                                .map_err(|e| format!("Failed to update agent session: {}", e))?;
                        }

                        if task.status == "backlog" {
                            let db = db.lock().unwrap();
                            db.update_task_status(&task_id, "doing")
                                .map_err(|e| format!("Failed to update task status: {}", e))?;
                            let _ = app.emit("task-changed", serde_json::json!({ "action": "updated", "task_id": task_id }));
                        }

                        return Ok(serde_json::json!({
                            "task_id": task_id,
                            "session_id": session.id,
                            "worktree_path": w.worktree_path,
                            "port": 0,
                        }));
                    }
                }
                _ => {}
            }
        }

        let port = crate::claude_hooks::get_http_server_port();
        let hooks_path = crate::claude_hooks::generate_hooks_settings(port).map_err(|e| e.to_string())?;
        let prompt = build_task_prompt(&task, &action_prompt, additional_instructions.as_deref());

        let branch = git_worktree::slugify_branch_name(&task_id, &task.title);
        let home = dirs::home_dir().ok_or("Failed to get home directory")?;
        let repo_name = std::path::Path::new(&repo_path)
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("Invalid repo path")?;
        let worktree_path = home
            .join(".openforge")
            .join("worktrees")
            .join(repo_name)
            .join(&task_id);

        git_worktree::create_worktree(
            std::path::Path::new(&repo_path),
            &worktree_path,
            &branch,
            "origin/main",
        ).await.map_err(|e| e.to_string())?;

        {
            let db = db.lock().unwrap();
            db.create_worktree_record(
                &task_id,
                &project_id_owned,
                &repo_path,
                worktree_path.to_str().unwrap(),
                &branch,
            ).map_err(|e| e.to_string())?;
        }

        pty_mgr.spawn_claude_pty(
            &task_id,
            &worktree_path,
            &prompt,
            None,
            false,
            &hooks_path,
            80,
            24,
            app.clone(),
        ).await.map_err(|e| e.to_string())?;

        let agent_session_id = uuid::Uuid::new_v4().to_string();
        {
            let db = db.lock().unwrap();
            db.create_agent_session(
                &agent_session_id,
                &task_id,
                None,
                "implementing",
                "running",
                "claude-code",
            ).map_err(|e| format!("Failed to create agent session: {}", e))?;
        }

        if task.status == "backlog" {
            let db = db.lock().unwrap();
            db.update_task_status(&task_id, "doing")
                .map_err(|e| format!("Failed to update task status: {}", e))?;
            let _ = app.emit("task-changed", serde_json::json!({ "action": "updated", "task_id": task_id }));
        }

        return Ok(serde_json::json!({
            "task_id": task_id,
            "worktree_path": worktree_path.to_str().unwrap(),
            "port": 0,
            "session_id": agent_session_id,
        }));
    } else {
        // OpenCode path - existing logic unchanged
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
                    // Get the existing worktree for this task
                    let worktree = {
                        let db = db.lock().unwrap();
                        db.get_worktree_for_task(&task_id)
                            .map_err(|e| format!("Failed to get worktree: {}", e))?
                    };

                    if let Some(ref w) = worktree {
                        // Ensure the server is running (respawn if it was stopped)
                        let port = match server_mgr.get_server_port(&task_id).await {
                            Some(p) => p,
                            None => {
                                let p = server_mgr
                                    .spawn_server(&task_id, std::path::Path::new(&w.worktree_path))
                                    .await
                                    .map_err(|e| e.to_string())?;
                                {
                                    let db = db.lock().unwrap();
                                    let _ = db.update_worktree_server(&task_id, p as i64, 0);
                                }
                                p
                            }
                        };

                        let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));

                        // Reuse existing session or create a new one
                        let opencode_session_id = if let Some(ref sid) = session.opencode_session_id {
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
                            sid.clone()
                        } else {
                            client
                                .create_session(format!("Task {}", task_id))
                                .await
                                .map_err(|e| format!("Failed to create session: {}", e))?
                        };

                        let prompt = action_prompt.clone();
                        client
                            .prompt_async(&opencode_session_id, prompt, agent.clone())
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

                        if task.status == "backlog" {
                            let db = db.lock().unwrap();
                            db.update_task_status(&task_id, "doing")
                                .map_err(|e| format!("Failed to update task status: {}", e))?;
                            let _ = app.emit("task-changed", serde_json::json!({ "action": "updated", "task_id": task_id }));
                        }

                        return Ok(serde_json::json!({
                            "task_id": task_id,
                            "session_id": session.id,
                            "worktree_path": w.worktree_path,
                            "port": port,
                        }));
                    }
                }
                _ => {}
            }
        }

        // OpenCode new start
        let branch = git_worktree::slugify_branch_name(&task_id, &task.title);
        let home = dirs::home_dir().ok_or("Failed to get home directory")?;
        let repo_name = std::path::Path::new(&repo_path)
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("Invalid repo path")?;
        let worktree_path = home
            .join(".openforge")
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
                "opencode",
            )
            .map_err(|e| format!("Failed to create agent session: {}", e))?;
        }

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
}

#[tauri::command]
pub async fn abort_implementation(
    db: State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: State<'_, ServerManager>,
    sse_mgr: State<'_, SseBridgeManager>,
    pty_mgr: State<'_, PtyManager>,
    app: tauri::AppHandle,
    task_id: String,
) -> Result<(), String> {
    abort_task_agent(&db, &server_mgr, &sse_mgr, &pty_mgr, &task_id).await?;
    let _ = app.emit("task-changed", serde_json::json!({ "action": "updated", "task_id": task_id }));
    Ok(())
}

#[tauri::command]
pub async fn finalize_claude_session(
    db: State<'_, Arc<Mutex<db::Database>>>,
    app: tauri::AppHandle,
    task_id: String,
) -> Result<(), String> {
    let db_lock = db.lock().unwrap();
    if let Ok(Some(session)) = db_lock.get_latest_session_for_ticket(&task_id) {
        if session.provider == "claude-code" && session.status == "running" {
            let _ = db_lock.update_agent_session(&session.id, &session.stage, "interrupted", None, Some("PTY process exited"));
            drop(db_lock);
            let _ = app.emit(
                "agent-status-changed",
                serde_json::json!({
                    "task_id": task_id,
                    "status": "interrupted",
                    "provider": "claude-code"
                })
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_task_prompt_all_fields() {
        let task = db::TaskRow {
            id: "T-123".to_string(),
            title: "Test Task".to_string(),
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
        
        assert!(prompt.contains("Test Task"));
        assert!(!prompt.contains("Plan:"));
        assert!(prompt.ends_with("Do the thing!"));
    }

    #[test]
    fn test_build_task_prompt_minimal_fields() {
        let task = db::TaskRow {
            id: "T-456".to_string(),
            title: "Minimal Task".to_string(),
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
        
        assert!(prompt.contains("Minimal Task"));
        assert!(!prompt.contains("Plan:"));
        assert!(prompt.ends_with("Execute now!"));
    }

    #[test]
    fn test_build_task_prompt_empty_optional_fields() {
        let task = db::TaskRow {
            id: "T-789".to_string(),
            title: "Empty Fields Task".to_string(),
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
        
        assert!(prompt.contains("Empty Fields Task"));
        assert!(!prompt.contains("Plan:"));
        assert!(prompt.ends_with("Run test!"));
    }

    #[test]
    fn test_build_task_prompt_with_additional_instructions() {
        let task = db::TaskRow {
            id: "T-999".to_string(),
            title: "Instructions Task".to_string(),
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
        assert!(prompt.contains("Instructions Task"));
        assert!(!prompt.contains("Plan:"));
        assert!(prompt.ends_with("Do the thing!"));
    }

    #[test]
    fn test_build_task_prompt_with_empty_additional_instructions() {
        let task = db::TaskRow {
            id: "T-111".to_string(),
            title: "Empty Instructions Task".to_string(),
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
        
        assert!(prompt.starts_with("None Instructions Task"));
    }

    #[test]
    fn test_build_task_prompt_with_jira_key() {
        let task = db::TaskRow {
            id: "T-333".to_string(),
            title: "Feature with Jira context".to_string(),
            status: "backlog".to_string(),
            jira_key: Some("PROJ-42".to_string()),
            jira_title: Some("Add auth endpoint".to_string()),
            jira_status: None,
            jira_assignee: None,
            jira_description: Some("<p>As a user I want to authenticate via JWT.</p>".to_string()),
            project_id: None,
            created_at: 0,
            updated_at: 0,
        };

        let prompt = build_task_prompt(&task, "Implement this task.", None);

        assert!(prompt.contains("Feature with Jira context"));
        assert!(prompt.contains("Jira: PROJ-42"));
        assert!(!prompt.contains("Description:"));
        assert!(!prompt.contains("authenticate via JWT"));
        assert!(!prompt.contains("Plan:"));
        assert!(prompt.ends_with("Implement this task."));
    }

    #[test]
    fn test_build_task_prompt_without_jira_key() {
        let task = db::TaskRow {
            id: "T-444".to_string(),
            title: "Task without jira".to_string(),
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

        let prompt = build_task_prompt(&task, "Do it!", None);

        assert!(prompt.contains("Task without jira"));
        assert!(!prompt.contains("Jira:"));
        assert!(prompt.ends_with("Do it!"));
    }

    #[test]
    fn test_build_task_prompt_does_not_include_task_id() {
        let task = db::TaskRow {
            id: "T-555".to_string(),
            title: "No ID in prompt".to_string(),
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

        let prompt = build_task_prompt(&task, "Go!", None);

        assert!(!prompt.contains("T-555"));
        assert!(prompt.contains("No ID in prompt"));
    }
}
