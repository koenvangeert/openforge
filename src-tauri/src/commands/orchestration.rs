use crate::{
    db, git_worktree, pty_manager::PtyManager, server_manager::ServerManager,
    sse_bridge::SseBridgeManager,
};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

pub fn build_task_prompt(
    task: &db::TaskRow,
    additional_instructions: Option<&str>,
    code_cleanup_enabled: bool,
) -> String {
    let mut prompt = String::new();

    prompt.push_str(&format!(r#"<openforge_task_management>
This task is {task_id}. You MUST call `openforge_update_task` at both points below — the task is not complete without these updates.

<initial_prompt_update trigger="after_initial_analysis">
Once you understand the scope, call: openforge_update_task(task_id="{task_id}", initial_prompt="...")
Write a concise description reflecting the actual work, not the original request verbatim.
Good: "Add JWT refresh token rotation to auth middleware" — Bad: "implement the auth thing"
</initial_prompt_update>

<summary_update trigger="before_finalizing">
Before reporting completion, call: openforge_update_task(task_id="{task_id}", summary="...")
Cover: what changed, key decisions, and anything needing attention.
</summary_update>

<completeness_check>
Task is incomplete unless both updates were made. If blocked or abandoned, still update the summary with status and what remains.
</completeness_check>
</openforge_task_management>

"#, task_id = task.id));

    if code_cleanup_enabled {
        prompt.push_str(r#"<openforge_code_cleanup>
As you work on this task, watch for code that doesn't meet project standards or that should be split into separate concerns. When you encounter such code — whether in files you're modifying or adjacent code you're reading — create a new task for it using openforge_create_task.

Create a task when you find:
- Code that violates the project's established patterns or conventions
- Functions or modules that are doing too many things and should be split up
- Duplicated logic that should be extracted into a shared utility
- Missing or inadequate error handling that deserves its own fix
- Technical debt like TODO/FIXME/HACK comments that represent real work
- Dead code, unused imports, or stale abstractions that should be cleaned up

How to create a cleanup task:
- Call: openforge_create_task(initial_prompt="...")
- Write a clear, actionable prompt (e.g. "Extract shared validation logic from UserForm and AdminForm")
- Do NOT fix these issues yourself — just log them as tasks and stay focused on your current task

Only create tasks for genuine issues worth addressing. Do not create tasks for minor style preferences or trivial nitpicks.
</openforge_code_cleanup>

"#);
    }

    if let Some(instructions) = additional_instructions {
        if !instructions.is_empty() {
            prompt.push_str(instructions);
            prompt.push_str("\n\n");
        }
    }

    prompt.push_str(task.prompt.as_deref().unwrap_or(&task.initial_prompt));
    prompt.push('\n');

    prompt
}

pub(crate) fn create_and_record_session(
    db: &std::sync::Arc<std::sync::Mutex<crate::db::Database>>,
    task_id: &str,
    provider_session: &crate::providers::ProviderSessionResult,
    provider_name: &str,
) -> Result<String, String> {
    let agent_session_id = uuid::Uuid::new_v4().to_string();
    db.lock()
        .unwrap()
        .create_agent_session(
            &agent_session_id,
            task_id,
            provider_session.opencode_session_id.as_deref(),
            "implementing",
            "running",
            provider_name,
        )
        .map_err(|e| format!("Failed to create agent session: {}", e))?;

    if let Some(pi_session_id) = provider_session.pi_session_id.as_deref() {
        db.lock()
            .unwrap()
            .set_agent_session_pi_id(&agent_session_id, pi_session_id)
            .map_err(|e| format!("Failed to store Pi session ID: {}", e))?;
    }

    if let Some(pty_instance_id) = provider_session.pty_instance_id {
        let checkpoint_data = serde_json::json!({
            "pty_instance_id": pty_instance_id,
        })
        .to_string();
        db.lock()
            .unwrap()
            .update_agent_session(
                &agent_session_id,
                "implementing",
                "running",
                Some(&checkpoint_data),
                None,
            )
            .map_err(|e| format!("Failed to store PTY instance ID: {}", e))?;
    }

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
        let _ = app.emit(
            "task-changed",
            serde_json::json!({ "action": "updated", "task_id": task_id }),
        );
    }
    Ok(())
}

pub(crate) fn build_start_response(
    task_id: &str,
    session_id: &str,
    workspace_path: &str,
    port: u16,
) -> serde_json::Value {
    serde_json::json!({
        "task_id": task_id,
        "session_id": session_id,
        "worktree_path": workspace_path,
        "workspace_path": workspace_path,
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
        let db_lock = crate::db::acquire_db(db);
        let session = db_lock
            .get_latest_session_for_ticket(task_id)
            .ok()
            .flatten();
        let provider = session
            .as_ref()
            .map(|s| s.provider.clone())
            .unwrap_or_else(|| "claude-code".to_string());
        (provider, session)
    };

    let provider = crate::providers::Provider::from_name(
        &provider_name,
        pty_mgr.inner().clone(),
        server_mgr.inner().clone(),
        sse_mgr.inner().clone(),
    )
    .map_err(|e| format!("Unknown provider: {}", e))?;

    pty_mgr.kill_shells_for_task(task_id).await;

    if let Some(ref s) = session {
        let _ = provider.abort(task_id, s).await;
    }

    if let Some(ref s) = session {
        let db_lock = crate::db::acquire_db(db);
        let status = if provider_name == "claude-code" || provider_name == "pi" {
            "interrupted"
        } else {
            "failed"
        };
        let _ =
            db_lock.update_agent_session(&s.id, &s.stage, status, None, Some("Aborted by user"));
    }

    if provider_name != "claude-code" {
        let db = crate::db::acquire_db(db);
        let _ = db.update_worktree_status(task_id, "stopped");
        let _ = db.update_task_workspace_status(task_id, "stopped");
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
    let (task, project_id_owned, additional_instructions, code_cleanup_enabled, use_worktrees) = {
        let db = crate::db::acquire_db(&db);
        let task = db
            .get_task(&task_id)
            .map_err(|e| format!("Failed to get task: {}", e))?
            .ok_or("Task not found")?;
        let project_id = task.project_id.clone().unwrap_or_default();
        let instructions = db
            .get_project_config(&project_id, "additional_instructions")
            .ok()
            .flatten();
        let cleanup = db
            .get_config("code_cleanup_tasks_enabled")
            .ok()
            .flatten()
            .map(|v| v == "true")
            .unwrap_or(false);
        let worktrees = db.resolve_use_worktrees(&project_id);
        (task, project_id, instructions, cleanup, worktrees)
    };

    let provider_name = {
        let db_lock = crate::db::acquire_db(&db);
        db_lock.resolve_ai_provider(&project_id_owned)
    };

    let provider = crate::providers::Provider::from_name(
        &provider_name,
        pty_mgr.inner().clone(),
        server_mgr.inner().clone(),
        sse_mgr.inner().clone(),
    )
    .map_err(|e| format!("Unknown provider: {}", e))?;

    let (working_dir, workspace_kind, branch_name) = if use_worktrees {
        let branch = git_worktree::slugify_branch_name(
            &task_id,
            task.prompt.as_deref().unwrap_or(&task.initial_prompt),
        );
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

        (worktree_path, "git_worktree", Some(branch))
    } else {
        (std::path::PathBuf::from(&repo_path), "project_dir", None)
    };

    let prompt = build_task_prompt(
        &task,
        additional_instructions.as_deref(),
        code_cleanup_enabled,
    );
    let result = provider
        .start(
            &task_id,
            &working_dir,
            &prompt,
            task.agent.as_deref(),
            task.permission_mode.as_deref(),
            None,
            &app,
        )
        .await?;

    {
        let db = crate::db::acquire_db(&db);
        db.upsert_task_workspace_record(
            &task_id,
            &project_id_owned,
            working_dir.to_str().ok_or("Invalid workspace path")?,
            &repo_path,
            workspace_kind,
            branch_name.as_deref(),
            provider.provider_name(),
            if provider_name == "claude-code" {
                None
            } else {
                Some(result.port as i64)
            },
            "active",
        )
        .map_err(|e| format!("Failed to persist task workspace: {}", e))?;
    }

    if use_worktrees && provider_name != "claude-code" {
        let db = crate::db::acquire_db(&db);
        db.update_worktree_server(&task_id, result.port as i64, 0)
            .map_err(|e| e.to_string())?;
    }

    let agent_session_id =
        create_and_record_session(db.inner(), &task_id, &result, provider.provider_name())?;

    activate_task(db.inner(), &app, &task_id, &task.status)?;

    Ok(build_start_response(
        &task_id,
        &agent_session_id,
        working_dir.to_str().unwrap(),
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
    let _ = app.emit(
        "task-changed",
        serde_json::json!({ "action": "updated", "task_id": task_id }),
    );
    Ok(())
}

#[tauri::command]
pub async fn finalize_claude_session(
    db: State<'_, Arc<Mutex<db::Database>>>,
    app: tauri::AppHandle,
    task_id: String,
    success: bool,
) -> Result<(), String> {
    let db_lock = crate::db::acquire_db(&db);
    if let Ok(Some(session)) = db_lock.get_latest_session_for_ticket(&task_id) {
        if matches!(session.provider.as_str(), "claude-code" | "pi") && session.status == "running"
        {
            let next_status = if session.provider == "pi" && success {
                "completed"
            } else {
                "interrupted"
            };
            let error_message = if next_status == "completed" {
                None
            } else {
                Some("PTY process exited")
            };
            let _ = db_lock.update_agent_session(
                &session.id,
                &session.stage,
                next_status,
                None,
                error_message,
            );
            drop(db_lock);
            let _ = app.emit(
                "agent-status-changed",
                serde_json::json!({
                    "task_id": task_id,
                    "status": next_status,
                    "provider": session.provider
                }),
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_task(id: &str, initial_prompt: &str, prompt: Option<&str>) -> db::TaskRow {
        db::TaskRow {
            id: id.to_string(),
            initial_prompt: initial_prompt.to_string(),
            status: "backlog".to_string(),
            project_id: None,
            created_at: 0,
            updated_at: 0,
            prompt: prompt.map(|value| value.to_string()),
            summary: None,
            agent: None,
            permission_mode: None,
        }
    }

    #[test]
    fn test_build_task_prompt_contains_management_and_prompt() {
        let task = sample_task("T-123", "Test Task", None);

        let prompt = build_task_prompt(&task, None, false);

        assert!(prompt.contains("Test Task"));
        assert!(prompt.contains("<openforge_task_management>"));
        assert!(prompt.contains("openforge_update_task"));
        assert!(prompt.contains("T-123"));
        assert!(!prompt.contains("External ticket:"));
    }

    #[test]
    fn test_build_task_prompt_uses_prompt_over_initial_prompt() {
        let task = sample_task(
            "T-456",
            "Initial title",
            Some("Specific implementation prompt"),
        );

        let prompt = build_task_prompt(&task, None, false);

        assert!(prompt.contains("Specific implementation prompt"));
        assert!(!prompt.contains("\nInitial title\n"));
    }

    #[test]
    fn test_build_task_prompt_with_additional_instructions_ordering() {
        let task = sample_task("T-789", "Task Body", Some("Do the work"));

        let prompt = build_task_prompt(&task, Some("Project rules here"), false);

        let mgmt_pos = prompt.find("<openforge_task_management>").unwrap();
        let instructions_pos = prompt.find("Project rules here").unwrap();
        let task_prompt_pos = prompt.find("Do the work").unwrap();

        assert!(mgmt_pos < instructions_pos);
        assert!(instructions_pos < task_prompt_pos);
        assert!(!prompt.contains("External ticket:"));
    }

    #[test]
    fn test_create_and_record_session_returns_valid_uuid() {
        use crate::db::test_helpers::*;
        let (db, path) = make_test_db("create_session_uuid");
        insert_test_task(&db);
        let db_arc = std::sync::Arc::new(std::sync::Mutex::new(db));

        let result = create_and_record_session(
            &db_arc,
            "T-100",
            &crate::providers::ProviderSessionResult {
                port: 0,
                opencode_session_id: None,
                pi_session_id: None,
                pty_instance_id: None,
            },
            "claude-code",
        );
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

        let provider_session = crate::providers::ProviderSessionResult {
            port: 0,
            opencode_session_id: None,
            pi_session_id: None,
            pty_instance_id: None,
        };
        let id1 =
            create_and_record_session(&db_arc, "T-100", &provider_session, "claude-code").unwrap();
        let id2 =
            create_and_record_session(&db_arc, "T-100", &provider_session, "claude-code").unwrap();
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

        let result = create_and_record_session(
            &db_arc,
            "T-100",
            &crate::providers::ProviderSessionResult {
                port: 0,
                opencode_session_id: Some("opencode-sess-xyz".to_string()),
                pi_session_id: None,
                pty_instance_id: None,
            },
            "opencode",
        );
        assert!(result.is_ok());

        drop(db_arc);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_create_and_record_session_with_pty_instance_id() {
        use crate::db::test_helpers::*;
        let (db, path) = make_test_db("create_session_pty_instance");
        insert_test_task(&db);
        let db_arc = std::sync::Arc::new(std::sync::Mutex::new(db));

        let session_id = create_and_record_session(
            &db_arc,
            "T-100",
            &crate::providers::ProviderSessionResult {
                port: 0,
                opencode_session_id: None,
                pi_session_id: None,
                pty_instance_id: Some(42),
            },
            "pi",
        )
        .expect("create session");

        let session = db_arc
            .lock()
            .expect("lock db")
            .get_agent_session(&session_id)
            .expect("get session")
            .expect("session exists");
        assert_eq!(
            session.checkpoint_data,
            Some(r#"{"pty_instance_id":42}"#.to_string())
        );

        drop(db_arc);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_build_start_response_contains_all_fields() {
        let response = build_start_response("T-100", "sess-abc", "/path/to/worktree", 3000);

        assert_eq!(response["task_id"], "T-100");
        assert_eq!(response["session_id"], "sess-abc");
        assert_eq!(response["worktree_path"], "/path/to/worktree");
        assert_eq!(response["workspace_path"], "/path/to/worktree");
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
    fn test_build_task_prompt_without_code_cleanup() {
        let task = sample_task("T-800", "No cleanup", None);

        let prompt = build_task_prompt(&task, None, false);

        assert!(!prompt.contains("<openforge_code_cleanup>"));
        assert!(!prompt.contains("openforge_create_task"));
        assert!(prompt.contains("openforge_update_task"));
    }

    #[test]
    fn test_build_task_prompt_with_code_cleanup_enabled() {
        let task = sample_task("T-801", "With cleanup", None);

        let prompt = build_task_prompt(&task, None, true);

        assert!(prompt.contains("<openforge_code_cleanup>"));
        assert!(prompt.contains("</openforge_code_cleanup>"));
        assert!(prompt.contains("openforge_create_task"));
        assert!(prompt.contains("openforge_update_task"));
    }

    #[test]
    fn test_build_task_prompt_code_cleanup_ordering() {
        let task = sample_task("T-802", "Cleanup ordering", None);

        let prompt = build_task_prompt(&task, None, true);

        let mgmt_pos = prompt.find("<openforge_task_management>").unwrap();
        let cleanup_pos = prompt.find("<openforge_code_cleanup>").unwrap();
        let task_prompt_pos = prompt.find("Cleanup ordering").unwrap();

        // Cleanup section should be after task management but before the task prompt
        assert!(
            mgmt_pos < cleanup_pos,
            "Task management should come before code cleanup"
        );
        assert!(
            cleanup_pos < task_prompt_pos,
            "Code cleanup should come before task prompt"
        );
    }

    #[test]
    fn test_activate_task_status_update_skips_non_backlog() {
        use crate::db::test_helpers::*;
        let (db, path) = make_test_db("activate_task_doing");
        insert_test_task(&db);
        let db_arc = std::sync::Arc::new(std::sync::Mutex::new(db));

        db_arc
            .lock()
            .unwrap()
            .update_task_status("T-100", "doing")
            .unwrap();

        let result = activate_task_status_update(&db_arc, "T-100", "doing");
        assert!(result.is_ok());

        let task = db_arc.lock().unwrap().get_task("T-100").unwrap().unwrap();
        assert_eq!(task.status, "doing");

        drop(db_arc);
        let _ = std::fs::remove_file(&path);
    }
}
