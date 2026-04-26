use crate::db;
use axum::{
    extract::{Json, Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Router,
};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Mutex};
use tauri::Emitter;

/// Request to create a new task from OpenCode
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTaskRequest {
    pub initial_prompt: String,
    pub project_id: Option<String>,
    pub worktree: Option<String>,
}

#[derive(Clone)]
pub struct AppState {
    pub app: Option<tauri::AppHandle>,
    pub db: std::sync::Arc<Mutex<db::Database>>,
}

/// Response containing the created task ID
#[derive(Debug, Clone, Serialize)]
pub struct CreateTaskResponse {
    pub task_id: String,
    pub project_id: Option<String>,
    pub status: String,
}

/// Request to update a task's initial_prompt and/or summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTaskRequest {
    pub task_id: String,
    pub initial_prompt: Option<String>,
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
    pub initial_prompt: String,
    pub prompt: Option<String>,
    pub summary: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TasksQuery {
    pub project_id: String,
    pub state: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkQueueQuery {
    pub project_id: String,
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

/// Payload from the OpenForge Pi extension when a PTY-backed Pi agent finishes a run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PiAgentEndPayload {
    pub task_id: String,
    pub pty_instance_id: u64,
}

fn pi_session_matches_pty_instance(session: &db::AgentSessionRow, pty_instance_id: u64) -> bool {
    session
        .checkpoint_data
        .as_deref()
        .and_then(|data| serde_json::from_str::<serde_json::Value>(data).ok())
        .and_then(|value| value.get("pty_instance_id").and_then(|id| id.as_u64()))
        == Some(pty_instance_id)
}

/// Resolve project_id from request parameters, failing if no project can be determined.
///
/// Priority: explicit project_id > worktree deduction.
/// If neither succeeds, returns an error message listing available projects
/// so the calling agent can retry with the correct project_id.
fn resolve_project_id(
    db: &db::Database,
    explicit_project_id: Option<&str>,
    worktree: Option<&str>,
) -> Result<String, String> {
    if let Some(id) = explicit_project_id {
        if !id.is_empty() {
            return Ok(id.to_string());
        }
    }

    if let Some(wt) = worktree {
        if let Ok(Some(id)) = db.get_project_for_worktree(wt) {
            return Ok(id);
        }
    }

    let projects = db.get_all_projects().unwrap_or_default();
    let project_list = if projects.is_empty() {
        "  (none — create a project in Open Forge first)".to_string()
    } else {
        projects
            .iter()
            .map(|p| format!("  - {}: {} ({})", p.id, p.name, p.path))
            .collect::<Vec<_>>()
            .join("\n")
    };

    Err(format!(
        "Could not determine project for this task. project_id was not provided and could not be deduced from the worktree path.\n\nAvailable projects:\n{}\n\nPlease call create_task again with the correct project_id parameter.",
        project_list
    ))
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
) -> Result<Json<CreateTaskResponse>, (StatusCode, String)> {
    let db = state.db.lock().unwrap();

    let project_id = resolve_project_id(
        &db,
        request.project_id.as_deref(),
        request.worktree.as_deref(),
    )
    .map_err(|msg| (StatusCode::UNPROCESSABLE_ENTITY, msg))?;

    let task = db
        .create_task(
            &request.initial_prompt,
            "backlog",
            Some(&project_id),
            None,
            None,
            None,
        )
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create task: {}", e),
            )
        })?;

    drop(db);

    if let Some(app) = &state.app {
        let _ = app.emit(
            "task-changed",
            serde_json::json!({
                "action": "created",
                "task_id": task.id,
                "project_id": task.project_id
            }),
        );
    }

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
    if request.initial_prompt.is_none() && request.summary.is_none() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let db = state.db.lock().unwrap();

    db.update_task_title_and_summary(
        &request.task_id,
        request.initial_prompt.as_deref(),
        request.summary.as_deref(),
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    drop(db);

    if let Some(app) = &state.app {
        let _ = app.emit(
            "task-changed",
            serde_json::json!({
                "action": "updated",
                "task_id": request.task_id
            }),
        );
    }

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

    match db
        .get_task(&id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        Some(task) => Ok(Json(GetTaskInfoResponse {
            id: task.id,
            initial_prompt: task.initial_prompt,
            prompt: task.prompt,
            summary: task.summary,
            status: task.status,
        })),
        None => Err(StatusCode::NOT_FOUND),
    }
}

pub async fn get_tasks_handler(
    State(state): State<AppState>,
    Query(query): Query<TasksQuery>,
) -> Result<Json<Vec<db::TaskRow>>, (StatusCode, String)> {
    if let Some(task_state) = query.state.as_deref() {
        if !matches!(task_state, "backlog" | "doing" | "done") {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Invalid state '{task_state}'. Expected one of: backlog, doing, done"),
            ));
        }
    }

    let db = state.db.lock().unwrap();
    let tasks = match query.state.as_deref() {
        Some(task_state) => db
            .get_tasks_for_project_by_state(&query.project_id, task_state)
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get tasks by state: {e}"),
                )
            })?,
        None => db.get_tasks_for_project(&query.project_id).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get tasks: {e}"),
            )
        })?,
    };

    Ok(Json(tasks))
}

pub async fn get_project_attention_handler(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<db::ProjectAttentionRow>, (StatusCode, String)> {
    let db = state.db.lock().unwrap();

    let project = db
        .get_project(&project_id)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get project: {e}"),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                format!("Project not found: {project_id}"),
            )
        })?;

    let attention = db
        .get_project_attention_for_project(&project_id)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get project attention: {e}"),
            )
        })?
        .unwrap_or(db::ProjectAttentionRow {
            project_id: project.id,
            needs_input: 0,
            running_agents: 0,
            ci_failures: 0,
            unaddressed_comments: 0,
            completed_agents: 0,
        });

    Ok(Json(attention))
}

pub async fn get_work_queue_handler(
    State(state): State<AppState>,
    Query(query): Query<WorkQueueQuery>,
) -> Result<Json<Vec<db::WorkQueueTaskRow>>, (StatusCode, String)> {
    let db = state.db.lock().unwrap();
    let rows = db
        .get_work_queue_tasks_for_project(&query.project_id)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get work queue tasks: {e}"),
            )
        })?;
    Ok(Json(rows))
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
        if let Some(app) = &state.app {
            let _ = app.emit(
                "claude-hook-event",
                serde_json::json!({
                    "task_id": task_id,
                    "event_type": event_type,
                    "payload": payload_value
                }),
            );
        }

        let status_update: Option<String> = {
            let db = state.db.lock().unwrap();
            if let Ok(Some(session)) = db.get_latest_session_for_ticket(task_id) {
                if session.provider == "claude-code" {
                    // Persist the Claude session ID on first hook so session can be resumed later
                    if session.claude_session_id.is_none() {
                        if let Some(ref sid) = payload.session_id {
                            if !sid.is_empty() {
                                if let Err(e) = db.set_agent_session_claude_id(&session.id, sid) {
                                    error!("[http_server] Failed to set claude_session_id for session {}: {}", session.id, e);
                                }
                            }
                        }
                    }

                    if let Some(new_status) = map_hook_to_status(event_type, &session.status) {
                        if let Err(e) = db.update_agent_session(
                            &session.id,
                            &session.stage,
                            &new_status,
                            None,
                            None,
                        ) {
                            error!(
                                "[http_server] Failed to update session status for task {}: {}",
                                task_id, e
                            );
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
            if let Some(app) = &state.app {
                let _ = app.emit(
                    "agent-status-changed",
                    serde_json::json!({
                        "task_id": task_id,
                        "status": new_status,
                        "provider": "claude-code"
                    }),
                );
            }
        }
    } else {
        warn!(
            "[http_server] Warning: Hook event '{}' received without CLAUDE_TASK_ID",
            event_type
        );
    }

    Ok(Json(serde_json::json!({ "status": "ok" })))
}

pub async fn pi_agent_end_handler(
    State(state): State<AppState>,
    Json(payload): Json<PiAgentEndPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let status_update: Option<String> = {
        let db = state.db.lock().unwrap();
        if let Ok(Some(session)) = db.get_latest_session_for_ticket(&payload.task_id) {
            if session.provider == "pi"
                && matches!(session.status.as_str(), "running" | "paused")
                && pi_session_matches_pty_instance(&session, payload.pty_instance_id)
            {
                if let Err(e) =
                    db.update_agent_session(&session.id, &session.stage, "completed", None, None)
                {
                    error!(
                        "[http_server] Failed to complete Pi session for task {}: {}",
                        payload.task_id, e
                    );
                    None
                } else {
                    Some("completed".to_string())
                }
            } else {
                None
            }
        } else {
            None
        }
    };

    if let Some(new_status) = status_update {
        if let Some(app) = &state.app {
            let _ = app.emit(
                "agent-status-changed",
                serde_json::json!({
                    "task_id": payload.task_id,
                    "status": new_status,
                    "provider": "pi"
                }),
            );
        }
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
        .route("/tasks", get(get_tasks_handler))
        .route("/project/:id/attention", get(get_project_attention_handler))
        .route("/work_queue", get(get_work_queue_handler))
        .route("/hooks/pi-agent-end", post(pi_agent_end_handler))
        .route("/hooks/stop", post(hook_stop_handler))
        .route("/hooks/pre-tool-use", post(hook_pre_tool_use_handler))
        .route("/hooks/post-tool-use", post(hook_post_tool_use_handler))
        .route("/hooks/session-end", post(hook_session_end_handler))
        .route("/hooks/notification", post(hook_notification_handler))
        .route(
            "/hooks/notification-permission",
            post(hook_notification_permission_handler),
        )
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
    let state = AppState { app: Some(app), db };
    let router = create_router(state);

    info!("[http_server] Starting on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    // Signal that the server is listening before entering the serve loop
    let _ = ready_tx.send(());
    axum::serve(listener, router).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::http::Request;
    use std::sync::{Arc, Mutex};
    use tower::util::ServiceExt;

    async fn response_body_json(response: axum::response::Response) -> serde_json::Value {
        let bytes = to_bytes(response.into_body(), 1024 * 1024)
            .await
            .expect("read response body");
        serde_json::from_slice(&bytes).expect("parse response JSON")
    }

    fn test_state(name: &str) -> (AppState, std::path::PathBuf) {
        let (db, path) = crate::db::test_helpers::make_test_db(name);
        (
            AppState {
                app: None,
                db: Arc::new(Mutex::new(db)),
            },
            path,
        )
    }

    // ========================================================================
    // CreateTaskRequest Tests
    // ========================================================================

    #[test]
    fn test_create_task_request_ignores_unknown_description_field() {
        let json = r#"{"initial_prompt": "Test", "description": "old field still sent"}"#;
        let req: CreateTaskRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.initial_prompt, "Test");
    }

    #[tokio::test]
    async fn test_pi_agent_end_hook_marks_running_pi_session_completed() {
        let (state, path) = test_state("http_pi_agent_end_completed");
        let task_id = {
            let db = state.db.lock().expect("lock db");
            let project = db
                .create_project("Project", "/tmp/project")
                .expect("create project");
            let task = db
                .create_task("Task A", "doing", Some(&project.id), None, None, None)
                .expect("create task");
            db.create_agent_session(
                "ses-pi-running",
                &task.id,
                None,
                "implementing",
                "running",
                "pi",
            )
            .expect("create pi session");
            db.update_agent_session(
                "ses-pi-running",
                "implementing",
                "running",
                Some(r#"{"pty_instance_id":42}"#),
                None,
            )
            .expect("store pty instance");
            task.id
        };

        let router = create_router(state.clone());
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/hooks/pi-agent-end")
                    .method("POST")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"task_id":"{}","pty_instance_id":42}}"#,
                        task_id
                    )))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let session = state
            .db
            .lock()
            .expect("lock db")
            .get_agent_session("ses-pi-running")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session.status, "completed");
        assert!(session.error_message.is_none());

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_pi_agent_end_hook_ignores_stale_pty_instance() {
        let (state, path) = test_state("http_pi_agent_end_stale_instance");
        let task_id = {
            let db = state.db.lock().expect("lock db");
            let project = db
                .create_project("Project", "/tmp/project")
                .expect("create project");
            let task = db
                .create_task("Task A", "doing", Some(&project.id), None, None, None)
                .expect("create task");
            db.create_agent_session(
                "ses-pi-running",
                &task.id,
                None,
                "implementing",
                "running",
                "pi",
            )
            .expect("create pi session");
            db.update_agent_session(
                "ses-pi-running",
                "implementing",
                "running",
                Some(r#"{"pty_instance_id":99}"#),
                None,
            )
            .expect("store pty instance");
            task.id
        };

        let router = create_router(state.clone());
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/hooks/pi-agent-end")
                    .method("POST")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"task_id":"{}","pty_instance_id":42}}"#,
                        task_id
                    )))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let session = state
            .db
            .lock()
            .expect("lock db")
            .get_agent_session("ses-pi-running")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session.status, "running");

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_get_tasks_handler_returns_tasks_for_project() {
        let (state, path) = test_state("http_get_tasks_handler_returns_tasks");
        {
            let db = state.db.lock().expect("lock db");
            let project = db
                .create_project("Project", "/tmp/project")
                .expect("create project");
            db.create_task("Task A", "backlog", Some(&project.id), None, None, None)
                .expect("create task a");
            db.create_task("Task B", "doing", Some(&project.id), None, None, None)
                .expect("create task b");
        }

        let router = create_router(state);
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/tasks?project_id=P-1")
                    .method("GET")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let json = response_body_json(response).await;
        let tasks = json.as_array().expect("array response");
        assert_eq!(tasks.len(), 2);

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_get_tasks_handler_filters_by_state() {
        let (state, path) = test_state("http_get_tasks_handler_filters_by_state");
        {
            let db = state.db.lock().expect("lock db");
            let project = db
                .create_project("Project", "/tmp/project")
                .expect("create project");
            db.create_task(
                "Task backlog",
                "backlog",
                Some(&project.id),
                None,
                None,
                None,
            )
            .expect("create backlog task");
            db.create_task("Task doing", "doing", Some(&project.id), None, None, None)
                .expect("create doing task");
        }

        let router = create_router(state);
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/tasks?project_id=P-1&state=doing")
                    .method("GET")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let json = response_body_json(response).await;
        let tasks = json.as_array().expect("array response");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["status"], "doing");

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_get_tasks_handler_rejects_invalid_state() {
        let (state, path) = test_state("http_get_tasks_handler_rejects_invalid_state");
        {
            let db = state.db.lock().expect("lock db");
            let _ = db
                .create_project("Project", "/tmp/project")
                .expect("create project");
        }

        let router = create_router(state);
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/tasks?project_id=P-1&state=blocked")
                    .method("GET")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_get_project_attention_handler_returns_zeroed_row_when_no_attention() {
        let (state, path) = test_state("http_get_project_attention_handler_zeroed_row");
        {
            let db = state.db.lock().expect("lock db");
            let _ = db
                .create_project("Project", "/tmp/project")
                .expect("create project");
        }

        let router = create_router(state);
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/project/P-1/attention")
                    .method("GET")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let json = response_body_json(response).await;
        assert_eq!(json["project_id"], "P-1");
        assert_eq!(json["needs_input"], 0);
        assert_eq!(json["running_agents"], 0);
        assert_eq!(json["ci_failures"], 0);
        assert_eq!(json["unaddressed_comments"], 0);
        assert_eq!(json["completed_agents"], 0);

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_get_project_attention_handler_returns_not_found_for_unknown_project() {
        let (state, path) = test_state("http_get_project_attention_handler_not_found");

        let router = create_router(state);
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/project/P-999/attention")
                    .method("GET")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_get_work_queue_handler_filters_by_project() {
        let (state, path) = test_state("http_get_work_queue_handler_filters_by_project");
        {
            let db = state.db.lock().expect("lock db");

            let project1 = db
                .create_project("Project 1", "/tmp/project1")
                .expect("create project 1");
            let project2 = db
                .create_project("Project 2", "/tmp/project2")
                .expect("create project 2");

            let task1 = db
                .create_task("Task P1", "doing", Some(&project1.id), None, None, None)
                .expect("create task p1");
            let _task2 = db
                .create_task("Task P2", "doing", Some(&project2.id), None, None, None)
                .expect("create task p2");

            db.create_agent_session(
                "ses-http-work-queue",
                &task1.id,
                None,
                "implement",
                "completed",
                "opencode",
            )
            .expect("create agent session");
        }

        let router = create_router(state);
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/work_queue?project_id=P-1")
                    .method("GET")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let json = response_body_json(response).await;
        let tasks = json.as_array().expect("array response");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["task"]["project_id"], "P-1");

        let _ = std::fs::remove_file(path);
    }

    // ========================================================================
    // map_hook_to_status Tests
    // ========================================================================

    #[test]
    fn test_pre_tool_use_transitions_from_non_running_to_running() {
        assert_eq!(
            map_hook_to_status("pre-tool-use", "paused"),
            Some("running".to_string())
        );
        assert_eq!(
            map_hook_to_status("pre-tool-use", "completed"),
            Some("running".to_string())
        );
        assert_eq!(
            map_hook_to_status("pre-tool-use", "failed"),
            Some("running".to_string())
        );
        assert_eq!(
            map_hook_to_status("pre-tool-use", "interrupted"),
            Some("running".to_string())
        );
    }

    #[test]
    fn test_pre_tool_use_no_op_when_already_running() {
        assert_eq!(map_hook_to_status("pre-tool-use", "running"), None);
    }

    #[test]
    fn test_post_tool_use_transitions_from_non_running_to_running() {
        assert_eq!(
            map_hook_to_status("post-tool-use", "paused"),
            Some("running".to_string())
        );
        assert_eq!(
            map_hook_to_status("post-tool-use", "completed"),
            Some("running".to_string())
        );
    }

    #[test]
    fn test_post_tool_use_no_op_when_already_running() {
        assert_eq!(map_hook_to_status("post-tool-use", "running"), None);
    }

    #[test]
    fn test_stop_always_maps_to_completed() {
        assert_eq!(
            map_hook_to_status("stop", "running"),
            Some("completed".to_string())
        );
        assert_eq!(
            map_hook_to_status("stop", "paused"),
            Some("completed".to_string())
        );
        assert_eq!(
            map_hook_to_status("stop", "completed"),
            Some("completed".to_string())
        );
    }

    #[test]
    fn test_session_end_always_maps_to_completed() {
        assert_eq!(
            map_hook_to_status("session-end", "running"),
            Some("completed".to_string())
        );
        assert_eq!(
            map_hook_to_status("session-end", "paused"),
            Some("completed".to_string())
        );
    }

    #[test]
    fn test_notification_produces_no_status_change() {
        assert_eq!(map_hook_to_status("notification", "running"), None);
        assert_eq!(map_hook_to_status("notification", "paused"), None);
    }

    #[test]
    fn test_notification_permission_maps_running_to_paused() {
        assert_eq!(
            map_hook_to_status("notification-permission", "running"),
            Some("paused".to_string())
        );
    }

    #[test]
    fn test_notification_permission_no_op_when_not_running() {
        assert_eq!(
            map_hook_to_status("notification-permission", "paused"),
            None
        );
        assert_eq!(
            map_hook_to_status("notification-permission", "completed"),
            None
        );
        assert_eq!(
            map_hook_to_status("notification-permission", "interrupted"),
            None
        );
    }

    #[test]
    fn test_unknown_event_type_produces_no_status_change() {
        assert_eq!(map_hook_to_status("unknown-event", "running"), None);
        assert_eq!(map_hook_to_status("", "running"), None);
    }

    #[test]
    fn test_create_task_request_creation() {
        let request = CreateTaskRequest {
            initial_prompt: "Test Task".to_string(),
            project_id: Some("PROJ-1".to_string()),
            worktree: Some("/path/to/wt".to_string()),
        };
        assert_eq!(request.initial_prompt, "Test Task");
        assert_eq!(request.project_id, Some("PROJ-1".to_string()));
    }

    #[test]
    fn test_create_task_request_minimal_fields() {
        let request = CreateTaskRequest {
            initial_prompt: "Minimal Task".to_string(),
            project_id: None,
            worktree: None,
        };
        assert_eq!(request.initial_prompt, "Minimal Task");
        assert!(request.project_id.is_none());
    }

    #[test]
    fn test_create_task_request_deserialize_all_fields() {
        let json = r#"{"initial_prompt": "Implement Feature X", "project_id": "PROJ-42", "worktree": "/path/to/wt"}"#;
        let request: CreateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.initial_prompt, "Implement Feature X");
        assert_eq!(request.project_id, Some("PROJ-42".to_string()));
        assert_eq!(request.worktree, Some("/path/to/wt".to_string()));
    }

    #[test]
    fn test_create_task_request_deserialize_only_required() {
        let json = r#"{"initial_prompt": "Simple Task"}"#;
        let request: CreateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.initial_prompt, "Simple Task");
        assert!(request.project_id.is_none());
    }

    #[test]
    fn test_create_task_request_deserialize_partial_optional() {
        let json = r#"{"initial_prompt": "Task with project", "project_id": "PROJ-99"}"#;
        let request: CreateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.initial_prompt, "Task with project");
        assert_eq!(request.project_id, Some("PROJ-99".to_string()));
        assert!(request.worktree.is_none());
    }

    #[test]
    fn test_create_task_request_deserialize_empty_strings() {
        let json = r#"{"initial_prompt": "", "project_id": "", "worktree": ""}"#;
        let request: CreateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.initial_prompt, "");
        assert_eq!(request.project_id, Some("".to_string()));
        assert_eq!(request.worktree, Some("".to_string()));
    }

    #[test]
    fn test_create_task_request_deserialize_missing_initial_prompt_fails() {
        let json = r#"{"project_id": "PROJ-1"}"#;
        let result: Result<CreateTaskRequest, _> = serde_json::from_str(json);
        assert!(
            result.is_err(),
            "Should fail without required initial_prompt field"
        );
    }

    #[test]
    fn test_create_task_request_serialize_roundtrip() {
        let original = CreateTaskRequest {
            initial_prompt: "Roundtrip Test".to_string(),
            project_id: Some("PROJ-99".to_string()),
            worktree: Some("/path/to/worktree".to_string()),
        };
        let json = serde_json::to_string(&original).expect("Failed to serialize");
        let deserialized: CreateTaskRequest =
            serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.initial_prompt, original.initial_prompt);
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
        let json =
            r#"{"session_id": "sess-123", "tool_name": "bash", "CLAUDE_TASK_ID": "task-456"}"#;
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
        assert_eq!(
            payload.transcript_path,
            Some("/path/to/transcript".to_string())
        );
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
        assert_eq!(
            status, "paused",
            "notification-permission transitions running→paused"
        );

        // Tool use resumes from paused
        if let Some(s) = map_hook_to_status("pre-tool-use", &status) {
            status = s;
        }
        assert_eq!(
            status, "running",
            "Resumed: pre-tool-use transitions paused→running"
        );

        if let Some(s) = map_hook_to_status("stop", &status) {
            status = s;
        }
        assert_eq!(status, "completed");

        if let Some(s) = map_hook_to_status("pre-tool-use", &status) {
            status = s;
        }
        assert_eq!(
            status, "running",
            "Resumed: pre-tool-use transitions completed→running"
        );

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
            initial_prompt: Some("New Title".to_string()),
            summary: Some("New Summary".to_string()),
        };
        assert_eq!(request.task_id, "T-123");
        assert_eq!(request.initial_prompt, Some("New Title".to_string()));
        assert_eq!(request.summary, Some("New Summary".to_string()));
    }

    #[test]
    fn test_update_task_request_deserialize_all_fields() {
        let json = r#"{"task_id": "T-456", "initial_prompt": "Updated Title", "summary": "Updated Summary"}"#;
        let request: UpdateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.task_id, "T-456");
        assert_eq!(request.initial_prompt, Some("Updated Title".to_string()));
        assert_eq!(request.summary, Some("Updated Summary".to_string()));
    }

    #[test]
    fn test_update_task_request_deserialize_title_only() {
        let json = r#"{"task_id": "T-789", "initial_prompt": "Only Title"}"#;
        let request: UpdateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.task_id, "T-789");
        assert_eq!(request.initial_prompt, Some("Only Title".to_string()));
        assert!(request.summary.is_none());
    }

    #[test]
    fn test_update_task_request_deserialize_summary_only() {
        let json = r#"{"task_id": "T-999", "summary": "Only Summary"}"#;
        let request: UpdateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.task_id, "T-999");
        assert!(request.initial_prompt.is_none());
        assert_eq!(request.summary, Some("Only Summary".to_string()));
    }

    #[test]
    fn test_update_task_request_deserialize_neither_title_nor_summary() {
        let json = r#"{"task_id": "T-111"}"#;
        let request: UpdateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.task_id, "T-111");
        assert!(request.initial_prompt.is_none());
        assert!(request.summary.is_none());
    }

    #[test]
    fn test_update_task_request_deserialize_missing_task_id_fails() {
        let json = r#"{"initial_prompt": "No Task ID"}"#;
        let result: Result<UpdateTaskRequest, _> = serde_json::from_str(json);
        assert!(
            result.is_err(),
            "Should fail without required task_id field"
        );
    }

    #[test]
    fn test_update_task_request_serialize_roundtrip() {
        let original = UpdateTaskRequest {
            task_id: "T-555".to_string(),
            initial_prompt: Some("Roundtrip Title".to_string()),
            summary: Some("Roundtrip Summary".to_string()),
        };
        let json = serde_json::to_string(&original).expect("Failed to serialize");
        let deserialized: UpdateTaskRequest =
            serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.task_id, original.task_id);
        assert_eq!(deserialized.initial_prompt, original.initial_prompt);
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
            initial_prompt: "My Task".to_string(),
            prompt: Some("Do something cool".to_string()),
            summary: Some("Did the thing".to_string()),
            status: "doing".to_string(),
        };
        assert_eq!(response.id, "T-42");
        assert_eq!(response.initial_prompt, "My Task");
        assert_eq!(response.prompt, Some("Do something cool".to_string()));
        assert_eq!(response.summary, Some("Did the thing".to_string()));
        assert_eq!(response.status, "doing");
    }

    #[test]
    fn test_get_task_info_response_creation_nullable_fields_none() {
        let response = GetTaskInfoResponse {
            id: "T-1".to_string(),
            initial_prompt: "Simple Task".to_string(),
            prompt: None,
            summary: None,
            status: "backlog".to_string(),
        };
        assert!(response.prompt.is_none());
        assert!(response.summary.is_none());
    }

    #[test]
    fn test_get_task_info_response_serialize_all_fields() {
        let response = GetTaskInfoResponse {
            id: "T-99".to_string(),
            initial_prompt: "Full Task".to_string(),
            prompt: Some("Implement X".to_string()),
            summary: Some("Implemented X".to_string()),
            status: "done".to_string(),
        };
        let json = serde_json::to_string(&response).expect("Failed to serialize");
        assert!(json.contains("\"id\":\"T-99\""));
        assert!(json.contains("\"initial_prompt\":\"Full Task\""));
        assert!(json.contains("\"prompt\":\"Implement X\""));
        assert!(json.contains("\"summary\":\"Implemented X\""));
        assert!(json.contains("\"status\":\"done\""));
    }

    #[test]
    fn test_get_task_info_response_only_exposes_expected_fields() {
        let response = GetTaskInfoResponse {
            id: "T-99".to_string(),
            initial_prompt: "Full Task".to_string(),
            prompt: Some("Implement X".to_string()),
            summary: Some("Implemented X".to_string()),
            status: "done".to_string(),
        };

        let json_value = serde_json::to_value(&response).expect("Failed to serialize");
        assert!(
            json_value.get("id").is_some()
                && json_value.get("initial_prompt").is_some()
                && json_value.get("prompt").is_some()
                && json_value.get("summary").is_some()
                && json_value.get("status").is_some()
                && json_value
                    .as_object()
                    .map(|obj| obj.len())
                    .unwrap_or_default()
                    == 5,
            "HTTP task info response must only expose the expected task fields"
        );
    }

    #[test]
    fn test_get_task_info_response_serialize_nulls() {
        let response = GetTaskInfoResponse {
            id: "T-1".to_string(),
            initial_prompt: "Minimal".to_string(),
            prompt: None,
            summary: None,
            status: "backlog".to_string(),
        };
        let json_value = serde_json::to_value(&response).expect("Failed to serialize");
        assert_eq!(json_value["id"], "T-1");
        assert_eq!(json_value["initial_prompt"], "Minimal");
        assert!(json_value["prompt"].is_null());
        assert!(json_value["summary"].is_null());
        assert_eq!(json_value["status"], "backlog");
        assert_eq!(json_value.as_object().map(|obj| obj.len()), Some(5));
    }

    #[test]
    fn test_get_task_info_response_json_structure() {
        let response = GetTaskInfoResponse {
            id: "T-7".to_string(),
            initial_prompt: "Structure Test".to_string(),
            prompt: Some("Test prompt".to_string()),
            summary: None,
            status: "doing".to_string(),
        };
        let json_value = serde_json::to_value(&response).expect("Failed to convert to JSON value");
        assert_eq!(json_value["id"], "T-7");
        assert_eq!(json_value["initial_prompt"], "Structure Test");
        assert_eq!(json_value["prompt"], "Test prompt");
        assert!(json_value["summary"].is_null());
        assert_eq!(json_value["status"], "doing");
        assert_eq!(json_value.as_object().map(|obj| obj.len()), Some(5));
    }

    // ========================================================================
    // resolve_project_id Tests
    // ========================================================================

    #[test]
    fn test_resolve_project_id_with_explicit_id() {
        let (db, _path) = crate::db::test_helpers::make_test_db("resolve_explicit");
        let result = resolve_project_id(&db, Some("P-1"), None);
        assert_eq!(result, Ok("P-1".to_string()));
    }

    #[test]
    fn test_resolve_project_id_empty_id_falls_through() {
        let (db, _path) = crate::db::test_helpers::make_test_db("resolve_empty_id");
        let result = resolve_project_id(&db, Some(""), None);
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_project_id_none_id_falls_through() {
        let (db, _path) = crate::db::test_helpers::make_test_db("resolve_none_id");
        let result = resolve_project_id(&db, None, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_project_id_from_worktree() {
        let (db, _path) = crate::db::test_helpers::make_test_db("resolve_worktree");
        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create project");
        crate::db::test_helpers::insert_test_task(&db);
        db.create_worktree_record("T-100", &project.id, "/tmp/repo", "/tmp/wt1", "branch-1")
            .expect("create worktree");

        let result = resolve_project_id(&db, None, Some("/tmp/wt1"));
        assert_eq!(result, Ok(project.id));
    }

    #[test]
    fn test_resolve_project_id_no_match_lists_available_projects() {
        let (db, _path) = crate::db::test_helpers::make_test_db("resolve_no_match");
        db.create_project("My Project", "/path/to/project")
            .expect("create project");

        let result = resolve_project_id(&db, None, None);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Could not determine project"), "Error: {err}");
        assert!(err.contains("P-1"), "Should list project ID. Error: {err}");
        assert!(
            err.contains("My Project"),
            "Should list project name. Error: {err}"
        );
        assert!(
            err.contains("/path/to/project"),
            "Should list project path. Error: {err}"
        );
        assert!(
            err.contains("create_task"),
            "Should tell caller to retry. Error: {err}"
        );
    }

    #[test]
    fn test_resolve_project_id_no_projects_at_all() {
        let (db, _path) = crate::db::test_helpers::make_test_db("resolve_no_projects");
        let result = resolve_project_id(&db, None, None);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("none"),
            "Should indicate no projects exist. Error: {err}"
        );
    }

    #[test]
    fn test_resolve_project_id_worktree_not_found_lists_projects() {
        let (db, _path) = crate::db::test_helpers::make_test_db("resolve_wt_not_found");
        db.create_project("Test", "/tmp/test")
            .expect("create project");

        let result = resolve_project_id(&db, None, Some("/unknown/path"));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Could not determine project"), "Error: {err}");
        assert!(
            err.contains("P-1"),
            "Should list available project. Error: {err}"
        );
    }

    #[test]
    fn test_resolve_project_id_explicit_takes_priority_over_worktree() {
        let (db, _path) = crate::db::test_helpers::make_test_db("resolve_priority");
        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create project");
        crate::db::test_helpers::insert_test_task(&db);
        db.create_worktree_record("T-100", &project.id, "/tmp/repo", "/tmp/wt1", "branch-1")
            .expect("create worktree");

        let result = resolve_project_id(&db, Some("P-99"), Some("/tmp/wt1"));
        assert_eq!(result, Ok("P-99".to_string()));
    }
}
