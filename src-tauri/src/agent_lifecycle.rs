use crate::db::{self, AgentSessionRow};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentLifecycleEventKind {
    Started,
    BecameBusy,
    BecameIdle,
    RequestedPermission,
    Failed,
    Ended,
}

/// Provider-agnostic lifecycle notification sent by installed agent adapters.
///
/// This is the seam between provider plugins/extensions/hooks and OpenForge's
/// session state. Provider adapters translate native event names into
/// `kind`, while raw fields are retained only for debugging.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentLifecycleNotification {
    pub provider: String,
    pub task_id: String,
    #[serde(default)]
    pub pty_instance_id: Option<u64>,
    #[serde(default)]
    pub provider_session_id: Option<String>,
    pub kind: AgentLifecycleEventKind,
    #[serde(default)]
    pub raw_event_type: Option<String>,
    #[serde(default)]
    pub raw_status_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentLifecycleStatusChange {
    pub task_id: String,
    pub status: String,
    pub provider: String,
    pub kind: AgentLifecycleEventKind,
    pub pty_instance_id: Option<u64>,
    pub raw_event_type: Option<String>,
    pub raw_status_type: Option<String>,
}

pub fn session_matches_pty_instance(session: &AgentSessionRow, pty_instance_id: u64) -> bool {
    session
        .checkpoint_data
        .as_deref()
        .and_then(|data| serde_json::from_str::<serde_json::Value>(data).ok())
        .and_then(|value| value.get("pty_instance_id").and_then(|id| id.as_u64()))
        == Some(pty_instance_id)
}

pub(crate) fn lifecycle_status_transition(
    kind: AgentLifecycleEventKind,
) -> (&'static str, &'static [&'static str]) {
    match kind {
        AgentLifecycleEventKind::Started | AgentLifecycleEventKind::BecameBusy => (
            "running",
            &[
                "started",
                "completed",
                "paused",
                "failed",
                "interrupted",
                "running",
            ],
        ),
        AgentLifecycleEventKind::BecameIdle | AgentLifecycleEventKind::Ended => {
            ("completed", &["running", "paused", "completed"])
        }
        AgentLifecycleEventKind::RequestedPermission => ("paused", &["running", "paused"]),
        AgentLifecycleEventKind::Failed => ("failed", &["running", "paused", "failed"]),
    }
}

fn provider_session_id_is_persistable(provider: &str, provider_session_id: &str) -> bool {
    provider != "opencode" || provider_session_id.starts_with("ses")
}

pub fn apply_agent_lifecycle_notification(
    db: &db::Database,
    notification: &AgentLifecycleNotification,
) -> Result<Option<AgentLifecycleStatusChange>, String> {
    let Some(session) = db
        .get_latest_session_for_ticket(&notification.task_id)
        .map_err(|e| format!("failed to load latest agent session: {e}"))?
    else {
        return Ok(None);
    };

    if session.provider != notification.provider {
        return Ok(None);
    }

    if matches!(
        notification.provider.as_str(),
        "claude-code" | "pi" | "opencode"
    ) {
        let Some(pty_instance_id) = notification.pty_instance_id else {
            return Ok(None);
        };
        if !session_matches_pty_instance(&session, pty_instance_id) {
            return Ok(None);
        }
    }

    if let Some(provider_session_id) = notification
        .provider_session_id
        .as_deref()
        .filter(|id| !id.is_empty())
        .filter(|id| provider_session_id_is_persistable(&notification.provider, id))
    {
        db.set_agent_session_provider_id(&session.id, &notification.provider, provider_session_id)
            .map_err(|e| format!("failed to persist provider session id: {e}"))?;
    }

    let (target_status, eligible_statuses) = lifecycle_status_transition(notification.kind);

    if !eligible_statuses.is_empty() && !eligible_statuses.contains(&session.status.as_str()) {
        return Ok(None);
    }

    if session.status != target_status {
        db.update_agent_session(
            &session.id,
            &session.stage,
            target_status,
            session.checkpoint_data.as_deref(),
            None,
        )
        .map_err(|e| format!("failed to update agent session status: {e}"))?;
    }

    Ok(Some(AgentLifecycleStatusChange {
        task_id: notification.task_id.clone(),
        status: target_status.to_string(),
        provider: notification.provider.clone(),
        kind: notification.kind,
        pty_instance_id: notification.pty_instance_id,
        raw_event_type: notification.raw_event_type.clone(),
        raw_status_type: notification.raw_status_type.clone(),
    }))
}

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
        prompt.push_str(&format!(r#"<openforge_code_cleanup>
As you work on this task, watch for code that doesn't meet project standards or that should be split into separate concerns. When you encounter such code — whether in files you're modifying or adjacent code you're reading — create a new task for it using the OpenForge CLI or the equivalent task-creation mechanism available in your environment.

Create a task when you find:
- Code that violates the project's established patterns or conventions
- Functions or modules that are doing too many things and should be split up
- Duplicated logic that should be extracted into a shared utility
- Missing or inadequate error handling that deserves its own fix
- Technical debt like TODO/FIXME/HACK comments that represent real work
- Dead code, unused imports, or stale abstractions that should be cleaned up

How to create a cleanup task:
- Run: openforge create-task --initial-prompt "..." --worktree "$PWD" --depends-on "{task_id}"
- Write a clear, actionable prompt (e.g. "Extract shared validation logic from UserForm and AdminForm")
- Do NOT fix these issues yourself — just log them as tasks and stay focused on your current task

Only create tasks for genuine issues worth addressing. Do not create tasks for minor style preferences or trivial nitpicks.
</openforge_code_cleanup>

"#, task_id = task.id));
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
            depends_on: Vec::new(),
            labels: Vec::new(),
        }
    }

    #[test]
    fn test_build_task_prompt_contains_management_and_prompt() {
        let task = sample_task("T-123", "Test Task", None);

        let prompt = build_task_prompt(&task, None, false);

        assert!(prompt.contains("Test Task"));
        assert!(prompt.contains("<openforge_task_management>"));
        assert!(prompt.contains("openforge update-task --task-id \"T-123\" --summary \"...\""));
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
    fn opencode_lifecycle_ignores_message_ids_as_provider_session_ids() {
        use crate::db::test_helpers::*;
        let (db, path) = make_test_db("opencode_ignore_message_provider_id");
        insert_test_task(&db);
        db.create_agent_session(
            "session-row",
            "T-100",
            Some("ses_existing"),
            "implementing",
            "running",
            "opencode",
        )
        .expect("create opencode session");
        db.update_agent_session(
            "session-row",
            "implementing",
            "running",
            Some(r#"{"pty_instance_id":42}"#),
            None,
        )
        .expect("store pty instance");

        apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "opencode".to_string(),
                task_id: "T-100".to_string(),
                pty_instance_id: Some(42),
                provider_session_id: Some("msg_bad123".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("message.updated".to_string()),
                raw_status_type: None,
            },
        )
        .expect("apply lifecycle notification");

        let session = db
            .get_agent_session("session-row")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session.opencode_session_id.as_deref(), Some("ses_existing"));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn opencode_lifecycle_accepts_real_session_ids_as_provider_session_ids() {
        use crate::db::test_helpers::*;
        let (db, path) = make_test_db("opencode_accept_real_provider_id");
        insert_test_task(&db);
        db.create_agent_session(
            "session-row",
            "T-100",
            None,
            "implementing",
            "running",
            "opencode",
        )
        .expect("create opencode session");
        db.update_agent_session(
            "session-row",
            "implementing",
            "running",
            Some(r#"{"pty_instance_id":42}"#),
            None,
        )
        .expect("store pty instance");

        apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "opencode".to_string(),
                task_id: "T-100".to_string(),
                pty_instance_id: Some(42),
                provider_session_id: Some("ses_good123".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("message.updated".to_string()),
                raw_status_type: None,
            },
        )
        .expect("apply lifecycle notification");

        let session = db
            .get_agent_session("session-row")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session.opencode_session_id.as_deref(), Some("ses_good123"));

        let _ = std::fs::remove_file(&path);
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
    fn normalized_lifecycle_kind_drives_status_even_with_unknown_raw_debug_fields() {
        use crate::db::test_helpers::*;
        let (db, path) = make_test_db("normalized_lifecycle_ignores_raw_debug");
        let task = db
            .create_task("OpenCode task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-normalized",
            &task.id,
            None,
            "implementing",
            "completed",
            "opencode",
        )
        .expect("create session");
        db.update_agent_session(
            "ses-normalized",
            "implementing",
            "completed",
            Some(r#"{"pty_instance_id":5}"#),
            None,
        )
        .expect("store pty instance");

        let change = apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "opencode".to_string(),
                task_id: task.id.clone(),
                pty_instance_id: Some(5),
                provider_session_id: Some("ses-5".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("provider.changed.this.name".to_string()),
                raw_status_type: Some("provider-changed-this-status".to_string()),
            },
        )
        .expect("apply lifecycle")
        .expect("status should change");

        assert_eq!(change.status, "running");
        assert_eq!(change.kind, AgentLifecycleEventKind::BecameBusy);
        assert_eq!(change.pty_instance_id, Some(5));
        assert_eq!(
            change.raw_event_type.as_deref(),
            Some("provider.changed.this.name")
        );
        assert_eq!(
            change.raw_status_type.as_deref(),
            Some("provider-changed-this-status")
        );
        let session = db
            .get_agent_session("ses-normalized")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session.status, "running");
        assert_eq!(session.opencode_session_id, Some("ses-5".to_string()));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn claude_lifecycle_requires_matching_pty_instance() {
        use crate::db::test_helpers::*;
        let (db, path) = make_test_db("claude_lifecycle_requires_pty_instance");
        let task = db
            .create_task("Claude task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-claude-pty",
            &task.id,
            None,
            "implementing",
            "completed",
            "claude-code",
        )
        .expect("create session");
        db.update_agent_session(
            "ses-claude-pty",
            "implementing",
            "completed",
            Some(r#"{"pty_instance_id":41}"#),
            None,
        )
        .expect("store pty instance");

        let stale = apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "claude-code".to_string(),
                task_id: task.id.clone(),
                pty_instance_id: Some(99),
                provider_session_id: Some("claude-stale".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("pre-tool-use".to_string()),
                raw_status_type: None,
            },
        )
        .expect("stale lifecycle should not error");
        assert!(stale.is_none());

        let missing_identity = apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "claude-code".to_string(),
                task_id: task.id.clone(),
                pty_instance_id: None,
                provider_session_id: Some("claude-no-pty".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("pre-tool-use".to_string()),
                raw_status_type: None,
            },
        )
        .expect("missing pty identity should not error");
        assert!(missing_identity.is_none());

        let applied = apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "claude-code".to_string(),
                task_id: task.id.clone(),
                pty_instance_id: Some(41),
                provider_session_id: Some("claude-current".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("pre-tool-use".to_string()),
                raw_status_type: None,
            },
        )
        .expect("current lifecycle should apply")
        .expect("status should change");
        assert_eq!(applied.status, "running");

        let session = db
            .get_agent_session("ses-claude-pty")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session.status, "running");
        assert_eq!(
            session.claude_session_id,
            Some("claude-current".to_string())
        );

        let _ = std::fs::remove_file(path);
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
        assert!(prompt.contains(
            "openforge create-task --initial-prompt \"...\" --worktree \"$PWD\" --depends-on \"T-801\""
        ));
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
