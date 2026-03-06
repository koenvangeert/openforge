use axum::{
    extract::{State, Json, Path},
    routing::{post, get},
    Router,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Mutex};
use crate::db;
use tauri::Emitter;

/// Request to create a new task from OpenCode
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTaskRequest {
    pub title: String,
    pub project_id: Option<String>,
    /// Worktree path of the calling session - used to deduce project_id if not provided
    pub worktree: Option<String>,
}

#[derive(Clone)]
pub struct AppState {
    pub app: tauri::AppHandle,
    pub db: std::sync::Arc<Mutex<db::Database>>,
}

/// Response containing the created task ID
#[derive(Debug, Clone, Serialize)]
pub struct CreateTaskResponse {
    pub task_id: String,
    pub project_id: Option<String>,
    pub status: String,
}

/// Request to update a task's title and/or summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTaskRequest {
    pub task_id: String,
    pub title: Option<String>,
    pub summary: Option<String>,
}

/// Response containing the updated task ID
#[derive(Debug, Clone, Serialize)]
pub struct UpdateTaskResponse {
    pub task_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GetTaskInfoResponse {
    pub id: String,
    pub title: String,
    pub prompt: Option<String>,
    pub summary: Option<String>,
    pub status: String,
    pub jira_key: Option<String>,
}

/// Payload from Claude Code hooks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeHookPayload {
    pub session_id: Option<String>,
    pub tool_name: Option<String>,
    pub tool_input: Option<serde_json::Value>,
    pub transcript_path: Option<String>,
    #[serde(alias = "CLAUDE_TASK_ID")]
    pub claude_task_id: Option<String>,
}

/// Handle create_task requests from OpenCode sessions
///
/// Creates a new task in the database with "backlog" status and
/// emits a "task-changed" event to notify the frontend.
///
/// If project_id is not provided but worktree is, attempts to deduce
/// the project from the calling session's worktree.
pub async fn create_task_handler(
    State(state): State<AppState>,
    Json(request): Json<CreateTaskRequest>,
) -> Result<Json<CreateTaskResponse>, StatusCode> {
    let db = state.db.lock().unwrap();

    // Deduce project_id from worktree if not explicitly provided
    let project_id = match request.project_id {
        Some(ref id) if !id.is_empty() => Some(id.clone()),
        _ => {
            // Try to deduce from worktree path
            if let Some(ref worktree) = request.worktree {
                db.get_project_for_worktree(worktree)
                    .ok()
                    .flatten()
            } else {
                None
            }
        }
    };

    let task = db.create_task(
        &request.title,
        "backlog",
        None,
        project_id.as_deref(),
        None,
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    drop(db);

    let _ = state.app.emit(
        "task-changed",
        serde_json::json!({
            "action": "created",
            "task_id": task.id,
            "project_id": task.project_id
        })
    );

    Ok(Json(CreateTaskResponse {
        task_id: task.id,
        project_id: task.project_id,
        status: "created".to_string(),
    }))
}

pub async fn update_task_handler(
    State(state): State<AppState>,
    Json(request): Json<UpdateTaskRequest>,
) -> Result<Json<UpdateTaskResponse>, StatusCode> {
    if request.title.is_none() && request.summary.is_none() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let db = state.db.lock().unwrap();

    db.update_task_title_and_summary(
        &request.task_id,
        request.title.as_deref(),
        request.summary.as_deref(),
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    drop(db);

    let _ = state.app.emit(
        "task-changed",
        serde_json::json!({
            "action": "updated",
            "task_id": request.task_id
        })
    );

    Ok(Json(UpdateTaskResponse {
        task_id: request.task_id,
        status: "updated".to_string(),
    }))
}

pub async fn get_task_info_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<GetTaskInfoResponse>, StatusCode> {
    let db = state.db.lock().unwrap();

    match db.get_task(&id).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? {
        Some(task) => Ok(Json(GetTaskInfoResponse {
            id: task.id,
            title: task.title,
            prompt: task.prompt,
            summary: task.summary,
            status: task.status,
            jira_key: task.jira_key,
        })),
        None => Err(StatusCode::NOT_FOUND),
    }
}

pub(crate) fn map_hook_to_status(event_type: &str, current_status: &str) -> Option<String> {
    match event_type {
        "pre-tool-use" | "post-tool-use" => {
            if current_status != "running" {
                Some("running".to_string())
            } else {
                None
            }
        }
        "stop" | "session-end" => Some("completed".to_string()),
        "notification-permission" => {
            if current_status == "running" {
                Some("paused".to_string())
            } else {
                None
            }
        }
        _ => None,
    }
}

async fn handle_hook(
    State(state): State<AppState>,
    Json(payload): Json<ClaudeHookPayload>,
    event_type: &str,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if let Some(task_id) = &payload.claude_task_id {
        let payload_value = serde_json::to_value(&payload).unwrap_or(serde_json::json!({}));
        let _ = state.app.emit(
            "claude-hook-event",
            serde_json::json!({
                "task_id": task_id,
                "event_type": event_type,
                "payload": payload_value
            })
        );

        let status_update: Option<String> = {
            let db = state.db.lock().unwrap();
            if let Ok(Some(session)) = db.get_latest_session_for_ticket(task_id) {
                if session.provider == "claude-code" {
                    // Persist the Claude session ID on first hook so run_action can resume it later
                    if session.claude_session_id.is_none() {
                        if let Some(ref sid) = payload.session_id {
                            if !sid.is_empty() {
                                if let Err(e) = db.set_agent_session_claude_id(&session.id, sid) {
                                    eprintln!("[http_server] Failed to set claude_session_id for session {}: {}", session.id, e);
                                }
                            }
                        }
                    }

                    if let Some(new_status) = map_hook_to_status(event_type, &session.status) {
                        if let Err(e) = db.update_agent_session(&session.id, &session.stage, &new_status, None, None) {
                            eprintln!("[http_server] Failed to update session status for task {}: {}", task_id, e);
                        }
                        Some(new_status)
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some(new_status) = status_update {
            let _ = state.app.emit(
                "agent-status-changed",
                serde_json::json!({
                    "task_id": task_id,
                    "status": new_status,
                    "provider": "claude-code"
                })
            );
        }
    } else {
        eprintln!("[http_server] Warning: Hook event '{}' received without CLAUDE_TASK_ID", event_type);
    }

    Ok(Json(serde_json::json!({ "status": "ok" })))
}

pub async fn hook_stop_handler(
    State(state): State<AppState>,
    Json(payload): Json<ClaudeHookPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_hook(State(state), Json(payload), "stop").await
}

pub async fn hook_pre_tool_use_handler(
    State(state): State<AppState>,
    Json(payload): Json<ClaudeHookPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_hook(State(state), Json(payload), "pre-tool-use").await
}

pub async fn hook_post_tool_use_handler(
    State(state): State<AppState>,
    Json(payload): Json<ClaudeHookPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_hook(State(state), Json(payload), "post-tool-use").await
}

pub async fn hook_session_end_handler(
    State(state): State<AppState>,
    Json(payload): Json<ClaudeHookPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_hook(State(state), Json(payload), "session-end").await
}

pub async fn hook_notification_handler(
    State(state): State<AppState>,
    Json(payload): Json<ClaudeHookPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_hook(State(state), Json(payload), "notification").await
}

pub async fn hook_notification_permission_handler(
    State(state): State<AppState>,
    Json(payload): Json<ClaudeHookPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_hook(State(state), Json(payload), "notification-permission").await
}

/// Create the HTTP router with all available routes
pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/create_task", post(create_task_handler))
        .route("/update_task", post(update_task_handler))
        .route("/task/:id", get(get_task_info_handler))
        .route("/hooks/stop", post(hook_stop_handler))
        .route("/hooks/pre-tool-use", post(hook_pre_tool_use_handler))
        .route("/hooks/post-tool-use", post(hook_post_tool_use_handler))
        .route("/hooks/session-end", post(hook_session_end_handler))
        .route("/hooks/notification", post(hook_notification_handler))
        .route("/hooks/notification-permission", post(hook_notification_permission_handler))
        .with_state(state)
}

/// Start the HTTP server on the configured port
/// 
/// The server listens on 127.0.0.1 (localhost only) to ensure
/// it's not exposed to the external network.
/// 
/// The port can be configured via the AI_COMMAND_CENTER_PORT
/// environment variable, defaulting to 17422.
pub async fn start_http_server(
    app: tauri::AppHandle,
    db: std::sync::Arc<Mutex<db::Database>>,
    ready_tx: tokio::sync::oneshot::Sender<()>,
) -> Result<(), Box<dyn std::error::Error>> {
    let port = std::env::var("AI_COMMAND_CENTER_PORT")
        .unwrap_or_else(|_| "17422".to_string())
        .parse::<u16>()
        .unwrap_or(17422);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let state = AppState { app, db };
    let router = create_router(state);

    println!("[http_server] Starting on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    // Signal that the server is listening before entering the serve loop
    let _ = ready_tx.send(());
    axum::serve(listener, router).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================================================
    // CreateTaskRequest Tests
    // ========================================================================

    #[test]
    fn test_create_task_request_ignores_unknown_description_field() {
        // Backward compat: old tool files may still send "description" field
        // serde ignores unknown fields by default, so this should deserialize without error
        let json = r#"{"title": "Test", "description": "old field still sent"}"#;
        let req: CreateTaskRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.title, "Test");
        // description field is silently ignored — no panic, no error
    }

    // ========================================================================
    // map_hook_to_status Tests
    // ========================================================================

    #[test]
    fn test_pre_tool_use_transitions_from_non_running_to_running() {
        assert_eq!(map_hook_to_status("pre-tool-use", "paused"), Some("running".to_string()));
        assert_eq!(map_hook_to_status("pre-tool-use", "completed"), Some("running".to_string()));
        assert_eq!(map_hook_to_status("pre-tool-use", "failed"), Some("running".to_string()));
        assert_eq!(map_hook_to_status("pre-tool-use", "interrupted"), Some("running".to_string()));
    }

    #[test]
    fn test_pre_tool_use_no_op_when_already_running() {
        assert_eq!(map_hook_to_status("pre-tool-use", "running"), None);
    }

    #[test]
    fn test_post_tool_use_transitions_from_non_running_to_running() {
        assert_eq!(map_hook_to_status("post-tool-use", "paused"), Some("running".to_string()));
        assert_eq!(map_hook_to_status("post-tool-use", "completed"), Some("running".to_string()));
    }

    #[test]
    fn test_post_tool_use_no_op_when_already_running() {
        assert_eq!(map_hook_to_status("post-tool-use", "running"), None);
    }

    #[test]
    fn test_stop_always_maps_to_completed() {
        assert_eq!(map_hook_to_status("stop", "running"), Some("completed".to_string()));
        assert_eq!(map_hook_to_status("stop", "paused"), Some("completed".to_string()));
        assert_eq!(map_hook_to_status("stop", "completed"), Some("completed".to_string()));
    }

    #[test]
    fn test_session_end_always_maps_to_completed() {
        assert_eq!(map_hook_to_status("session-end", "running"), Some("completed".to_string()));
        assert_eq!(map_hook_to_status("session-end", "paused"), Some("completed".to_string()));
    }

    #[test]
    fn test_notification_produces_no_status_change() {
        assert_eq!(map_hook_to_status("notification", "running"), None);
        assert_eq!(map_hook_to_status("notification", "paused"), None);
    }

    #[test]
    fn test_notification_permission_maps_running_to_paused() {
        assert_eq!(map_hook_to_status("notification-permission", "running"), Some("paused".to_string()));
    }

    #[test]
    fn test_notification_permission_no_op_when_not_running() {
        assert_eq!(map_hook_to_status("notification-permission", "paused"), None);
        assert_eq!(map_hook_to_status("notification-permission", "completed"), None);
        assert_eq!(map_hook_to_status("notification-permission", "interrupted"), None);
    }

    #[test]
    fn test_unknown_event_type_produces_no_status_change() {
        assert_eq!(map_hook_to_status("unknown-event", "running"), None);
        assert_eq!(map_hook_to_status("", "running"), None);
    }

    #[test]
    fn test_create_task_request_creation() {
        let request = CreateTaskRequest {
            title: "Test Task".to_string(),
            project_id: Some("PROJ-1".to_string()),
            worktree: Some("/path/to/wt".to_string()),
        };
        assert_eq!(request.title, "Test Task");
        assert_eq!(request.project_id, Some("PROJ-1".to_string()));
    }

    #[test]
    fn test_create_task_request_minimal_fields() {
        let request = CreateTaskRequest {
            title: "Minimal Task".to_string(),
            project_id: None,
            worktree: None,
        };
        assert_eq!(request.title, "Minimal Task");
        assert!(request.project_id.is_none());
    }

    #[test]
    fn test_create_task_request_deserialize_all_fields() {
        let json = r#"{"title": "Implement Feature X", "project_id": "PROJ-42", "worktree": "/path/to/wt"}"#;
        let request: CreateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.title, "Implement Feature X");
        assert_eq!(request.project_id, Some("PROJ-42".to_string()));
        assert_eq!(request.worktree, Some("/path/to/wt".to_string()));
    }

    #[test]
    fn test_create_task_request_deserialize_only_required() {
        let json = r#"{"title": "Simple Task"}"#;
        let request: CreateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.title, "Simple Task");
        assert!(request.project_id.is_none());
    }

    #[test]
    fn test_create_task_request_deserialize_partial_optional() {
        // Only project_id provided, no worktree
        let json = r#"{"title": "Task with project", "project_id": "PROJ-99"}"#;
        let request: CreateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.title, "Task with project");
        assert_eq!(request.project_id, Some("PROJ-99".to_string()));
        assert!(request.worktree.is_none());
    }

    #[test]
    fn test_create_task_request_deserialize_empty_strings() {
        let json = r#"{"title": "", "project_id": "", "worktree": ""}"#;
        let request: CreateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.title, "");
        assert_eq!(request.project_id, Some("".to_string()));
        assert_eq!(request.worktree, Some("".to_string()));
    }

    #[test]
    fn test_create_task_request_deserialize_missing_title_fails() {
        let json = r#"{"project_id": "PROJ-1"}"#;
        let result: Result<CreateTaskRequest, _> = serde_json::from_str(json);
        assert!(result.is_err(), "Should fail without required title field");
    }

    #[test]
    fn test_create_task_request_serialize_roundtrip() {
        let original = CreateTaskRequest {
            title: "Roundtrip Test".to_string(),
            project_id: Some("PROJ-99".to_string()),
            worktree: Some("/path/to/worktree".to_string()),
        };
        let json = serde_json::to_string(&original).expect("Failed to serialize");
        let deserialized: CreateTaskRequest = serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.title, original.title);
        assert_eq!(deserialized.project_id, original.project_id);
        assert_eq!(deserialized.worktree, original.worktree);
    }

    // ========================================================================
    // CreateTaskResponse Tests
    // ========================================================================

    #[test]
    fn test_create_task_response_creation() {
        let response = CreateTaskResponse {
            task_id: "T-123".to_string(),
            project_id: Some("P-1".to_string()),
            status: "created".to_string(),
        };
        assert_eq!(response.task_id, "T-123");
        assert_eq!(response.project_id, Some("P-1".to_string()));
        assert_eq!(response.status, "created");
    }

    #[test]
    fn test_create_task_response_serialize() {
        let response = CreateTaskResponse {
            task_id: "T-456".to_string(),
            project_id: None,
            status: "created".to_string(),
        };
        let json = serde_json::to_string(&response).expect("Failed to serialize");
        assert!(json.contains("\"task_id\":\"T-456\""));
        assert!(json.contains("\"status\":\"created\""));
    }

    #[test]
    fn test_create_task_response_json_structure() {
        let response = CreateTaskResponse {
            task_id: "T-789".to_string(),
            project_id: Some("P-2".to_string()),
            status: "created".to_string(),
        };
        let json_value = serde_json::to_value(&response).expect("Failed to convert to JSON value");
        assert_eq!(json_value["task_id"], "T-789");
        assert_eq!(json_value["project_id"], "P-2");
        assert_eq!(json_value["status"], "created");
    }

    // ========================================================================
    // ClaudeHookPayload Tests
    // ========================================================================

    #[test]
    fn test_claude_hook_payload_deserialize_with_claude_task_id() {
        let json = r#"{"session_id": "sess-123", "tool_name": "bash", "CLAUDE_TASK_ID": "task-456"}"#;
        let payload: ClaudeHookPayload = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(payload.session_id, Some("sess-123".to_string()));
        assert_eq!(payload.tool_name, Some("bash".to_string()));
        assert_eq!(payload.claude_task_id, Some("task-456".to_string()));
        assert!(payload.tool_input.is_none());
        assert!(payload.transcript_path.is_none());
    }

    #[test]
    fn test_claude_hook_payload_deserialize_with_claude_task_id_lowercase() {
        let json = r#"{"session_id": "sess-789", "claude_task_id": "task-999"}"#;
        let payload: ClaudeHookPayload = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(payload.session_id, Some("sess-789".to_string()));
        assert_eq!(payload.claude_task_id, Some("task-999".to_string()));
    }

    #[test]
    fn test_claude_hook_payload_deserialize_all_fields() {
        let json = r#"{
            "session_id": "sess-123",
            "tool_name": "bash",
            "tool_input": {"cmd": "ls -la"},
            "transcript_path": "/path/to/transcript",
            "CLAUDE_TASK_ID": "task-456"
        }"#;
        let payload: ClaudeHookPayload = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(payload.session_id, Some("sess-123".to_string()));
        assert_eq!(payload.tool_name, Some("bash".to_string()));
        assert!(payload.tool_input.is_some());
        assert_eq!(payload.transcript_path, Some("/path/to/transcript".to_string()));
        assert_eq!(payload.claude_task_id, Some("task-456".to_string()));
    }

    #[test]
    fn test_claude_hook_payload_deserialize_missing_task_id() {
        let json = r#"{"session_id": "sess-123", "tool_name": "bash"}"#;
        let payload: ClaudeHookPayload = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(payload.session_id, Some("sess-123".to_string()));
        assert!(payload.claude_task_id.is_none());
    }

    #[test]
    fn test_claude_hook_payload_deserialize_empty_object() {
        let json = r#"{}"#;
        let payload: ClaudeHookPayload = serde_json::from_str(json).expect("Failed to deserialize");
        assert!(payload.session_id.is_none());
        assert!(payload.tool_name.is_none());
        assert!(payload.tool_input.is_none());
        assert!(payload.transcript_path.is_none());
        assert!(payload.claude_task_id.is_none());
    }

    #[test]
    fn test_claude_hook_payload_deserialize_malformed_json() {
        let json = r#"{"session_id": "sess-123", invalid json}"#;
        let result: Result<ClaudeHookPayload, _> = serde_json::from_str(json);
        assert!(result.is_err(), "Should fail with malformed JSON");
    }

    #[test]
    fn test_claude_hook_payload_creation() {
        let payload = ClaudeHookPayload {
            session_id: Some("sess-123".to_string()),
            tool_name: Some("bash".to_string()),
            tool_input: Some(serde_json::json!({"cmd": "ls"})),
            transcript_path: Some("/path".to_string()),
            claude_task_id: Some("task-456".to_string()),
        };
        assert_eq!(payload.session_id, Some("sess-123".to_string()));
        assert_eq!(payload.claude_task_id, Some("task-456".to_string()));
    }

    #[test]
    fn test_map_hook_to_status_full_lifecycle() {
        let mut status = "started".to_string();

        if let Some(s) = map_hook_to_status("pre-tool-use", &status) {
            status = s;
        }
        assert_eq!(status, "running");

        if let Some(s) = map_hook_to_status("pre-tool-use", &status) {
            status = s;
        }
        assert_eq!(status, "running", "Already running — no change");

        if let Some(s) = map_hook_to_status("post-tool-use", &status) {
            status = s;
        }
        assert_eq!(status, "running", "post-tool-use when running — no change");

        // Permission prompt pauses the session
        if let Some(s) = map_hook_to_status("notification-permission", &status) {
            status = s;
        }
        assert_eq!(status, "paused", "notification-permission transitions running→paused");

        // Tool use resumes from paused
        if let Some(s) = map_hook_to_status("pre-tool-use", &status) {
            status = s;
        }
        assert_eq!(status, "running", "Resumed: pre-tool-use transitions paused→running");

        if let Some(s) = map_hook_to_status("stop", &status) {
            status = s;
        }
        assert_eq!(status, "completed");

        if let Some(s) = map_hook_to_status("pre-tool-use", &status) {
            status = s;
        }
        assert_eq!(status, "running", "Resumed: pre-tool-use transitions completed→running");

        if let Some(s) = map_hook_to_status("session-end", &status) {
            status = s;
        }
        assert_eq!(status, "completed");
    }

    // ========================================================================
    // UpdateTaskRequest Tests
    // ========================================================================

    #[test]
    fn test_update_task_request_creation() {
        let request = UpdateTaskRequest {
            task_id: "T-123".to_string(),
            title: Some("New Title".to_string()),
            summary: Some("New Summary".to_string()),
        };
        assert_eq!(request.task_id, "T-123");
        assert_eq!(request.title, Some("New Title".to_string()));
        assert_eq!(request.summary, Some("New Summary".to_string()));
    }

    #[test]
    fn test_update_task_request_deserialize_all_fields() {
        let json = r#"{"task_id": "T-456", "title": "Updated Title", "summary": "Updated Summary"}"#;
        let request: UpdateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.task_id, "T-456");
        assert_eq!(request.title, Some("Updated Title".to_string()));
        assert_eq!(request.summary, Some("Updated Summary".to_string()));
    }

    #[test]
    fn test_update_task_request_deserialize_title_only() {
        let json = r#"{"task_id": "T-789", "title": "Only Title"}"#;
        let request: UpdateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.task_id, "T-789");
        assert_eq!(request.title, Some("Only Title".to_string()));
        assert!(request.summary.is_none());
    }

    #[test]
    fn test_update_task_request_deserialize_summary_only() {
        let json = r#"{"task_id": "T-999", "summary": "Only Summary"}"#;
        let request: UpdateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.task_id, "T-999");
        assert!(request.title.is_none());
        assert_eq!(request.summary, Some("Only Summary".to_string()));
    }

    #[test]
    fn test_update_task_request_deserialize_neither_title_nor_summary() {
        let json = r#"{"task_id": "T-111"}"#;
        let request: UpdateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.task_id, "T-111");
        assert!(request.title.is_none());
        assert!(request.summary.is_none());
    }

    #[test]
    fn test_update_task_request_deserialize_missing_task_id_fails() {
        let json = r#"{"title": "No Task ID"}"#;
        let result: Result<UpdateTaskRequest, _> = serde_json::from_str(json);
        assert!(result.is_err(), "Should fail without required task_id field");
    }

    #[test]
    fn test_update_task_request_serialize_roundtrip() {
        let original = UpdateTaskRequest {
            task_id: "T-555".to_string(),
            title: Some("Roundtrip Title".to_string()),
            summary: Some("Roundtrip Summary".to_string()),
        };
        let json = serde_json::to_string(&original).expect("Failed to serialize");
        let deserialized: UpdateTaskRequest = serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.task_id, original.task_id);
        assert_eq!(deserialized.title, original.title);
        assert_eq!(deserialized.summary, original.summary);
    }

    // ========================================================================
    // UpdateTaskResponse Tests
    // ========================================================================

    #[test]
    fn test_update_task_response_creation() {
        let response = UpdateTaskResponse {
            task_id: "T-123".to_string(),
            status: "updated".to_string(),
        };
        assert_eq!(response.task_id, "T-123");
        assert_eq!(response.status, "updated");
    }

    #[test]
    fn test_update_task_response_serialize() {
        let response = UpdateTaskResponse {
            task_id: "T-456".to_string(),
            status: "updated".to_string(),
        };
        let json = serde_json::to_string(&response).expect("Failed to serialize");
        assert!(json.contains("\"task_id\":\"T-456\""));
        assert!(json.contains("\"status\":\"updated\""));
    }

    #[test]
    fn test_update_task_response_json_structure() {
        let response = UpdateTaskResponse {
            task_id: "T-789".to_string(),
            status: "updated".to_string(),
        };
        let json_value = serde_json::to_value(&response).expect("Failed to convert to JSON value");
        assert_eq!(json_value["task_id"], "T-789");
        assert_eq!(json_value["status"], "updated");
    }

    // ========================================================================
    // GetTaskInfoResponse Tests
    // ========================================================================

    #[test]
    fn test_get_task_info_response_creation_all_fields() {
        let response = GetTaskInfoResponse {
            id: "T-42".to_string(),
            title: "My Task".to_string(),
            prompt: Some("Do something cool".to_string()),
            summary: Some("Did the thing".to_string()),
            status: "doing".to_string(),
            jira_key: Some("PROJ-1".to_string()),
        };
        assert_eq!(response.id, "T-42");
        assert_eq!(response.title, "My Task");
        assert_eq!(response.prompt, Some("Do something cool".to_string()));
        assert_eq!(response.summary, Some("Did the thing".to_string()));
        assert_eq!(response.status, "doing");
        assert_eq!(response.jira_key, Some("PROJ-1".to_string()));
    }

    #[test]
    fn test_get_task_info_response_creation_nullable_fields_none() {
        let response = GetTaskInfoResponse {
            id: "T-1".to_string(),
            title: "Simple Task".to_string(),
            prompt: None,
            summary: None,
            status: "backlog".to_string(),
            jira_key: None,
        };
        assert!(response.prompt.is_none());
        assert!(response.summary.is_none());
        assert!(response.jira_key.is_none());
    }

    #[test]
    fn test_get_task_info_response_serialize_all_fields() {
        let response = GetTaskInfoResponse {
            id: "T-99".to_string(),
            title: "Full Task".to_string(),
            prompt: Some("Implement X".to_string()),
            summary: Some("Implemented X".to_string()),
            status: "done".to_string(),
            jira_key: Some("PROJ-99".to_string()),
        };
        let json = serde_json::to_string(&response).expect("Failed to serialize");
        assert!(json.contains("\"id\":\"T-99\""));
        assert!(json.contains("\"title\":\"Full Task\""));
        assert!(json.contains("\"prompt\":\"Implement X\""));
        assert!(json.contains("\"summary\":\"Implemented X\""));
        assert!(json.contains("\"status\":\"done\""));
        assert!(json.contains("\"jira_key\":\"PROJ-99\""));
    }

    #[test]
    fn test_get_task_info_response_serialize_nulls() {
        let response = GetTaskInfoResponse {
            id: "T-1".to_string(),
            title: "Minimal".to_string(),
            prompt: None,
            summary: None,
            status: "backlog".to_string(),
            jira_key: None,
        };
        let json_value = serde_json::to_value(&response).expect("Failed to serialize");
        assert_eq!(json_value["id"], "T-1");
        assert_eq!(json_value["title"], "Minimal");
        assert!(json_value["prompt"].is_null());
        assert!(json_value["summary"].is_null());
        assert_eq!(json_value["status"], "backlog");
        assert!(json_value["jira_key"].is_null());
    }

    #[test]
    fn test_get_task_info_response_json_structure() {
        let response = GetTaskInfoResponse {
            id: "T-7".to_string(),
            title: "Structure Test".to_string(),
            prompt: Some("Test prompt".to_string()),
            summary: None,
            status: "doing".to_string(),
            jira_key: None,
        };
        let json_value = serde_json::to_value(&response).expect("Failed to convert to JSON value");
        assert_eq!(json_value["id"], "T-7");
        assert_eq!(json_value["title"], "Structure Test");
        assert_eq!(json_value["prompt"], "Test prompt");
        assert!(json_value["summary"].is_null());
        assert_eq!(json_value["status"], "doing");
        assert!(json_value["jira_key"].is_null());
    }

}
