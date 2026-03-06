use std::sync::{Mutex, Arc};
use tauri::{State, Emitter};
use crate::{db, server_manager::ServerManager, sse_bridge::SseBridgeManager, git_worktree, pty_manager::PtyManager};

pub fn build_task_prompt(task: &db::TaskRow, action_instruction: &str, additional_instructions: Option<&str>) -> String {
    let mut prompt = String::new();
    
    if let Some(instructions) = additional_instructions {
        if !instructions.is_empty() {
            prompt.push_str(instructions);
            prompt.push_str("\n\n");
        }
    }
    
    prompt.push_str(task.prompt.as_deref().unwrap_or(&task.title));
    prompt.push('\n');
    
    if let Some(ref key) = task.jira_key {
        if !key.is_empty() {
            prompt.push_str(&format!("Jira: {}\n", key));
        }
    }
    
    prompt.push('\n');
    
    prompt.push_str(action_instruction);

    prompt.push_str(&format!(r#"

<openforge_task_management>
This task is {task_id}. You MUST call `openforge_update_task` at both points below — the task is not complete without these updates.

<title_update trigger="after_initial_analysis">
Once you understand the scope, call: openforge_update_task(task_id="{task_id}", title="...")
Write a concise title reflecting the actual work, not the original request verbatim.
Good: "Add JWT refresh token rotation to auth middleware" — Bad: "implement the auth thing"
</title_update>

<summary_update trigger="before_finalizing">
Before reporting completion, call: openforge_update_task(task_id="{task_id}", summary="...")
Cover: what changed, key decisions, and anything needing attention.
</summary_update>

<completeness_check>
Task is incomplete unless both updates were made. If blocked or abandoned, still update the summary with status and what remains.
</completeness_check>
</openforge_task_management>"#, task_id = task.id));

    prompt
}

pub(crate) fn create_and_record_session(
    db: &std::sync::Arc<std::sync::Mutex<crate::db::Database>>,
    task_id: &str,
    provider_session_id: Option<&str>,
    provider_name: &str,
) -> Result<String, String> {
    let agent_session_id = uuid::Uuid::new_v4().to_string();
    db.lock()
        .unwrap()
        .create_agent_session(
            &agent_session_id,
            task_id,
            provider_session_id,
            "implementing",
            "running",
            provider_name,
        )
        .map_err(|e| format!("Failed to create agent session: {}", e))?;
    Ok(agent_session_id)
}

fn activate_task_status_update(
    db: &std::sync::Arc<std::sync::Mutex<crate::db::Database>>,
    task_id: &str,
    current_status: &str,
) -> Result<(), String> {
    if current_status == "backlog" {
        db.lock()
            .unwrap()
            .update_task_status(task_id, "doing")
            .map_err(|e| format!("Failed to update task status: {}", e))?;
    }
    Ok(())
}

pub(crate) fn activate_task(
    db: &std::sync::Arc<std::sync::Mutex<crate::db::Database>>,
    app: &tauri::AppHandle,
    task_id: &str,
    current_status: &str,
) -> Result<(), String> {
    activate_task_status_update(db, task_id, current_status)?;
    if current_status == "backlog" {
        let _ = app.emit("task-changed", serde_json::json!({ "action": "updated", "task_id": task_id }));
    }
    Ok(())
}

pub(crate) fn build_start_response(
    task_id: &str,
    session_id: &str,
    worktree_path: &str,
    port: u16,
) -> serde_json::Value {
    serde_json::json!({
        "task_id": task_id,
        "session_id": session_id,
        "worktree_path": worktree_path,
        "port": port,
    })
}


    pub(crate) async fn abort_task_agent(
    db: &State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: &State<'_, ServerManager>,
    sse_mgr: &State<'_, SseBridgeManager>,
    pty_mgr: &State<'_, PtyManager>,
    task_id: &str,
) -> Result<(), String> {
    let (provider_name, session) = {
        let db_lock = crate::db::acquire_db(&db);
        let session = db_lock.get_latest_session_for_ticket(task_id).ok().flatten();
        let provider = session.as_ref().map(|s| s.provider.clone()).unwrap_or_else(|| "claude-code".to_string());
        (provider, session)
    };

    let provider = crate::providers::Provider::from_name(
        &provider_name,
        pty_mgr.inner().clone(),
        server_mgr.inner().clone(),
        sse_mgr.inner().clone(),
    ).map_err(|e| format!("Unknown provider: {}", e))?;

    // Kill shell PTY (not provider-specific — always needed during abort)
    let _ = pty_mgr.kill_pty(&format!("{}-shell", task_id)).await;

    if let Some(ref s) = session {
        let _ = provider.abort(task_id, s).await;
    }

    if let Some(ref s) = session {
        let db_lock = crate::db::acquire_db(&db);
        let status = if provider_name == "claude-code" { "interrupted" } else { "failed" };
        let _ = db_lock.update_agent_session(&s.id, &s.stage, status, None, Some("Aborted by user"));
    }

    if provider_name != "claude-code" {
        let db = crate::db::acquire_db(&db);
        let _ = db.update_worktree_status(task_id, "stopped");
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
        let db = crate::db::acquire_db(&db);
        let task = db.get_task(&task_id)
            .map_err(|e| format!("Failed to get task: {}", e))?
            .ok_or("Task not found")?;
        let project_id = task.project_id.clone().unwrap_or_default();
        let instructions = db.get_project_config(&project_id, "additional_instructions")
            .ok()
            .flatten();
        (task, project_id, instructions)
    };

    let provider_name = {
        let db_lock = crate::db::acquire_db(&db);
        db_lock.get_config("ai_provider").ok().flatten().unwrap_or_else(|| "claude-code".to_string())
    };

    let provider = crate::providers::Provider::from_name(
        &provider_name,
        pty_mgr.inner().clone(),
        server_mgr.inner().clone(),
        sse_mgr.inner().clone(),
    ).map_err(|e| format!("Unknown provider: {}", e))?;

    let branch = git_worktree::slugify_branch_name(&task_id, task.prompt.as_deref().unwrap_or(&task.title));
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
        let db = crate::db::acquire_db(&db);
        db.create_worktree_record(
            &task_id,
            &project_id_owned,
            &repo_path,
            worktree_path.to_str().unwrap(),
            &branch,
        )
        .map_err(|e| e.to_string())?;
    }

    let prompt = build_task_prompt(&task, "Implement this task. Create a branch, make the changes, and create a pull request when done.", additional_instructions.as_deref());
    let result = provider.start(&task_id, &worktree_path, &prompt, None, &app).await?;

    if provider_name != "claude-code" {
        let db = crate::db::acquire_db(&db);
        db.update_worktree_server(&task_id, result.port as i64, 0)
            .map_err(|e| e.to_string())?;
    }

    let agent_session_id = create_and_record_session(
        db.inner(),
        &task_id,
        result.opencode_session_id.as_deref(),
        provider.provider_name(),
    )?;

    activate_task(db.inner(), &app, &task_id, &task.status)?;

    Ok(build_start_response(
        &task_id,
        &agent_session_id,
        worktree_path.to_str().unwrap(),
        result.port,
    ))
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
        let db = crate::db::acquire_db(&db);
        let task = db.get_task(&task_id)
            .map_err(|e| format!("Failed to get task: {}", e))?
            .ok_or("Task not found")?;
        let project_id = task.project_id.clone().unwrap_or_default();
        let instructions = db.get_project_config(&project_id, "additional_instructions")
            .ok()
            .flatten();
        (task, project_id, instructions)
    };

    let provider_name = {
        let db_lock = crate::db::acquire_db(&db);
        db_lock.get_config("ai_provider").ok().flatten().unwrap_or_else(|| "claude-code".to_string())
    };

    let provider = crate::providers::Provider::from_name(
        &provider_name,
        pty_mgr.inner().clone(),
        server_mgr.inner().clone(),
        sse_mgr.inner().clone(),
    ).map_err(|e| format!("Unknown provider: {}", e))?;

    let existing_session = {
        let db = crate::db::acquire_db(&db);
        db.get_latest_session_for_ticket(&task_id)
            .map_err(|e| format!("Failed to get latest session: {}", e))?
    };

    if let Some(ref session) = existing_session {
        match session.status.as_str() {
            "running" => return Err("Agent is busy".to_string()),
            "paused" => return Err("Answer pending question first".to_string()),
            "completed" | "failed" | "interrupted" => {
                let worktree = {
                    let db = crate::db::acquire_db(&db);
                    db.get_worktree_for_task(&task_id)
                        .map_err(|e| format!("Failed to get worktree: {}", e))?
                };

                if let Some(w) = worktree {
                    if provider.provider_session_id(session).is_some() {
                        let db = crate::db::acquire_db(&db);
                        let recheck = db.get_latest_session_for_ticket(&task_id)
                            .map_err(|e| format!("Failed to recheck session: {}", e))?;
                        if let Some(s) = recheck {
                            if s.status != "completed" && s.status != "failed" && s.status != "interrupted" {
                                return Err("Session status changed, cannot reuse".to_string());
                            }
                        }
                    }

                    let result = provider.resume(
                        &task_id,
                        session,
                        std::path::Path::new(&w.worktree_path),
                        Some(&action_prompt),
                        agent.as_deref(),
                        &app,
                    ).await?;

                    {
                        let db = crate::db::acquire_db(&db);
                        db.update_agent_session(&session.id, &session.stage, "running", None, None)
                            .map_err(|e| format!("Failed to update agent session: {}", e))?;
                    }

                    if provider_name != "claude-code" {
                        let db = crate::db::acquire_db(&db);
                        let _ = db.update_worktree_server(&task_id, result.port as i64, 0);
                    }

                    activate_task(db.inner(), &app, &task_id, &task.status)?;

                    return Ok(build_start_response(
                        &task_id,
                        &session.id,
                        &w.worktree_path,
                        result.port,
                    ));
                }
            }
            _ => {}
        }
    }

    let branch = git_worktree::slugify_branch_name(&task_id, task.prompt.as_deref().unwrap_or(&task.title));
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
        let db = crate::db::acquire_db(&db);
        db.create_worktree_record(
            &task_id,
            &project_id_owned,
            &repo_path,
            worktree_path.to_str().unwrap(),
            &branch,
        )
        .map_err(|e| e.to_string())?;
    }

    let prompt = build_task_prompt(&task, &action_prompt, additional_instructions.as_deref());
    let result = provider.start(&task_id, &worktree_path, &prompt, agent.as_deref(), &app).await?;

    if provider_name != "claude-code" {
        let db = crate::db::acquire_db(&db);
        db.update_worktree_server(&task_id, result.port as i64, 0)
            .map_err(|e| e.to_string())?;
    }

    let agent_session_id = create_and_record_session(
        db.inner(),
        &task_id,
        result.opencode_session_id.as_deref(),
        provider.provider_name(),
    )?;

    activate_task(db.inner(), &app, &task_id, &task.status)?;

    Ok(build_start_response(
        &task_id,
        &agent_session_id,
        worktree_path.to_str().unwrap(),
        result.port,
    ))
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
    let db_lock = crate::db::acquire_db(&db);
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
            prompt: None,
            summary: None,
        };

        let prompt = build_task_prompt(&task, "Do the thing!", None);
        
        assert!(prompt.contains("Test Task"));
        assert!(!prompt.contains("Plan:"));
        assert!(prompt.contains("Do the thing!"));
        assert!(prompt.contains("<openforge_task_management>"));
        assert!(prompt.contains("openforge_update_task"));
        assert!(prompt.contains("T-123"));
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
            prompt: None,
            summary: None,
        };

        let prompt = build_task_prompt(&task, "Execute now!", None);
        
        assert!(prompt.contains("Minimal Task"));
        assert!(!prompt.contains("Plan:"));
        assert!(prompt.contains("Execute now!"));
        assert!(prompt.contains("openforge_update_task"));
        assert!(prompt.contains("T-456"));
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
            prompt: None,
            summary: None,
        };

        let prompt = build_task_prompt(&task, "Run test!", None);
        
        assert!(prompt.contains("Empty Fields Task"));
        assert!(!prompt.contains("Plan:"));
        assert!(prompt.contains("Run test!"));
        assert!(prompt.contains("openforge_update_task"));
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
            prompt: None,
            summary: None,
        };

        let prompt = build_task_prompt(&task, "Do the thing!", Some("Always use TypeScript strict mode.\nFollow the project coding standards."));
        
        assert!(prompt.starts_with("Always use TypeScript strict mode."));
        assert!(prompt.contains("Instructions Task"));
        assert!(!prompt.contains("Plan:"));
        assert!(prompt.contains("Do the thing!"));
        assert!(prompt.contains("openforge_update_task"));
        assert!(prompt.contains("T-999"));
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
            prompt: None,
            summary: None,
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
            prompt: None,
            summary: None,
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
            prompt: None,
            summary: None,
        };

        let prompt = build_task_prompt(&task, "Implement this task.", None);

        assert!(prompt.contains("Feature with Jira context"));
        assert!(prompt.contains("Jira: PROJ-42"));
        assert!(!prompt.contains("Description:"));
        assert!(!prompt.contains("authenticate via JWT"));
        assert!(!prompt.contains("Plan:"));
        assert!(prompt.contains("Implement this task."));
        assert!(prompt.contains("openforge_update_task"));
        assert!(prompt.contains("T-333"));
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
            prompt: None,
            summary: None,
        };

        let prompt = build_task_prompt(&task, "Do it!", None);

        assert!(prompt.contains("Task without jira"));
        assert!(!prompt.contains("Jira:"));
        assert!(prompt.contains("Do it!"));
        assert!(prompt.contains("openforge_update_task"));
    }

    #[test]
    fn test_build_task_prompt_includes_task_id_in_management_section() {
        let task = db::TaskRow {
            id: "T-555".to_string(),
            title: "Task with ID in prompt".to_string(),
            status: "backlog".to_string(),
            jira_key: None,
            jira_title: None,
            jira_status: None,
            jira_assignee: None,
            jira_description: None,
            project_id: None,
            created_at: 0,
            updated_at: 0,
            prompt: None,
            summary: None,
        };

        let prompt = build_task_prompt(&task, "Go!", None);

        assert!(prompt.contains("T-555"));
        assert!(prompt.contains("Task with ID in prompt"));
        // Task ID should appear in the openforge_update_task instruction
        assert!(prompt.contains("task_id=\"T-555\"") || prompt.contains("\"T-555\""));
    }

    #[test]
    fn test_build_task_prompt_uses_prompt() {
        let task = db::TaskRow {
            id: "T-666".to_string(),
            title: "Auth fix".to_string(),
            status: "backlog".to_string(),
            jira_key: None,
            jira_title: None,
            jira_status: None,
            jira_assignee: None,
            jira_description: None,
            project_id: None,
            created_at: 0,
            updated_at: 0,
            prompt: Some("Fix auth bug".to_string()),
            summary: None,
        };

        let prompt = build_task_prompt(&task, "Implement this task.", None);
        
        assert!(prompt.contains("Fix auth bug"));
        assert!(!prompt.contains("Auth fix"));
        assert!(prompt.contains("Implement this task."));
        assert!(prompt.contains("openforge_update_task"));
        assert!(prompt.contains("T-666"));
    }

    #[test]
    fn test_build_task_prompt_fallback_to_title() {
        let task = db::TaskRow {
            id: "T-777".to_string(),
            title: "My task".to_string(),
            status: "backlog".to_string(),
            jira_key: None,
            jira_title: None,
            jira_status: None,
            jira_assignee: None,
            jira_description: None,
            project_id: None,
            created_at: 0,
            updated_at: 0,
            prompt: None,
            summary: None,
        };

        let prompt = build_task_prompt(&task, "Do it!", None);
        
        assert!(prompt.contains("My task"));
        assert!(prompt.contains("Do it!"));
        assert!(prompt.contains("openforge_update_task"));
        assert!(prompt.contains("T-777"));
    }

    #[test]
    fn test_build_task_prompt_task_management_section_structure() {
        let task = db::TaskRow {
            id: "T-42".to_string(),
            title: "Test management section".to_string(),
            status: "backlog".to_string(),
            jira_key: None,
            jira_title: None,
            jira_status: None,
            jira_assignee: None,
            jira_description: None,
            project_id: None,
            created_at: 0,
            updated_at: 0,
            prompt: Some("Add a login page".to_string()),
            summary: None,
        };

        let prompt = build_task_prompt(&task, "Implement this task.", None);

        assert!(prompt.contains("<openforge_task_management>"));
        assert!(prompt.contains("</openforge_task_management>"));
        assert!(prompt.contains("openforge_update_task"));
        assert!(prompt.contains("task_id=\"T-42\""));
        assert!(prompt.contains("<title_update trigger=\"after_initial_analysis\">"));
        assert!(prompt.contains("<summary_update trigger=\"before_finalizing\">"));
        assert!(prompt.contains("<completeness_check>"));
        assert!(prompt.contains("not complete without"));

        let mgmt_pos = prompt.find("<openforge_task_management>").unwrap();
        let action_pos = prompt.find("Implement this task.").unwrap();
        assert!(mgmt_pos > action_pos, "Task management section should come after action instruction");
    }

    #[test]
    fn test_build_task_prompt_ordering() {
        let task = db::TaskRow {
            id: "T-99".to_string(),
            title: "Ordering test".to_string(),
            status: "backlog".to_string(),
            jira_key: Some("PROJ-10".to_string()),
            jira_title: None,
            jira_status: None,
            jira_assignee: None,
            jira_description: None,
            project_id: None,
            created_at: 0,
            updated_at: 0,
            prompt: Some("Do the work".to_string()),
            summary: None,
        };

        let prompt = build_task_prompt(&task, "Execute!", Some("Project rules here"));

        let instructions_pos = prompt.find("Project rules here").unwrap();
        let task_prompt_pos = prompt.find("Do the work").unwrap();
        let jira_pos = prompt.find("Jira: PROJ-10").unwrap();
        let action_pos = prompt.find("Execute!").unwrap();
        let mgmt_pos = prompt.find("<openforge_task_management>").unwrap();

        assert!(instructions_pos < task_prompt_pos);
        assert!(task_prompt_pos < jira_pos);
        assert!(jira_pos < action_pos);
        assert!(action_pos < mgmt_pos);
    }

    #[test]
    fn test_create_and_record_session_returns_valid_uuid() {
        use crate::db::test_helpers::*;
        let (db, path) = make_test_db("create_session_uuid");
        insert_test_task(&db);
        let db_arc = std::sync::Arc::new(std::sync::Mutex::new(db));

        let result = create_and_record_session(&db_arc, "T-100", None, "claude-code");
        assert!(result.is_ok());
        let session_id = result.unwrap();

        assert_eq!(session_id.len(), 36);
        assert_eq!(session_id.chars().filter(|c| *c == '-').count(), 4);

        drop(db_arc);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_create_and_record_session_generates_unique_ids() {
        use crate::db::test_helpers::*;
        let (db, path) = make_test_db("create_session_unique");
        insert_test_task(&db);
        let db_arc = std::sync::Arc::new(std::sync::Mutex::new(db));

        let id1 = create_and_record_session(&db_arc, "T-100", None, "claude-code").unwrap();
        let id2 = create_and_record_session(&db_arc, "T-100", None, "claude-code").unwrap();
        assert_ne!(id1, id2);

        drop(db_arc);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_create_and_record_session_with_provider_session_id() {
        use crate::db::test_helpers::*;
        let (db, path) = make_test_db("create_session_provider");
        insert_test_task(&db);
        let db_arc = std::sync::Arc::new(std::sync::Mutex::new(db));

        let result = create_and_record_session(&db_arc, "T-100", Some("opencode-sess-xyz"), "opencode");
        assert!(result.is_ok());

        drop(db_arc);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_build_start_response_contains_all_fields() {
        let response = build_start_response("T-100", "sess-abc", "/path/to/worktree", 3000);

        assert_eq!(response["task_id"], "T-100");
        assert_eq!(response["session_id"], "sess-abc");
        assert_eq!(response["worktree_path"], "/path/to/worktree");
        assert_eq!(response["port"], 3000);
    }

    #[test]
    fn test_build_start_response_zero_port() {
        let response = build_start_response("T-200", "sess-def", "/another/path", 0);

        assert_eq!(response["task_id"], "T-200");
        assert_eq!(response["port"], 0);
    }

    #[test]
    fn test_activate_task_status_update_sets_doing_when_backlog() {
        use crate::db::test_helpers::*;
        let (db, path) = make_test_db("activate_task_backlog");
        insert_test_task(&db);
        let db_arc = std::sync::Arc::new(std::sync::Mutex::new(db));

        let task = db_arc.lock().unwrap().get_task("T-100").unwrap().unwrap();
        assert_eq!(task.status, "backlog");

        let result = activate_task_status_update(&db_arc, "T-100", "backlog");
        assert!(result.is_ok());

        let task = db_arc.lock().unwrap().get_task("T-100").unwrap().unwrap();
        assert_eq!(task.status, "doing");

        drop(db_arc);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_activate_task_status_update_skips_non_backlog() {
        use crate::db::test_helpers::*;
        let (db, path) = make_test_db("activate_task_doing");
        insert_test_task(&db);
        let db_arc = std::sync::Arc::new(std::sync::Mutex::new(db));

        db_arc.lock().unwrap().update_task_status("T-100", "doing").unwrap();

        let result = activate_task_status_update(&db_arc, "T-100", "doing");
        assert!(result.is_ok());

        let task = db_arc.lock().unwrap().get_task("T-100").unwrap().unwrap();
        assert_eq!(task.status, "doing");

        drop(db_arc);
        let _ = std::fs::remove_file(&path);
    }

}
