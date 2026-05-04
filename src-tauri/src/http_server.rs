use crate::{
    app_events::{publish_app_event, AppEventEnvelope, AppEventSender},
    db,
    github_client::GitHubClient,
    pty_manager::PtyManager,
    server_manager::ServerManager,
    sse_bridge::SseBridgeManager,
    whisper_manager::{WhisperManager, WhisperModelSize},
};
use axum::{
    extract::{Json, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::sse::{Event, Sse},
    routing::{get, post},
    Router,
};
use futures::Stream;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, net::SocketAddr, sync::Mutex};
use tauri::{Emitter, Manager};

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
    pub backend_token: Option<String>,
    pub pty_manager: Option<PtyManager>,
    pub server_manager: Option<ServerManager>,
    pub sse_bridge_manager: Option<SseBridgeManager>,
    pub github_client: GitHubClient,
    pub app_event_tx: Option<AppEventSender>,
    pub whisper: Option<std::sync::Arc<WhisperManager>>,
}

/// Response containing the created task ID
#[derive(Debug, Clone, Serialize)]
pub struct CreateTaskResponse {
    pub task_id: String,
    pub project_id: Option<String>,
    pub status: String,
}

/// Request to update a task summary. `initial_prompt` is retained only to detect and reject mutation attempts with a clear error.
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

/// Payload from the OpenForge Pi extension when a PTY-backed Pi agent starts or finishes a run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PiAgentLifecyclePayload {
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

fn emit_agent_status_changed(state: &AppState, task_id: &str, status: &str, provider: &str) {
    let payload = serde_json::json!({
        "task_id": task_id,
        "status": status,
        "provider": provider,
    });

    if let Some(app) = &state.app {
        let _ = app.emit("agent-status-changed", payload.clone());
    }
    publish_app_event(&state.app_event_tx, "agent-status-changed", &payload);
}

fn update_pi_session_status_for_pty(
    state: &AppState,
    task_id: &str,
    pty_instance_id: u64,
    target_status: &str,
    eligible_statuses: &[&str],
) -> Option<String> {
    let db = state.db.lock().unwrap();
    if let Ok(Some(session)) = db.get_latest_session_for_ticket(task_id) {
        if session.provider == "pi"
            && eligible_statuses.contains(&session.status.as_str())
            && pi_session_matches_pty_instance(&session, pty_instance_id)
        {
            if session.status == target_status {
                return Some(target_status.to_string());
            }

            if let Err(e) = db.update_agent_session(
                &session.id,
                &session.stage,
                target_status,
                session.checkpoint_data.as_deref(),
                None,
            ) {
                error!(
                    "[http_server] Failed to update Pi session for task {} to {}: {}",
                    task_id, target_status, e
                );
                None
            } else {
                Some(target_status.to_string())
            }
        } else {
            None
        }
    } else {
        None
    }
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
) -> Result<Json<UpdateTaskResponse>, (StatusCode, String)> {
    if request.initial_prompt.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            "initial_prompt cannot be updated after task creation".to_string(),
        ));
    }

    let Some(summary) = request.summary.as_deref() else {
        return Err((
            StatusCode::BAD_REQUEST,
            "update_task requires summary".to_string(),
        ));
    };

    let db = state.db.lock().unwrap();

    db.update_task_summary(&request.task_id, summary)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to update task summary: {e}"),
            )
        })?;

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

pub async fn get_projects_handler(
    State(state): State<AppState>,
) -> Result<Json<Vec<db::ProjectRow>>, (StatusCode, String)> {
    let db = state.db.lock().unwrap();
    let projects = db.get_all_projects().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get projects: {e}"),
        )
    })?;

    Ok(Json(projects))
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
            emit_agent_status_changed(&state, &task_id, &new_status, "claude-code");
        }
    } else {
        warn!(
            "[http_server] Warning: Hook event '{}' received without CLAUDE_TASK_ID",
            event_type
        );
    }

    Ok(Json(serde_json::json!({ "status": "ok" })))
}

pub async fn pi_agent_start_handler(
    State(state): State<AppState>,
    Json(payload): Json<PiAgentLifecyclePayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let status_update = update_pi_session_status_for_pty(
        &state,
        &payload.task_id,
        payload.pty_instance_id,
        "running",
        &["completed", "paused", "interrupted", "running"],
    );

    if let Some(new_status) = status_update {
        emit_agent_status_changed(&state, &payload.task_id, &new_status, "pi");
    }

    Ok(Json(serde_json::json!({ "status": "ok" })))
}

pub async fn pi_agent_end_handler(
    State(state): State<AppState>,
    Json(payload): Json<PiAgentLifecyclePayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let status_update = update_pi_session_status_for_pty(
        &state,
        &payload.task_id,
        payload.pty_instance_id,
        "completed",
        &["running", "paused"],
    );

    if let Some(new_status) = status_update {
        emit_agent_status_changed(&state, &payload.task_id, &new_status, "pi");
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInvokeRequest {
    pub command: String,
    #[serde(default)]
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppInvokeResponse {
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppHealthResponse {
    pub status: &'static str,
    pub version: &'static str,
}

fn require_backend_token(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, String)> {
    let Some(expected) = state.backend_token.as_deref() else {
        return Err((
            StatusCode::UNAUTHORIZED,
            "backend token is not configured".to_string(),
        ));
    };

    let Some(actual) = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return Err((
            StatusCode::UNAUTHORIZED,
            "missing backend authorization token".to_string(),
        ));
    };

    if actual != expected {
        return Err((
            StatusCode::UNAUTHORIZED,
            "invalid backend authorization token".to_string(),
        ));
    }

    Ok(())
}

fn payload_string(payload: &serde_json::Value, key: &str) -> Result<String, (StatusCode, String)> {
    payload
        .get(key)
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                format!("payload.{key} must be a string"),
            )
        })
}

fn json_value<T: Serialize>(value: T) -> Result<serde_json::Value, (StatusCode, String)> {
    serde_json::to_value(value).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to serialize app IPC response: {e}"),
        )
    })
}

fn payload_i64(payload: &serde_json::Value, key: &str) -> Result<i64, (StatusCode, String)> {
    payload
        .get(key)
        .and_then(|value| value.as_i64())
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                format!("payload.{key} must be an integer"),
            )
        })
}

fn emit_comment_addressed(state: &AppState) {
    let payload = serde_json::Value::Null;
    if let Some(app) = &state.app {
        let _ = app.emit("comment-addressed", payload.clone());
    }
    publish_app_event(&state.app_event_tx, "comment-addressed", &payload);
}

async fn handle_app_github_review_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    let runtime_error = |error: String| (StatusCode::INTERNAL_SERVER_ERROR, error);
    let value = match request.command.as_str() {
        "get_pull_requests" => {
            json_value(crate::github_runtime::get_pull_requests(&state.db).map_err(runtime_error)?)?
        }
        "get_pr_comments" => {
            let pr_id = payload_i64(&request.payload, "prId")?;
            json_value(
                crate::github_runtime::get_pr_comments(&state.db, pr_id).map_err(runtime_error)?,
            )?
        }
        "mark_comment_addressed" => {
            let comment_id = payload_i64(&request.payload, "commentId")?;
            crate::github_runtime::mark_comment_addressed(&state.db, comment_id)
                .map_err(runtime_error)?;
            emit_comment_addressed(state);
            return Ok(Some(serde_json::Value::Null));
        }
        "get_review_prs" => {
            json_value(crate::github_runtime::get_review_prs(&state.db).map_err(runtime_error)?)?
        }
        "mark_review_pr_viewed" => {
            let pr_id = payload_i64(&request.payload, "prId")?;
            let head_sha = payload_string(&request.payload, "headSha")?;
            crate::github_runtime::mark_review_pr_viewed(&state.db, pr_id, &head_sha)
                .map_err(runtime_error)?;
            serde_json::Value::Null
        }
        "get_authored_prs" => {
            json_value(crate::github_runtime::get_authored_prs(&state.db).map_err(runtime_error)?)?
        }
        "force_github_sync" => json_value(
            crate::github_poller::poll_github_once_for_sidecar(
                state.db.clone(),
                &state.github_client,
                state.app_event_tx.clone(),
            )
            .await,
        )?,
        "merge_pull_request" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let pr_number = payload_i64(&request.payload, "prNumber")?;
            crate::github_runtime::merge_pull_request(
                &state.github_client,
                &owner,
                &repo,
                pr_number,
            )
            .await
            .map_err(runtime_error)?;
            serde_json::Value::Null
        }
        "get_github_username" => json_value(
            crate::github_runtime::github_username(&state.db, &state.github_client)
                .await
                .map_err(runtime_error)?,
        )?,
        "fetch_review_prs" => json_value(
            crate::github_runtime::fetch_review_prs(&state.db, &state.github_client)
                .await
                .map_err(runtime_error)?,
        )?,
        "get_pr_file_diffs" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let pr_number = payload_i64(&request.payload, "prNumber")?;
            json_value(
                crate::github_runtime::get_pr_file_diffs(
                    &state.github_client,
                    &owner,
                    &repo,
                    pr_number,
                )
                .await
                .map_err(runtime_error)?,
            )?
        }
        "get_file_content" | "get_file_content_base64" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let sha = payload_string(&request.payload, "sha")?;
            if request.command == "get_file_content" {
                json_value(
                    crate::github_runtime::get_file_content(
                        &state.github_client,
                        &owner,
                        &repo,
                        &sha,
                    )
                    .await
                    .map_err(runtime_error)?,
                )?
            } else {
                json_value(
                    crate::github_runtime::get_file_content_base64(
                        &state.github_client,
                        &owner,
                        &repo,
                        &sha,
                    )
                    .await
                    .map_err(runtime_error)?,
                )?
            }
        }
        "get_file_at_ref" | "get_file_at_ref_base64" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let path = payload_string(&request.payload, "path")?;
            let ref_sha = payload_string(&request.payload, "refSha")?;
            if request.command == "get_file_at_ref" {
                json_value(
                    crate::github_runtime::get_file_at_ref(
                        &state.github_client,
                        &owner,
                        &repo,
                        &path,
                        &ref_sha,
                    )
                    .await
                    .map_err(runtime_error)?,
                )?
            } else {
                json_value(
                    crate::github_runtime::get_file_at_ref_base64(
                        &state.github_client,
                        &owner,
                        &repo,
                        &path,
                        &ref_sha,
                    )
                    .await
                    .map_err(runtime_error)?,
                )?
            }
        }
        "get_review_comments" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let pr_number = payload_i64(&request.payload, "prNumber")?;
            json_value(
                crate::github_runtime::get_review_comments(
                    &state.github_client,
                    &owner,
                    &repo,
                    pr_number,
                )
                .await
                .map_err(runtime_error)?,
            )?
        }
        "get_pr_overview_comments" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let pr_number = payload_i64(&request.payload, "prNumber")?;
            json_value(
                crate::github_runtime::get_pr_overview_comments(
                    &state.github_client,
                    &owner,
                    &repo,
                    pr_number,
                )
                .await
                .map_err(runtime_error)?,
            )?
        }
        "submit_pr_review" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let pr_number = payload_i64(&request.payload, "prNumber")?;
            let event = payload_string(&request.payload, "event")?;
            let body = payload_string(&request.payload, "body")?;
            let commit_id = payload_string(&request.payload, "commitId")?;
            let comments = request
                .payload
                .get("comments")
                .cloned()
                .unwrap_or_else(|| serde_json::json!([]));
            let comments: Vec<crate::github_client::ReviewSubmitComment> =
                serde_json::from_value(comments).map_err(|e| {
                    (
                        StatusCode::BAD_REQUEST,
                        format!("payload.comments is invalid: {e}"),
                    )
                })?;
            crate::github_runtime::submit_pr_review(
                &state.github_client,
                &owner,
                &repo,
                pr_number,
                &event,
                &body,
                comments,
                &commit_id,
            )
            .await
            .map_err(runtime_error)?;
            serde_json::Value::Null
        }
        "fetch_authored_prs" => json_value(
            crate::github_runtime::fetch_authored_prs(&state.db, &state.github_client)
                .await
                .map_err(runtime_error)?,
        )?,
        _ => return Ok(None),
    };

    Ok(Some(value))
}

fn app_event_sse_data(envelope: &AppEventEnvelope) -> String {
    serde_json::to_string(envelope).unwrap_or_else(|_| {
        "{\"eventName\":\"app-event-serialization-failed\",\"payload\":null}".to_string()
    })
}

async fn app_health_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AppHealthResponse>, (StatusCode, String)> {
    require_backend_token(&state, &headers)?;
    Ok(Json(AppHealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    }))
}

async fn app_events_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (StatusCode, String)> {
    require_backend_token(&state, &headers)?;
    let Some(sender) = state.app_event_tx.as_ref() else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "app event stream is not available".to_string(),
        ));
    };

    let receiver = sender.subscribe();
    let stream = futures::stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(envelope) => {
                    let event = Event::default()
                        .event("openforge-event")
                        .data(app_event_sse_data(&envelope));
                    return Some((Ok(event), receiver));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
            }
        }
    });

    Ok(Sse::new(stream))
}

async fn app_invoke_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<AppInvokeRequest>,
) -> Result<Json<AppInvokeResponse>, (StatusCode, String)> {
    require_backend_token(&state, &headers)?;

    if let Some(value) = crate::app_invoke::handle_whisper_command(&state, &request).await? {
        return Ok(Json(AppInvokeResponse { value }));
    }
    if let Some(value) =
        crate::app_invoke::handle_core_task_project_command(&state, &request).await?
    {
        return Ok(Json(AppInvokeResponse { value }));
    }
    if let Some(value) =
        crate::app_invoke::handle_resume_startup_sessions_command(&state, &request).await?
    {
        return Ok(Json(AppInvokeResponse { value }));
    }
    if let Some(value) =
        crate::app_invoke::handle_start_implementation_command(&state, &request).await?
    {
        return Ok(Json(AppInvokeResponse { value }));
    }
    if let Some(value) =
        crate::app_invoke::handle_abort_implementation_command(&state, &request).await?
    {
        return Ok(Json(AppInvokeResponse { value }));
    }
    if let Some(value) = crate::app_invoke::handle_pty_command(&state, &request).await? {
        return Ok(Json(AppInvokeResponse { value }));
    }
    if let Some(value) = handle_app_github_review_command(&state, &request).await? {
        return Ok(Json(AppInvokeResponse { value }));
    }
    if let Some(value) = crate::app_invoke::handle_plugin_command(&state, &request).await? {
        return Ok(Json(AppInvokeResponse { value }));
    }
    if let Some(value) = crate::app_invoke::handle_files_review_command(&state, &request).await? {
        return Ok(Json(AppInvokeResponse { value }));
    }

    let value = crate::app_invoke::handle_unmatched_command(&state, &request).await?;
    Ok(Json(AppInvokeResponse { value }))
}

/// Create the HTTP router with all available routes
pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/app/health", get(app_health_handler))
        .route("/app/events", get(app_events_handler))
        .route("/app/invoke", post(app_invoke_handler))
        .route("/create_task", post(create_task_handler))
        .route("/update_task", post(update_task_handler))
        .route("/task/:id", get(get_task_info_handler))
        .route("/projects", get(get_projects_handler))
        .route("/tasks", get(get_tasks_handler))
        .route("/project/:id/attention", get(get_project_attention_handler))
        .route("/hooks/pi-agent-start", post(pi_agent_start_handler))
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

fn resolve_http_server_port(
    openforge_backend_port: Option<String>,
    ai_command_center_port: Option<String>,
) -> u16 {
    openforge_backend_port
        .or(ai_command_center_port)
        .and_then(|port| port.parse::<u16>().ok())
        .unwrap_or(17422)
}

/// Start the HTTP server on the configured port
///
/// The server listens on 127.0.0.1 (localhost only) to ensure
/// it's not exposed to the external network.
///
/// The port can be configured via OPENFORGE_BACKEND_PORT for the Electron
/// sidecar contract, or AI_COMMAND_CENTER_PORT for the legacy hook bridge,
/// defaulting to 17422.
pub async fn start_http_server(
    app: tauri::AppHandle,
    db: std::sync::Arc<Mutex<db::Database>>,
    pty_manager: PtyManager,
    ready_tx: tokio::sync::oneshot::Sender<()>,
) -> Result<(), Box<dyn std::error::Error>> {
    let server_manager = app.state::<ServerManager>().inner().clone();
    let sse_bridge_manager = app.state::<SseBridgeManager>().inner().clone();
    start_http_server_with_app_state(
        Some(app),
        db,
        pty_manager,
        server_manager,
        sse_bridge_manager,
        None,
        ready_tx,
    )
    .await
}

pub async fn start_http_sidecar_server(
    db: std::sync::Arc<Mutex<db::Database>>,
    pty_manager: PtyManager,
    server_manager: ServerManager,
    whisper: std::sync::Arc<WhisperManager>,
    ready_tx: tokio::sync::oneshot::Sender<()>,
) -> Result<(), Box<dyn std::error::Error>> {
    start_http_server_with_app_state(
        None,
        db,
        pty_manager,
        server_manager,
        SseBridgeManager::new(),
        Some(whisper),
        ready_tx,
    )
    .await
}

async fn start_http_server_with_app_state(
    app: Option<tauri::AppHandle>,
    db: std::sync::Arc<Mutex<db::Database>>,
    pty_manager: PtyManager,
    server_manager: ServerManager,
    sse_bridge_manager: SseBridgeManager,
    whisper: Option<std::sync::Arc<WhisperManager>>,
    ready_tx: tokio::sync::oneshot::Sender<()>,
) -> Result<(), Box<dyn std::error::Error>> {
    let port = resolve_http_server_port(
        std::env::var("OPENFORGE_BACKEND_PORT").ok(),
        std::env::var("AI_COMMAND_CENTER_PORT").ok(),
    );

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let (app_event_tx, _) = tokio::sync::broadcast::channel(1024);
    let github_client = app
        .as_ref()
        .map(|app| app.state::<GitHubClient>().inner().clone())
        .unwrap_or_else(GitHubClient::new);
    let state = AppState {
        app,
        db: db.clone(),
        backend_token: std::env::var("OPENFORGE_BACKEND_TOKEN").ok(),
        pty_manager: Some(pty_manager),
        server_manager: Some(server_manager),
        sse_bridge_manager: Some(sse_bridge_manager),
        github_client: github_client.clone(),
        app_event_tx: Some(app_event_tx.clone()),
        whisper,
    };

    if state.app.is_none() {
        tokio::spawn(crate::github_poller::start_github_poller_for_sidecar(
            db,
            github_client,
            Some(app_event_tx),
        ));
    }

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
    use crate::app_invoke::{start_opencode_sse_bridge_for_app, ExistingSseBridge};
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

    async fn response_body_text(response: axum::response::Response) -> String {
        let bytes = to_bytes(response.into_body(), 1024 * 1024)
            .await
            .expect("read response body");
        String::from_utf8(bytes.to_vec()).expect("response body utf8")
    }

    fn test_state(name: &str) -> (AppState, std::path::PathBuf) {
        let (db, path) = crate::db::test_helpers::make_test_db(name);
        let (app_event_tx, _) = tokio::sync::broadcast::channel(16);
        (
            AppState {
                app: None,
                db: Arc::new(Mutex::new(db)),
                backend_token: Some("test-token".to_string()),
                pty_manager: Some(PtyManager::new()),
                server_manager: Some(ServerManager::new()),
                sse_bridge_manager: Some(SseBridgeManager::new()),
                github_client: GitHubClient::new(),
                app_event_tx: Some(app_event_tx),
                whisper: Some(Arc::new(WhisperManager::with_active_model(
                    WhisperModelSize::Small,
                ))),
            },
            path,
        )
    }

    #[test]
    fn test_app_invoke_payload_helpers_report_typed_bad_request_errors() {
        let payload = serde_json::json!({ "terminalIndex": "not-a-number" });

        let err = crate::app_invoke::payload::optional_u32(&payload, "terminalIndex")
            .expect_err("invalid terminalIndex should be rejected before PTY dispatch");

        assert_eq!(err.status, StatusCode::BAD_REQUEST);
        assert_eq!(
            err.message,
            "payload.terminalIndex must be an unsigned integer or null"
        );
    }

    #[test]
    fn test_resolve_http_server_port_prefers_electron_sidecar_env() {
        assert_eq!(
            resolve_http_server_port(Some("17642".to_string()), Some("17422".to_string())),
            17642
        );
        assert_eq!(
            resolve_http_server_port(None, Some("17422".to_string())),
            17422
        );
        assert_eq!(
            resolve_http_server_port(Some("not-a-port".to_string()), None),
            17422
        );
    }

    #[test]
    fn test_app_event_sse_data_uses_openforge_event_envelope_shape() {
        let envelope = AppEventEnvelope {
            event_name: "pty-output-T-1-shell-2".to_string(),
            payload: serde_json::json!({ "data": "hi", "instance_id": 7 }),
        };

        let data = serde_json::from_str::<serde_json::Value>(&app_event_sse_data(&envelope))
            .expect("sse data should be valid JSON");
        assert_eq!(data["eventName"], "pty-output-T-1-shell-2");
        assert_eq!(data["payload"]["instance_id"], 7);
    }

    #[tokio::test]
    async fn test_start_opencode_sse_bridge_for_app_publishes_sidecar_events() {
        let (state, path) = test_state("app_opencode_bridge_sidecar_events");
        let task_id = {
            let db = state.db.lock().expect("db lock");
            let task = db
                .create_task("OpenCode sidecar bridge", "doing", None, None, None, None)
                .expect("create task");
            db.create_agent_session(
                "agent-session-1",
                &task.id,
                Some("oc-session-1"),
                "implementing",
                "running",
                "opencode",
            )
            .expect("create session");
            task.id
        };
        let mut events = state
            .app_event_tx
            .as_ref()
            .expect("app event sender")
            .subscribe();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test OpenCode SSE server");
        let port = listener.local_addr().expect("local addr").port();
        let router = axum::Router::new().route(
            "/event",
            axum::routing::get(|| async {
                let payload = serde_json::json!({
                    "type": "permission.asked",
                    "properties": {
                        "sessionID": "oc-session-1",
                        "description": "Allow file write?"
                    }
                })
                .to_string();
                axum::response::sse::Sse::new(futures::stream::iter([Ok::<
                    _,
                    std::convert::Infallible,
                >(
                    axum::response::sse::Event::default()
                        .event("message")
                        .data(payload),
                )]))
            }),
        );
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        start_opencode_sse_bridge_for_app(
            &state,
            &task_id,
            Some("oc-session-1".to_string()),
            port,
            ExistingSseBridge::Error,
        )
        .await
        .expect("start bridge through app state");

        let event = tokio::time::timeout(std::time::Duration::from_secs(3), events.recv())
            .await
            .expect("app event timeout")
            .expect("app event");

        assert_eq!(event.event_name, "agent-event");
        assert_eq!(event.payload["task_id"], task_id);
        assert_eq!(event.payload["event_type"], "permission.asked");

        let session = state
            .db
            .lock()
            .expect("db lock")
            .get_agent_session("agent-session-1")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session.status, "paused");
        assert_eq!(
            session.checkpoint_data.as_deref().unwrap_or(""),
            event.payload["data"].as_str().unwrap_or("")
        );

        state
            .sse_bridge_manager
            .as_ref()
            .expect("bridge manager")
            .stop_bridge(&task_id)
            .await;
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_start_opencode_sse_bridge_for_app_is_idempotent_when_bridge_already_running() {
        let (state, path) = test_state("app_opencode_bridge_already_running");
        let task_id = {
            let db = state.db.lock().expect("db lock");
            let task = db
                .create_task(
                    "OpenCode sidecar bridge idempotent",
                    "doing",
                    None,
                    None,
                    None,
                    None,
                )
                .expect("create task");
            db.create_agent_session(
                "agent-session-1",
                &task.id,
                Some("oc-session-1"),
                "implementing",
                "running",
                "opencode",
            )
            .expect("create session");
            task.id
        };

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test OpenCode SSE server");
        let port = listener.local_addr().expect("local addr").port();
        let router = axum::Router::new().route(
            "/event",
            axum::routing::get(|| async {
                axum::response::sse::Sse::new(futures::stream::pending::<
                    Result<axum::response::sse::Event, std::convert::Infallible>,
                >())
            }),
        );
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        start_opencode_sse_bridge_for_app(
            &state,
            &task_id,
            Some("oc-session-1".to_string()),
            port,
            ExistingSseBridge::Error,
        )
        .await
        .expect("first bridge start should succeed");

        let duplicate_start = start_opencode_sse_bridge_for_app(
            &state,
            &task_id,
            Some("oc-session-2".to_string()),
            port,
            ExistingSseBridge::Error,
        )
        .await;
        assert!(
            duplicate_start.is_err(),
            "non-resume bridge starts should still reject an already-running bridge"
        );

        let resume_start = start_opencode_sse_bridge_for_app(
            &state,
            &task_id,
            Some("oc-session-1".to_string()),
            port,
            ExistingSseBridge::TreatAsResumed,
        )
        .await;

        assert!(
            resume_start.is_ok(),
            "already-running bridge should be treated as a successful idempotent resume, got {resume_start:?}"
        );

        state
            .sse_bridge_manager
            .as_ref()
            .expect("bridge manager")
            .stop_bridge(&task_id)
            .await;
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_events_requires_backend_token() {
        let (state, path) = test_state("app_events_requires_token");
        let router = create_router(state);

        let unauthorized = router
            .oneshot(
                Request::builder()
                    .uri("/app/events")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn test_publish_app_event_fans_out_to_app_event_stream_sender() {
        let (sender, mut receiver) = tokio::sync::broadcast::channel(16);
        let payload = serde_json::json!({ "instance_id": 42 });

        crate::app_events::publish_app_event(&Some(sender), "pty-exit-T-1-shell-2", &payload);

        let received = receiver.try_recv().expect("event should be published");
        assert_eq!(received.event_name, "pty-exit-T-1-shell-2");
        assert_eq!(received.payload["instance_id"], 42);
    }

    #[tokio::test]
    async fn test_app_health_requires_backend_token() {
        let (state, path) = test_state("app_health_requires_token");
        let router = create_router(state);

        let unauthorized = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/health")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

        let authorized = router
            .oneshot(
                Request::builder()
                    .uri("/app/health")
                    .header("authorization", "Bearer test-token")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(authorized.status(), StatusCode::OK);
        assert_eq!(response_body_json(authorized).await["status"], "ok");

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_invoke_handles_whisper_model_status_and_selection() {
        let (state, path) = test_state("app_invoke_whisper_status_selection");
        let router = create_router(state);

        let all_statuses = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"get_all_whisper_model_statuses","payload":null}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(all_statuses.status(), StatusCode::OK);
        let statuses = response_body_json(all_statuses).await["value"]
            .as_array()
            .expect("whisper statuses")
            .clone();
        assert_eq!(statuses.len(), 5);
        assert!(statuses
            .iter()
            .any(|status| status["size"] == "small" && status["is_active"] == true));

        let set_model = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"set_whisper_model","payload":{"modelSize":"tiny"}}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(set_model.status(), StatusCode::OK);

        let active_status = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"get_whisper_model_status","payload":null}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(active_status.status(), StatusCode::OK);
        assert_eq!(
            response_body_json(active_status).await["value"]["size"],
            "tiny"
        );

        let missing_model_transcription = router
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"transcribe_audio","payload":{"audioData":[0.0,0.1,-0.1]}}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(
            missing_model_transcription.status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert!(response_body_text(missing_model_transcription)
            .await
            .contains("Transcription failed"));

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_invoke_handles_config_projects_and_tasks() {
        let (state, path) = test_state("app_invoke_config_projects_tasks");
        let router = create_router(state.clone());

        let set_config = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"set_config","payload":{"key":"theme","value":"dark"}}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(set_config.status(), StatusCode::OK);

        let get_config = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"get_config","payload":{"key":"theme"}}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(response_body_json(get_config).await["value"], "dark");

        let created_project = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"command":"create_project","payload":{"name":"Open Forge","path":"/tmp/openforge"}}"#))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        let project = response_body_json(created_project).await["value"].clone();
        assert_eq!(project["name"], "Open Forge");
        let project_id = project["id"].as_str().expect("project id");

        let created_task = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"command":"create_task","payload":{{"initialPrompt":"Plan migration","status":"backlog","projectId":"{}","agent":null,"permissionMode":null}}}}"#,
                        project_id
                    )))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        let task = response_body_json(created_task).await["value"].clone();
        assert_eq!(task["initial_prompt"], "Plan migration");
        assert_eq!(task["project_id"], project_id);

        let tasks = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from("{\"command\":\"get_tasks\",\"payload\":null}"))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        let tasks = response_body_json(tasks).await["value"]
            .as_array()
            .expect("tasks")
            .clone();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["initial_prompt"], "Plan migration");

        let attention = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        "{\"command\":\"get_project_attention\",\"payload\":null}",
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        let attention = response_body_json(attention).await["value"]
            .as_array()
            .expect("attention rows")
            .clone();
        assert_eq!(attention.len(), 0);

        let app_mode = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        "{\"command\":\"get_app_mode\",\"payload\":null}",
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(response_body_json(app_mode).await["value"], "dev");

        let git_branch = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        "{\"command\":\"get_git_branch\",\"payload\":null}",
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(git_branch.status(), StatusCode::OK);

        let latest_session = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"command":"get_latest_session","payload":{{"taskId":"{}"}}}}"#,
                        task["id"].as_str().expect("task id")
                    )))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert!(response_body_json(latest_session).await["value"].is_null());

        let latest_sessions = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"command":"get_latest_sessions","payload":{{"taskIds":["{}"]}}}}"#,
                        task["id"].as_str().expect("task id")
                    )))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(
            response_body_json(latest_sessions).await["value"]
                .as_array()
                .expect("latest sessions")
                .len(),
            0
        );

        let task_id = task["id"].as_str().expect("task id");
        let update_status = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"command":"update_task_status","payload":{{"id":"{}","status":"doing"}}}}"#,
                        task_id
                    )))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(update_status.status(), StatusCode::OK);
        assert_eq!(
            crate::db::acquire_db(&state.db)
                .get_task(task_id)
                .expect("get updated task")
                .expect("updated task exists")
                .status,
            "doing"
        );

        let delete_task = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"command":"delete_task","payload":{{"id":"{}"}}}}"#,
                        task_id
                    )))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(delete_task.status(), StatusCode::OK);
        assert!(crate::db::acquire_db(&state.db)
            .get_task(task_id)
            .expect("get deleted task")
            .is_none());

        let done_task = {
            let db = crate::db::acquire_db(&state.db);
            db.create_task("Done task", "done", Some(project_id), None, None, None)
                .expect("create done task")
        };
        let clear_done = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"command":"clear_done_tasks","payload":{{"projectId":"{}"}}}}"#,
                        project_id
                    )))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(response_body_json(clear_done).await["value"], 1);
        assert!(crate::db::acquire_db(&state.db)
            .get_task(&done_task.id)
            .expect("get cleared task")
            .is_none());

        let delete_project = router
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"command":"delete_project","payload":{{"id":"{}"}}}}"#,
                        project_id
                    )))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(delete_project.status(), StatusCode::OK);

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_invoke_resume_startup_sessions_publishes_completion_event() {
        let (state, path) = test_state("app_invoke_resume_startup_sessions");
        let mut receiver = state
            .app_event_tx
            .as_ref()
            .expect("app event sender")
            .subscribe();
        let router = create_router(state);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"resume_startup_sessions","payload":{}}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let received = receiver.recv().await.expect("startup completion event");
        assert_eq!(received.event_name, "startup-resume-complete");

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_invoke_handles_agent_lifecycle_followups() {
        let (state, path) = test_state("app_invoke_agent_lifecycle_followups");
        let (pi_task_id, claude_task_id) = {
            let db = crate::db::acquire_db(&state.db);
            let project = db
                .create_project("Lifecycle Project", "/tmp/openforge-lifecycle")
                .expect("create project");
            let pi_task = db
                .create_task("pi task", "doing", Some(&project.id), None, None, None)
                .expect("create pi task");
            let claude_task = db
                .create_task("claude task", "doing", Some(&project.id), None, None, None)
                .expect("create claude task");
            db.create_agent_session(
                "session-pi",
                &pi_task.id,
                None,
                "implementing",
                "running",
                "pi",
            )
            .expect("create pi session");
            db.create_agent_session(
                "session-claude",
                &claude_task.id,
                None,
                "implementing",
                "running",
                "claude-code",
            )
            .expect("create claude session");
            (pi_task.id, claude_task.id)
        };
        let router = create_router(state.clone());

        let status_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"get_session_status","payload":{"sessionId":"session-pi"}}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(status_response.status(), StatusCode::OK);
        assert!(response_body_text(status_response)
            .await
            .contains("session-pi"));

        let finalize_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"command":"finalize_claude_session","payload":{{"taskId":"{}","success":false}}}}"#,
                        claude_task_id
                    )))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(finalize_response.status(), StatusCode::OK);

        let abort_response = router
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"command":"abort_implementation","payload":{{"taskId":"{}"}}}}"#,
                        pi_task_id
                    )))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(abort_response.status(), StatusCode::OK);

        let db = crate::db::acquire_db(&state.db);
        assert_eq!(
            db.get_agent_session("session-claude")
                .expect("get claude")
                .expect("claude exists")
                .status,
            "interrupted"
        );
        assert_eq!(
            db.get_agent_session("session-pi")
                .expect("get pi")
                .expect("pi exists")
                .status,
            "interrupted"
        );

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_invoke_handles_start_implementation() {
        let (state, path) = test_state("app_invoke_start_implementation");
        let router = create_router(state);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"start_implementation","payload":{"taskId":"missing-task","repoPath":"/tmp"}}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert!(response_body_text(response)
            .await
            .contains("Task not found"));

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_invoke_handles_pty_commands_that_do_not_require_spawn() {
        let (state, path) = test_state("app_invoke_pty_commands");
        let router = create_router(state);

        let buffer = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"get_pty_buffer","payload":{"taskId":"T-404"}}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(buffer.status(), StatusCode::OK);
        assert!(response_body_json(buffer).await["value"].is_null());

        let kill_shells = router
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"pty_kill_shells_for_task","payload":{"taskId":"T-404"}}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(kill_shells.status(), StatusCode::OK);
        assert!(response_body_json(kill_shells).await["value"].is_null());

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_invoke_handles_pty_spawn_without_tauri_app_emitter() {
        let (state, path) = test_state("app_invoke_pty_spawn_without_app");
        let router = create_router(state.clone());

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"pty_spawn_shell","payload":{"taskId":"T-1","cwd":"/tmp","cols":80,"rows":24,"terminalIndex":1}}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_body_json(response).await;
        assert!(body["value"].as_u64().expect("instance id") > 0);

        let mut events = state
            .app_event_tx
            .as_ref()
            .expect("event sender")
            .subscribe();
        state
            .pty_manager
            .as_ref()
            .expect("pty manager")
            .write_pty("T-1-shell-1", b"printf sidecar-pty-ready\\n\n")
            .await
            .expect("write shell command");
        let _ = state
            .pty_manager
            .as_ref()
            .expect("pty manager")
            .kill_shells_for_task("T-1")
            .await;
        let mut saw_output = false;
        let mut saw_exit = false;
        for _ in 0..8 {
            let Ok(event) =
                tokio::time::timeout(std::time::Duration::from_secs(2), events.recv()).await
            else {
                break;
            };
            let event = event.expect("event should be available");
            saw_output |= event.event_name == "pty-output-T-1-shell-1";
            saw_exit |= event.event_name == "pty-exit-T-1-shell-1";
            if saw_output && saw_exit {
                break;
            }
        }
        assert!(saw_output, "sidecar should publish PTY output events");
        if !saw_exit {
            let _ = state
                .pty_manager
                .as_ref()
                .expect("pty manager")
                .kill_shells_for_task("T-1")
                .await;
        }
        assert!(saw_exit, "sidecar should publish PTY exit events");
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_pi_agent_status_changes_publish_to_app_event_stream() {
        let (state, path) = test_state("pi_agent_status_publishes_app_event");
        let mut events = state
            .app_event_tx
            .as_ref()
            .expect("event sender")
            .subscribe();
        let task_id = {
            let db = state.db.lock().expect("db lock");
            let task = db
                .create_task("Pi task", "doing", None, None, None, None)
                .expect("create task");
            db.create_agent_session("ses-pi", &task.id, None, "implement", "completed", "pi")
                .expect("create session");
            db.update_agent_session(
                "ses-pi",
                "implement",
                "completed",
                Some(r#"{"pty_instance_id":7}"#),
                None,
            )
            .expect("set checkpoint");
            task.id
        };

        let response = pi_agent_start_handler(
            State(state),
            Json(PiAgentLifecyclePayload {
                task_id: task_id.clone(),
                pty_instance_id: 7,
            }),
        )
        .await
        .expect("handler response");

        assert_eq!(response.0["status"], "ok");
        let event = events.recv().await.expect("app event");
        assert_eq!(event.event_name, "agent-status-changed");
        assert_eq!(event.payload["task_id"], task_id);
        assert_eq!(event.payload["status"], "running");
        assert_eq!(event.payload["provider"], "pi");

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_invoke_get_task_workspace_preserves_legacy_worktree_fallback() {
        let (state, path) = test_state("app_invoke_task_workspace_legacy_fallback");
        let task_id = {
            let db = state.db.lock().expect("db lock");
            let project = db
                .create_project("Open Forge", "/tmp/openforge")
                .expect("create project");
            let task = db
                .create_task(
                    "Legacy worktree task",
                    "doing",
                    Some(&project.id),
                    None,
                    None,
                    None,
                )
                .expect("create task");
            db.create_worktree_record(
                &task.id,
                &project.id,
                "/tmp/openforge",
                "/tmp/openforge-worktree",
                "feature/electron",
            )
            .expect("create worktree");
            db.update_worktree_server(&task.id, 4096, 1234)
                .expect("update worktree server");
            db.create_agent_session(
                "ses-legacy",
                &task.id,
                None,
                "implement",
                "running",
                "opencode",
            )
            .expect("create session");
            task.id
        };
        let router = create_router(state);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"command":"get_task_workspace","payload":{{"taskId":"{}"}}}}"#,
                        task_id
                    )))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let workspace = response_body_json(response).await["value"].clone();
        assert_eq!(workspace["task_id"], task_id);
        assert_eq!(workspace["workspace_path"], "/tmp/openforge-worktree");
        assert_eq!(workspace["provider_name"], "opencode");
        assert_eq!(workspace["opencode_port"], 4096);

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_invoke_handles_plugin_db_backed_commands() {
        let (state, path) = test_state("app_invoke_plugin_db_backed");
        let project_id = {
            let db = state.db.lock().expect("db lock");
            db.create_project("Open Forge", "/tmp/openforge")
                .expect("create project")
                .id
        };
        let router = create_router(state);

        let install = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"command":"install_plugin","payload":{"plugin":{"id":"com.example.echo","name":"Echo","version":"1.0.0","apiVersion":1,"description":"Echo plugin","permissions":"[]","contributes":"{}","frontendEntry":"index.js","backendEntry":null,"installPath":"/tmp/plugin","installedAt":123,"isBuiltin":false}}}"#))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(install.status(), StatusCode::OK);

        let list = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"command":"list_plugins","payload":null}"#))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        let list_json = response_body_json(list).await;
        assert_eq!(list_json["value"][0]["id"], "com.example.echo");
        assert_eq!(list_json["value"][0]["api_version"], 1);

        let set_enabled = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"set_plugin_enabled","payload":{{"projectId":"{}","pluginId":"com.example.echo","enabled":true}}}}"#, project_id)))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(set_enabled.status(), StatusCode::OK);

        let enabled = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"command":"get_enabled_plugins","payload":{{"projectId":"{}"}}}}"#,
                        project_id
                    )))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(
            response_body_json(enabled).await["value"][0]["id"],
            "com.example.echo"
        );

        let storage = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"command":"set_plugin_storage","payload":{"pluginId":"com.example.echo","key":"token","value":"secret"}}"#))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(storage.status(), StatusCode::OK);

        let storage_value = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"command":"get_plugin_storage","payload":{"pluginId":"com.example.echo","key":"token"}}"#))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(response_body_json(storage_value).await["value"], "secret");

        let uninstall = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"command":"uninstall_plugin","payload":{"pluginId":"com.example.echo"}}"#))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(uninstall.status(), StatusCode::NOT_IMPLEMENTED);

        let still_installed = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"get_plugin","payload":{"pluginId":"com.example.echo"}}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(
            response_body_json(still_installed).await["value"]["id"],
            "com.example.echo"
        );

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_invoke_handles_github_review_db_backed_commands_and_events() {
        let (state, path) = test_state("app_invoke_github_review_db_backed");
        let mut events = state
            .app_event_tx
            .as_ref()
            .expect("event sender")
            .subscribe();
        {
            let db = state.db.lock().expect("db lock");
            let task = db
                .create_task("PR task", "doing", None, None, None, None)
                .expect("create task");
            db.insert_pull_request(
                10,
                &task.id,
                "owner",
                "repo",
                "Fix bug",
                "https://github.com/owner/repo/pull/5",
                "open",
                1000,
                2000,
                false,
            )
            .expect("insert PR");
            db.insert_pr_comment(
                501,
                10,
                "reviewer",
                "Please fix",
                "review",
                Some("src/main.rs"),
                Some(12),
                false,
                3000,
            )
            .expect("insert PR comment");
            db.upsert_review_pr(
                20,
                7,
                "Review me",
                Some("body"),
                "open",
                false,
                "https://github.com/owner/repo/pull/7",
                "author",
                None,
                "owner",
                "repo",
                "feature",
                "main",
                "sha-1",
                10,
                2,
                3,
                1000,
                2000,
            )
            .expect("upsert review PR");
            db.upsert_authored_pr(
                30,
                9,
                "Authored by me",
                None,
                "open",
                false,
                "https://github.com/owner/repo/pull/9",
                "me",
                None,
                "owner",
                "repo",
                "feature-authored",
                "main",
                "sha-authored",
                1,
                1,
                1,
                Some("success"),
                None,
                Some("approved"),
                None,
                false,
                Some(&task.id),
                1000,
                2000,
            )
            .expect("upsert authored PR");
        }
        let router = create_router(state.clone());

        let pull_requests = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"get_pull_requests","payload":null}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(
            response_body_json(pull_requests).await["value"][0]["title"],
            "Fix bug"
        );

        let comments = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"get_pr_comments","payload":{"prId":10}}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(
            response_body_json(comments).await["value"][0]["body"],
            "Please fix"
        );

        let mark_comment = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"mark_comment_addressed","payload":{"commentId":501}}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(mark_comment.status(), StatusCode::OK);
        let event = events.recv().await.expect("comment addressed event");
        assert_eq!(event.event_name, "comment-addressed");

        let review_prs = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"command":"get_review_prs","payload":null}"#))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(
            response_body_json(review_prs).await["value"][0]["title"],
            "Review me"
        );

        let mark_viewed = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"command":"mark_review_pr_viewed","payload":{"prId":20,"headSha":"sha-1"}}"#))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(mark_viewed.status(), StatusCode::OK);

        let authored_prs = router
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"get_authored_prs","payload":null}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(
            response_body_json(authored_prs).await["value"][0]["title"],
            "Authored by me"
        );

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_invoke_handles_fs_self_review_and_agent_review_db_commands() {
        let (state, path) = test_state("app_invoke_files_self_agent_review");
        let temp_dir = tempfile::tempdir().expect("temp project dir");
        std::fs::write(temp_dir.path().join("README.md"), "hello electron").expect("write file");
        std::fs::create_dir_all(temp_dir.path().join("src")).expect("create src dir");
        std::fs::write(temp_dir.path().join("src/main.rs"), "fn main() {}\n")
            .expect("write rust file");
        let repo = git2::Repository::init(temp_dir.path()).expect("init repo");
        let mut index = repo.index().expect("repo index");
        index
            .add_path(std::path::Path::new("README.md"))
            .expect("add readme");
        index
            .add_path(std::path::Path::new("src/main.rs"))
            .expect("add main");
        index.write().expect("write index");
        let (project_id, task_id) = {
            let db = state.db.lock().expect("db lock");
            let project = db
                .create_project("Open Forge", temp_dir.path().to_str().expect("utf8 path"))
                .expect("create project");
            let task = db
                .create_task("Review task", "doing", Some(&project.id), None, None, None)
                .expect("create task");
            db.upsert_review_pr(
                88,
                8,
                "Review PR",
                None,
                "open",
                false,
                "https://github.com/owner/repo/pull/8",
                "author",
                None,
                "owner",
                "repo",
                "feature",
                "main",
                "sha-8",
                0,
                0,
                0,
                1000,
                2000,
            )
            .expect("upsert review pr");
            let agent_comment_id = db
                .insert_agent_review_comment(
                    88,
                    "review-session",
                    "file_specific",
                    Some("src/main.rs"),
                    Some(1),
                    Some("RIGHT"),
                    "Agent says fix this",
                    None,
                    None,
                )
                .expect("insert agent comment");
            assert!(agent_comment_id > 0);
            (project.id, task.id)
        };
        let router = create_router(state);

        let dir = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"fs_read_dir","payload":{{"projectId":"{}","dirPath":null}}}}"#, project_id)))
                .expect("build request"),
        ).await.expect("request should succeed");
        let dir_entries = response_body_json(dir).await["value"]
            .as_array()
            .expect("dir entries")
            .clone();
        assert!(dir_entries
            .iter()
            .any(|entry| entry["name"] == "src" && entry["isDir"] == true));

        let file = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"fs_read_file","payload":{{"projectId":"{}","filePath":"README.md"}}}}"#, project_id)))
                .expect("build request"),
        ).await.expect("request should succeed");
        let file_json = response_body_json(file).await;
        assert_eq!(file_json["value"]["content"], "hello electron");
        assert_eq!(file_json["value"]["mimeType"], "text/markdown");

        std::fs::write(temp_dir.path().join("src/main.py"), "print(\"hello\")")
            .expect("write python file");
        let py_file = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"fs_read_file","payload":{{"projectId":"{}","filePath":"src/main.py"}}}}"#, project_id)))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(
            response_body_json(py_file).await["value"]["mimeType"],
            "text/python"
        );

        let search = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"fs_search_files","payload":{{"projectId":"{}","query":"main","limit":10}}}}"#, project_id)))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert!(response_body_json(search).await["value"]
            .as_array()
            .expect("search")
            .iter()
            .any(|value| value == "src/main.rs"));

        let added = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"add_self_review_comment","payload":{{"taskId":"{}","commentType":"general","filePath":null,"lineNumber":null,"body":"Self review note"}}}}"#, task_id)))
                .expect("build request"),
        ).await.expect("request should succeed");
        let self_comment_id = response_body_json(added).await["value"]
            .as_i64()
            .expect("self comment id");
        assert!(self_comment_id > 0);

        let active = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"get_active_self_review_comments","payload":{{"taskId":"{}"}}}}"#, task_id)))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(
            response_body_json(active).await["value"][0]["body"],
            "Self review note"
        );

        let archive = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"archive_self_review_comments","payload":{{"taskId":"{}"}}}}"#, task_id)))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(archive.status(), StatusCode::OK);

        let archived = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"get_archived_self_review_comments","payload":{{"taskId":"{}"}}}}"#, task_id)))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(
            response_body_json(archived).await["value"][0]["id"],
            self_comment_id
        );

        let delete_self = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"delete_self_review_comment","payload":{{"commentId":{}}}}}"#, self_comment_id)))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(delete_self.status(), StatusCode::OK);

        let agent_comments = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"get_agent_review_comments","payload":{"reviewPrId":88}}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        let agent_comment_id = response_body_json(agent_comments).await["value"][0]["id"]
            .as_i64()
            .expect("agent comment id");

        let update_agent = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"update_agent_review_comment_status","payload":{{"commentId":{},"status":"addressed"}}}}"#, agent_comment_id)))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(update_agent.status(), StatusCode::OK);

        let dismiss = router.oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"command":"dismiss_all_agent_review_comments","payload":{"reviewPrId":88}}"#))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(dismiss.status(), StatusCode::OK);

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_invoke_handles_git_workspace_extraction_commands() {
        let (state, path) = test_state("app_invoke_git_workspace_extraction");
        let repo_dir = tempfile::tempdir().expect("temp git repo");
        let repo_path = repo_dir.path();
        let run_git = |args: &[&str]| {
            let output = std::process::Command::new("git")
                .arg("-C")
                .arg(repo_path)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {:?} failed: {}",
                args,
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        };

        run_git(&["init", "-b", "main"]);
        run_git(&["config", "user.email", "test@example.com"]);
        run_git(&["config", "user.name", "Test User"]);
        std::fs::write(repo_path.join("tracked.txt"), "base\n").expect("write base");
        run_git(&["add", "tracked.txt"]);
        run_git(&["commit", "-m", "base"]);
        run_git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
        std::fs::write(repo_path.join("tracked.txt"), "base\nfeature\n").expect("write feature");
        run_git(&["add", "tracked.txt"]);
        run_git(&["commit", "-m", "feature change"]);
        let feature_sha = run_git(&["rev-parse", "HEAD"]);
        std::fs::write(repo_path.join("untracked.txt"), "new\n").expect("write untracked");

        let task_id = {
            let db = crate::db::acquire_db(&state.db);
            let project = db
                .create_project("Git Project", repo_path.to_str().expect("repo path"))
                .expect("create project");
            let task = db
                .create_task("Review diff", "doing", Some(&project.id), None, None, None)
                .expect("create task");
            db.create_task_workspace_record(
                &task.id,
                &project.id,
                repo_path.to_str().expect("repo path"),
                repo_path.to_str().expect("repo path"),
                "project_dir",
                None,
                "opencode",
            )
            .expect("create workspace");
            task.id
        };

        let router = create_router(state);

        let diff = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"get_task_diff","payload":{{"taskId":"{}","includeUncommitted":true}}}}"#, task_id)))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(diff.status(), StatusCode::OK);
        let diff_value = response_body_json(diff).await["value"]
            .as_array()
            .expect("diffs")
            .clone();
        assert!(diff_value
            .iter()
            .any(|file| file["filename"] == "tracked.txt"));
        assert!(diff_value
            .iter()
            .any(|file| file["filename"] == "untracked.txt"));

        let commits = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"command":"get_task_commits","payload":{{"taskId":"{}"}}}}"#,
                        task_id
                    )))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        let commit_value = response_body_json(commits).await["value"]
            .as_array()
            .expect("commits")
            .clone();
        assert_eq!(commit_value.len(), 1);
        assert_eq!(commit_value[0]["message"], "feature change");

        let commit_diff = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"get_commit_diff","payload":{{"taskId":"{}","commitSha":"{}"}}}}"#, task_id, feature_sha)))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(commit_diff.status(), StatusCode::OK);
        assert!(response_body_json(commit_diff).await["value"]
            .as_array()
            .expect("commit diff")
            .iter()
            .any(|file| file["filename"] == "tracked.txt"));

        let task_contents = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"get_task_file_contents","payload":{{"taskId":"{}","path":"tracked.txt","oldPath":null,"status":"modified","includeUncommitted":true}}}}"#, task_id)))
                .expect("build request"),
        ).await.expect("request should succeed");
        let task_contents_value = response_body_json(task_contents).await;
        assert_eq!(task_contents_value["value"][0], "base\n");
        assert_eq!(task_contents_value["value"][1], "base\nfeature\n");

        let batch = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"get_task_batch_file_contents","payload":{{"taskId":"{}","files":[{{"path":"tracked.txt","old_path":null,"status":"modified"}}],"includeUncommitted":true}}}}"#, task_id)))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(
            response_body_json(batch).await["value"][0][1],
            "base\nfeature\n"
        );

        let commit_contents = router.clone().oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"get_commit_file_contents","payload":{{"taskId":"{}","commitSha":"{}","path":"tracked.txt","oldPath":null,"status":"modified"}}}}"#, task_id, feature_sha)))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(
            response_body_json(commit_contents).await["value"][1],
            "base\nfeature\n"
        );

        let commit_batch = router.oneshot(
            Request::builder()
                .uri("/app/invoke")
                .method("POST")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"command":"get_commit_batch_file_contents","payload":{{"taskId":"{}","commitSha":"{}","files":[{{"path":"tracked.txt","old_path":null,"status":"modified"}}]}}}}"#, task_id, feature_sha)))
                .expect("build request"),
        ).await.expect("request should succeed");
        assert_eq!(
            response_body_json(commit_batch).await["value"][0][0],
            "base\n"
        );

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_invoke_returns_explicit_blockers_for_live_files_review_commands() {
        let (state, path) = test_state("app_invoke_files_review_blockers");
        let router = create_router(state);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"start_agent_review","payload":{"reviewPrId":88}}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(response.status(), StatusCode::NOT_IMPLEMENTED);
        assert!(response_body_text(response)
            .await
            .contains("requires provider and server manager state"));

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_invoke_force_github_sync_uses_sidecar_managed_client_state() {
        let (state, path) = test_state("app_invoke_force_github_sync");
        let router = create_router(state);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"force_github_sync","payload":null}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let body = response_body_json(response).await;
        assert_eq!(body["value"]["new_comments"], 0);
        assert_eq!(body["value"]["ci_changes"], 0);
        assert_eq!(body["value"]["review_changes"], 0);
        assert_eq!(body["value"]["pr_changes"], 0);
        assert_eq!(body["value"]["errors"], 0);
        assert_eq!(body["value"]["rate_limited"], false);
        assert_eq!(
            body["value"]["rate_limit_reset_at"],
            serde_json::Value::Null
        );
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_invoke_rejects_out_of_scope_commands() {
        let (state, path) = test_state("app_invoke_rejects_out_of_scope");
        let router = create_router(state);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"unsupported_desktop_command","payload":null}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::NOT_IMPLEMENTED);
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_app_invoke_rejects_malformed_whisper_payload_as_bad_request() {
        let (state, path) = test_state("app_invoke_rejects_malformed_whisper_payload");
        let router = create_router(state);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/app/invoke")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"command":"transcribe_audio","payload":null}"#,
                    ))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let _ = std::fs::remove_file(path);
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
        assert_eq!(
            session.checkpoint_data,
            Some(r#"{"pty_instance_id":42}"#.to_string())
        );
        assert!(session.error_message.is_none());

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_pi_agent_start_hook_marks_completed_pi_session_running() {
        let (state, path) = test_state("http_pi_agent_start_running");
        let task_id = {
            let db = state.db.lock().expect("lock db");
            let project = db
                .create_project("Project", "/tmp/project")
                .expect("create project");
            let task = db
                .create_task("Task A", "doing", Some(&project.id), None, None, None)
                .expect("create task");
            db.create_agent_session(
                "ses-pi-completed",
                &task.id,
                None,
                "implementing",
                "completed",
                "pi",
            )
            .expect("create pi session");
            db.update_agent_session(
                "ses-pi-completed",
                "implementing",
                "completed",
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
                    .uri("/hooks/pi-agent-start")
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
            .get_agent_session("ses-pi-completed")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session.status, "running");
        assert_eq!(
            session.checkpoint_data,
            Some(r#"{"pty_instance_id":42}"#.to_string())
        );
        assert!(session.error_message.is_none());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn test_pi_status_update_emits_when_matching_session_already_has_target_status() {
        let (state, path) = test_state("http_pi_agent_start_idempotent_running");
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

        let status_update = update_pi_session_status_for_pty(
            &state,
            &task_id,
            42,
            "running",
            &["completed", "paused", "interrupted", "running"],
        );

        assert_eq!(status_update, Some("running".to_string()));
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
    async fn test_pi_agent_start_hook_ignores_stale_pty_instance() {
        let (state, path) = test_state("http_pi_agent_start_stale_instance");
        let task_id = {
            let db = state.db.lock().expect("lock db");
            let project = db
                .create_project("Project", "/tmp/project")
                .expect("create project");
            let task = db
                .create_task("Task A", "doing", Some(&project.id), None, None, None)
                .expect("create task");
            db.create_agent_session(
                "ses-pi-completed",
                &task.id,
                None,
                "implementing",
                "completed",
                "pi",
            )
            .expect("create pi session");
            db.update_agent_session(
                "ses-pi-completed",
                "implementing",
                "completed",
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
                    .uri("/hooks/pi-agent-start")
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
            .get_agent_session("ses-pi-completed")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session.status, "completed");

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
    async fn test_get_projects_handler_returns_all_projects() {
        let (state, path) = test_state("http_get_projects_handler_returns_projects");
        {
            let db = state.db.lock().expect("lock db");
            db.create_project("Project A", "/tmp/project-a")
                .expect("create project a");
            db.create_project("Project B", "/tmp/project-b")
                .expect("create project b");
        }

        let router = create_router(state);
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/projects")
                    .method("GET")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let json = response_body_json(response).await;
        let projects = json.as_array().expect("array response");
        assert_eq!(projects.len(), 2);
        assert!(projects.iter().any(|project| {
            project["id"] == "P-1"
                && project["name"] == "Project A"
                && project["path"] == "/tmp/project-a"
        }));
        assert!(projects.iter().any(|project| {
            project["id"] == "P-2"
                && project["name"] == "Project B"
                && project["path"] == "/tmp/project-b"
        }));

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
    async fn test_update_task_handler_updates_summary_without_changing_initial_prompt() {
        let (state, path) = test_state("http_update_task_summary_only");
        let task_id = {
            let db = state.db.lock().expect("lock db");
            let project = db
                .create_project("Project", "/tmp/project")
                .expect("create project");
            db.create_task(
                "Original prompt",
                "backlog",
                Some(&project.id),
                None,
                None,
                None,
            )
            .expect("create task")
            .id
        };

        let router = create_router(state.clone());
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/update_task")
                    .method("POST")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"task_id":"{}","summary":"New Summary"}}"#,
                        task_id
                    )))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let json = response_body_json(response).await;
        assert_eq!(json["task_id"], task_id);
        assert_eq!(json["status"], "updated");

        let task = state
            .db
            .lock()
            .expect("lock db")
            .get_task(&task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.initial_prompt, "Original prompt");
        assert_eq!(task.summary, Some("New Summary".to_string()));

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_update_task_handler_rejects_initial_prompt_and_preserves_task() {
        let (state, path) = test_state("http_update_task_rejects_initial_prompt");
        let task_id = {
            let db = state.db.lock().expect("lock db");
            let project = db
                .create_project("Project", "/tmp/project")
                .expect("create project");
            let task = db
                .create_task(
                    "Original prompt",
                    "backlog",
                    Some(&project.id),
                    None,
                    None,
                    None,
                )
                .expect("create task");
            db.update_task_summary(&task.id, "Existing Summary")
                .expect("seed summary");
            task.id
        };

        let router = create_router(state.clone());
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/update_task")
                    .method("POST")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"task_id":"{}","initial_prompt":"New prompt","summary":"New Summary"}}"#,
                        task_id
                    )))
                    .expect("build request"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let task = state
            .db
            .lock()
            .expect("lock db")
            .get_task(&task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.initial_prompt, "Original prompt");
        assert_eq!(task.summary, Some("Existing Summary".to_string()));

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
    fn test_update_task_request_creation_with_forbidden_initial_prompt_marker() {
        let request = UpdateTaskRequest {
            task_id: "T-123".to_string(),
            initial_prompt: Some("Forbidden prompt update".to_string()),
            summary: Some("New Summary".to_string()),
        };
        assert_eq!(request.task_id, "T-123");
        assert_eq!(
            request.initial_prompt,
            Some("Forbidden prompt update".to_string())
        );
        assert_eq!(request.summary, Some("New Summary".to_string()));
    }

    #[test]
    fn test_update_task_request_deserializes_forbidden_initial_prompt_for_rejection() {
        let json = r#"{"task_id": "T-456", "initial_prompt": "Forbidden prompt update", "summary": "Updated Summary"}"#;
        let request: UpdateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.task_id, "T-456");
        assert_eq!(
            request.initial_prompt,
            Some("Forbidden prompt update".to_string())
        );
        assert_eq!(request.summary, Some("Updated Summary".to_string()));
    }

    #[test]
    fn test_update_task_request_deserializes_forbidden_initial_prompt_without_summary() {
        let json = r#"{"task_id": "T-789", "initial_prompt": "Forbidden prompt update"}"#;
        let request: UpdateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.task_id, "T-789");
        assert_eq!(
            request.initial_prompt,
            Some("Forbidden prompt update".to_string())
        );
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
    fn test_update_task_request_deserialize_no_update_fields() {
        let json = r#"{"task_id": "T-111"}"#;
        let request: UpdateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(request.task_id, "T-111");
        assert!(request.initial_prompt.is_none());
        assert!(request.summary.is_none());
    }

    #[test]
    fn test_update_task_request_deserialize_missing_task_id_fails() {
        let json = r#"{"initial_prompt": "Forbidden prompt update"}"#;
        let result: Result<UpdateTaskRequest, _> = serde_json::from_str(json);
        assert!(
            result.is_err(),
            "Should fail without required task_id field"
        );
    }

    #[test]
    fn test_update_task_request_serialize_roundtrip_preserves_forbidden_marker() {
        let original = UpdateTaskRequest {
            task_id: "T-555".to_string(),
            initial_prompt: Some("Forbidden prompt update".to_string()),
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
