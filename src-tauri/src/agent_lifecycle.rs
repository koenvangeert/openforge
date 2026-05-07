use crate::db;

pub fn build_task_prompt(
    task: &db::TaskRow,
    additional_instructions: Option<&str>,
    code_cleanup_enabled: bool,
) -> String {
    let mut prompt = String::new();

    prompt.push_str(&format!(r#"<openforge_task_management>
This task is {task_id}. You MUST update the OpenForge task at both points below — the task is not complete without these updates.

<analysis_update trigger="after_initial_analysis">
Once you understand the scope, run: openforge update-task --task-id "{task_id}" --summary "..."
Write a concise initial-analysis status reflecting the actual work, not the original request verbatim.
Good: "Scoped JWT refresh token rotation in auth middleware" — Bad: "implement the auth thing"
</analysis_update>

<summary_update trigger="before_finalizing">
Before reporting completion, run: openforge update-task --task-id "{task_id}" --summary "..."
Cover: what changed, key decisions, and anything needing attention.
</summary_update>

<completeness_check>
Task is incomplete unless both summary updates were made. If the openforge CLI is unavailable, use the equivalent OpenForge task-update mechanism with the same task id and summary fields. If blocked or abandoned, still update the summary with status and what remains.
</completeness_check>
</openforge_task_management>

"#, task_id = task.id));

    if code_cleanup_enabled {
        prompt.push_str(r#"<openforge_code_cleanup>
As you work on this task, watch for code that doesn't meet project standards or that should be split into separate concerns. When you encounter such code — whether in files you're modifying or adjacent code you're reading — create a new task for it using the OpenForge CLI or the equivalent task-creation mechanism available in your environment.

Create a task when you find:
- Code that violates the project's established patterns or conventions
- Functions or modules that are doing too many things and should be split up
- Duplicated logic that should be extracted into a shared utility
- Missing or inadequate error handling that deserves its own fix
- Technical debt like TODO/FIXME/HACK comments that represent real work
- Dead code, unused imports, or stale abstractions that should be cleaned up

How to create a cleanup task:
- Run: openforge create-task --initial-prompt "..." --worktree "$PWD"
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

pub(crate) fn build_start_response(
    task_id: &str,
    session_id: &str,
    workspace_path: &str,
    port: u16,
) -> serde_json::Value {
    serde_json::json!({
        "task_id": task_id,
        "session_id": session_id,
        "workspace_path": workspace_path,
        "port": port,
    })
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
        assert!(prompt.contains("openforge update-task --task-id \"T-123\" --summary \"...\""));
        assert!(!prompt.contains("The task summary supports Markdown"));
        assert!(!prompt.contains("openforge_update_task"));
        assert!(prompt.contains("T-123"));
        assert!(!prompt.contains("initial_prompt=\"...\""));
        assert!(!prompt.contains("External ticket:"));
    }

    #[test]
    fn test_build_task_prompt_never_requests_initial_prompt_update() {
        let task = sample_task("T-124", "Immutable prompt", None);

        let prompt = build_task_prompt(&task, None, false);

        assert!(prompt.contains("<analysis_update trigger=\"after_initial_analysis\">"));
        assert!(prompt.contains("openforge update-task --task-id \"T-124\" --summary \"...\""));
        assert!(!prompt.contains("openforge_update_task"));
        assert!(!prompt.contains("<initial_prompt_update"));
        assert!(!prompt.contains("initial_prompt=\"...\""));
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
    fn test_build_start_response_uses_workspace_path_without_worktree_alias() {
        let response = build_start_response("T-100", "sess-abc", "/path/to/workspace", 3000);

        assert_eq!(response["task_id"], "T-100");
        assert_eq!(response["session_id"], "sess-abc");
        assert_eq!(response["workspace_path"], "/path/to/workspace");
        assert!(response.get("worktree_path").is_none());
        assert_eq!(response["port"], 3000);
    }

    #[test]
    fn test_build_start_response_zero_port() {
        let response = build_start_response("T-200", "sess-def", "/another/path", 0);

        assert_eq!(response["task_id"], "T-200");
        assert_eq!(response["port"], 0);
    }

    #[test]
    fn test_build_task_prompt_without_code_cleanup() {
        let task = sample_task("T-800", "No cleanup", None);

        let prompt = build_task_prompt(&task, None, false);

        assert!(!prompt.contains("<openforge_code_cleanup>"));
        assert!(!prompt.contains("openforge_create_task"));
        assert!(!prompt.contains("openforge_update_task"));
        assert!(prompt.contains("openforge update-task --task-id \"T-800\" --summary \"...\""));
    }

    #[test]
    fn test_build_task_prompt_with_code_cleanup_enabled() {
        let task = sample_task("T-801", "With cleanup", None);

        let prompt = build_task_prompt(&task, None, true);

        assert!(prompt.contains("<openforge_code_cleanup>"));
        assert!(prompt.contains("</openforge_code_cleanup>"));
        assert!(
            prompt.contains("openforge create-task --initial-prompt \"...\" --worktree \"$PWD\"")
        );
        assert!(prompt.contains("openforge update-task --task-id \"T-801\" --summary \"...\""));
        assert!(!prompt.contains("openforge_create_task"));
        assert!(!prompt.contains("openforge_update_task"));
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
}
