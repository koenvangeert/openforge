use axum::{
    extract::{State, Json},
    routing::post,
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
    pub description: Option<String>,
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
        request.description.as_deref(),
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

/// Create the HTTP router with all available routes
pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/create_task", post(create_task_handler))
        .route("/hooks/stop", post(hook_stop_handler))
        .route("/hooks/pre-tool-use", post(hook_pre_tool_use_handler))
        .route("/hooks/post-tool-use", post(hook_post_tool_use_handler))
        .route("/hooks/session-end", post(hook_session_end_handler))
        .route("/hooks/notification", post(hook_notification_handler))
        .with_state(state)
}

/// Start the HTTP server on the configured port
/// 
/// The server listens on 127.0.0.1 (localhost only) to ensure
/// it's not exposed to the external network.
/// 
/// The port can be configured via the AI_COMMAND_CENTER_PORT
/// environment variable, defaulting to 17422.
pub async fn start_http_server(app: tauri::AppHandle, db: std::sync::Arc<Mutex<db::Database>>) -> Result<(), Box<dyn std::error::Error>> {
    let port = std::env::var("AI_COMMAND_CENTER_PORT")
        .unwrap_or_else(|_| "17422".to_string())
        .parse::<u16>()
        .unwrap_or(17422);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let state = AppState { app, db };
    let router = create_router(state);

    println!("[http_server] Starting on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
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
    fn test_create_task_request_creation() {
        let request = CreateTaskRequest {
            title: "Test Task".to_string(),
            description: Some("Test description".to_string()),
            project_id: Some("PROJ-1".to_string()),
            worktree: Some("/path/to/wt".to_string()),
        };
        assert_eq!(request.title, "Test Task");
        assert_eq!(request.description, Some("Test description".to_string()));
        assert_eq!(request.project_id, Some("PROJ-1".to_string()));
    }

    #[test]
    fn test_create_task_request_minimal_fields() {
        let request = CreateTaskRequest {
            title: "Minimal Task".to_string(),
            description: None,
            project_id: None,
            worktree: None,
        };
        assert_eq!(request.title, "Minimal Task");
        assert!(request.description.is_none());
        assert!(request.project_id.is_none());
    }

    #[test]
    fn test_create_task_request_deserialize_all_fields() {
        let json = r#"{"title": "Implement Feature X", "description": "Detailed description here", "project_id": "PROJ-42"}"#;
        let request: CreateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.title, "Implement Feature X");
        assert_eq!(request.description, Some("Detailed description here".to_string()));
        assert_eq!(request.project_id, Some("PROJ-42".to_string()));
    }

    #[test]
    fn test_create_task_request_deserialize_only_required() {
        let json = r#"{"title": "Simple Task"}"#;
        let request: CreateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.title, "Simple Task");
        assert!(request.description.is_none());
        assert!(request.project_id.is_none());
    }

    #[test]
    fn test_create_task_request_deserialize_partial_optional() {
        // Only description provided, no project_id
        let json = r#"{"title": "Task with description", "description": "Some notes"}"#;
        let request: CreateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.title, "Task with description");
        assert_eq!(request.description, Some("Some notes".to_string()));
        assert!(request.project_id.is_none());
    }

    #[test]
    fn test_create_task_request_deserialize_empty_strings() {
        let json = r#"{"title": "", "description": "", "project_id": ""}"#;
        let request: CreateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.title, "");
        assert_eq!(request.description, Some("".to_string()));
        assert_eq!(request.project_id, Some("".to_string()));
    }

    #[test]
    fn test_create_task_request_deserialize_missing_title_fails() {
        let json = r#"{"description": "No title here"}"#;
        let result: Result<CreateTaskRequest, _> = serde_json::from_str(json);
        assert!(result.is_err(), "Should fail without required title field");
    }

    #[test]
    fn test_create_task_request_serialize_roundtrip() {
        let original = CreateTaskRequest {
            title: "Roundtrip Test".to_string(),
            description: Some("Check serialization".to_string()),
            project_id: Some("PROJ-99".to_string()),
            worktree: Some("/path/to/worktree".to_string()),
        };
        let json = serde_json::to_string(&original).expect("Failed to serialize");
        let deserialized: CreateTaskRequest = serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.title, original.title);
        assert_eq!(deserialized.description, original.description);
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

}
