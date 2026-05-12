use crate::{
    app_events::{
        publish_app_event_to_runtime, AppEventBus, AppEventCursor, AppEventEnvelope, AppEventFrame,
        AppEventSender, InMemoryAppEventAdapter,
    },
    db,
    github_client::GitHubClient,
    plugin_host::PluginHost,
    pty_manager::PtyManager,
    whisper_manager::WhisperManager,
};
use axum::{
    extract::{DefaultBodyLimit, Json, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
    Router,
};
use futures::{Stream, StreamExt};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::{
    convert::Infallible,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

const APP_INVOKE_MAX_BODY_BYTES: usize = 96 * 1024 * 1024;
const APP_EVENT_KEEPALIVE_TEXT: &str = "openforge-event-stream-keepalive";
const SIDECAR_RUNTIME_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(test)]
const APP_EVENT_KEEPALIVE_INTERVAL: Duration = Duration::from_millis(50);
#[cfg(not(test))]
const APP_EVENT_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);

/// Request to create a new task from OpenCode
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTaskRequest {
    pub initial_prompt: String,
    pub project_id: Option<String>,
    pub worktree: Option<String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
}

#[derive(Clone)]
pub struct AppState {
    pub app: Option<crate::backend_runtime::AppHandle>,
    pub db: std::sync::Arc<Mutex<db::Database>>,
    pub backend_token: Option<String>,
    pub pty_manager: Option<PtyManager>,
    pub github_client: GitHubClient,
    pub plugin_host: Option<PluginHost>,
    pub app_event_tx: Option<AppEventSender>,
    pub app_event_bus: Option<AppEventBus>,
    pub whisper: Option<std::sync::Arc<WhisperManager>>,
    pub sidecar_readiness: SidecarReadinessState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupResumeReadiness {
    pub phase: String,
    pub target_count: Option<usize>,
    pub resumed_count: Option<usize>,
    pub failed_count: Option<usize>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarDegradedState {
    pub area: String,
    pub message: String,
    pub since: String,
}

#[derive(Debug, Clone, Default)]
pub struct SidecarReadinessState {
    startup_resume: Arc<Mutex<StartupResumeReadiness>>,
    degraded: Arc<Mutex<Vec<SidecarDegradedState>>>,
}

impl Default for StartupResumeReadiness {
    fn default() -> Self {
        Self {
            phase: "pending".to_string(),
            target_count: None,
            resumed_count: None,
            failed_count: None,
            completed_at: None,
        }
    }
}

impl SidecarReadinessState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn startup_resume(&self) -> StartupResumeReadiness {
        self.startup_resume
            .lock()
            .map(|state| state.clone())
            .unwrap_or_default()
    }

    pub fn degraded(&self) -> Vec<SidecarDegradedState> {
        self.degraded
            .lock()
            .map(|state| state.clone())
            .unwrap_or_default()
    }

    pub fn mark_startup_resume_running(&self, target_count: usize) {
        if let Ok(mut state) = self.startup_resume.lock() {
            state.phase = "running".to_string();
            state.target_count = Some(target_count);
            state.resumed_count = Some(0);
            state.failed_count = Some(0);
            state.completed_at = None;
        }
    }

    pub fn record_startup_resume_success(&self) {
        if let Ok(mut state) = self.startup_resume.lock() {
            state.resumed_count = Some(state.resumed_count.unwrap_or(0) + 1);
        }
    }

    pub fn record_startup_resume_failure(&self, message: impl Into<String>) {
        if let Ok(mut state) = self.startup_resume.lock() {
            state.failed_count = Some(state.failed_count.unwrap_or(0) + 1);
        }
        self.mark_degraded("startupResume", message);
    }

    pub fn mark_startup_resume_complete(&self) {
        if let Ok(mut state) = self.startup_resume.lock() {
            if state.failed_count.unwrap_or(0) > 0 {
                state.phase = "degraded".to_string();
            } else {
                state.phase = "complete".to_string();
            }
            state.completed_at = Some(chrono::Utc::now().to_rfc3339());
        }
    }

    pub fn mark_startup_resume_degraded(&self, message: impl Into<String>) {
        if let Ok(mut state) = self.startup_resume.lock() {
            state.phase = "degraded".to_string();
            state.completed_at = Some(chrono::Utc::now().to_rfc3339());
        }
        self.mark_degraded("startupResume", message);
    }

    fn mark_degraded(&self, area: impl Into<String>, message: impl Into<String>) {
        if let Ok(mut degraded) = self.degraded.lock() {
            degraded.push(SidecarDegradedState {
                area: area.into(),
                message: message.into(),
                since: chrono::Utc::now().to_rfc3339(),
            });
        }
    }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetTaskDependenciesRequest {
    pub task_id: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddTaskDependencyRequest {
    pub task_id: String,
    pub depends_on: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkTaskChainRequest {
    pub chain: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinkTaskChainResponse {
    pub status: String,
    pub links: Vec<TaskDependencyLink>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskDependencyLink {
    pub task_id: String,
    pub depends_on: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GetTaskInfoResponse {
    pub id: String,
    pub initial_prompt: String,
    pub prompt: Option<String>,
    pub summary: Option<String>,
    pub status: String,
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppReadinessEventsResponse {
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppReadinessResponse {
    pub status: &'static str,
    pub version: &'static str,
    pub events: AppReadinessEventsResponse,
    pub startup_resume: StartupResumeReadiness,
    pub degraded: Vec<SidecarDegradedState>,
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
    #[serde(default, alias = "OPENFORGE_PTY_INSTANCE_ID")]
    pub pty_instance_id: Option<u64>,
}

/// Payload from the OpenForge Pi extension when a PTY-backed Pi agent starts or finishes a run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PiAgentLifecyclePayload {
    pub task_id: String,
    pub pty_instance_id: u64,
}

/// Payload from the installed OpenCode plugin event hook.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenCodePluginEventPayload {
    pub task_id: String,
    pub pty_instance_id: u64,
    pub event_type: String,
    pub session_id: Option<String>,
    pub status_type: Option<String>,
}

pub type AgentLifecycleNotificationPayload = crate::agent_lifecycle::AgentLifecycleNotification;

fn emit_task_changed(state: &AppState, action: &str, task_id: &str, project_id: Option<&str>) {
    let mut payload = serde_json::json!({
        "action": action,
        "task_id": task_id,
    });
    if let Some(project_id) = project_id {
        payload["project_id"] = serde_json::json!(project_id);
    }

    if let Some(events) = &state.app_event_bus {
        let result = match action {
            "created" => Some(events.tasks().created(task_id, project_id)),
            "updated" => Some(events.tasks().updated(task_id, project_id)),
            _ => None,
        };
        match result {
            Some(Err(error)) => warn!(
                "[http_server] Failed to publish task-changed app event: {:?}",
                error
            ),
            None => publish_app_event_to_runtime(
                state.app.as_ref(),
                &state.app_event_tx,
                "task-changed",
                &payload,
            ),
            Some(Ok(_)) => {}
        }
    } else {
        publish_app_event_to_runtime(
            state.app.as_ref(),
            &state.app_event_tx,
            "task-changed",
            &payload,
        );
    }
}

fn emit_agent_status_changed(
    state: &AppState,
    change: &crate::agent_lifecycle::AgentLifecycleStatusChange,
) {
    let payload = serde_json::json!({
        "task_id": change.task_id,
        "status": change.status,
        "provider": change.provider,
        "kind": change.kind,
        "pty_instance_id": change.pty_instance_id,
        "raw_event_type": change.raw_event_type,
        "raw_status_type": change.raw_status_type,
    });

    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "agent-status-changed",
        &payload,
    );
}

fn record_agent_lifecycle_notification(
    state: &AppState,
    notification: &crate::agent_lifecycle::AgentLifecycleNotification,
) -> Option<crate::agent_lifecycle::AgentLifecycleStatusChange> {
    let db = state.db.lock().unwrap();
    match crate::agent_lifecycle::apply_agent_lifecycle_notification(&db, notification) {
        Ok(status_change) => status_change,
        Err(error) => {
            error!(
                "[http_server] Failed to apply {} lifecycle notification for task {}: {}",
                notification.provider, notification.task_id, error
            );
            None
        }
    }
}

async fn handle_agent_lifecycle_notification(
    state: AppState,
    notification: crate::agent_lifecycle::AgentLifecycleNotification,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let status_change = record_agent_lifecycle_notification(&state, &notification);

    if let Some(change) = status_change {
        emit_agent_status_changed(&state, &change);
    }

    Ok(Json(serde_json::json!({ "status": "ok" })))
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
        )
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create task: {}", e),
            )
        })?;

    if !request.depends_on.is_empty() {
        if let Err(e) = db.set_task_dependencies(&task.id, &request.depends_on) {
            let _ = db.delete_task(&task.id);
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Failed to set task dependencies: {e}"),
            ));
        }
    }

    drop(db);

    emit_task_changed(&state, "created", &task.id, task.project_id.as_deref());

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

    emit_task_changed(&state, "updated", &request.task_id, None);

    Ok(Json(UpdateTaskResponse {
        task_id: request.task_id,
        status: "updated".to_string(),
    }))
}

pub async fn set_task_dependencies_handler(
    State(state): State<AppState>,
    Json(request): Json<SetTaskDependenciesRequest>,
) -> Result<Json<UpdateTaskResponse>, (StatusCode, String)> {
    let db = state.db.lock().unwrap();
    db.set_task_dependencies(&request.task_id, &request.depends_on)
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("Failed to set task dependencies: {e}"),
            )
        })?;
    drop(db);

    emit_task_changed(&state, "updated", &request.task_id, None);

    Ok(Json(UpdateTaskResponse {
        task_id: request.task_id,
        status: "updated".to_string(),
    }))
}

pub async fn add_task_dependency_handler(
    State(state): State<AppState>,
    Json(request): Json<AddTaskDependencyRequest>,
) -> Result<Json<UpdateTaskResponse>, (StatusCode, String)> {
    let db = state.db.lock().unwrap();
    db.add_task_dependency(&request.task_id, &request.depends_on)
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("Failed to add task dependency: {e}"),
            )
        })?;
    drop(db);

    emit_task_changed(&state, "updated", &request.task_id, None);

    Ok(Json(UpdateTaskResponse {
        task_id: request.task_id,
        status: "updated".to_string(),
    }))
}

pub async fn link_task_chain_handler(
    State(state): State<AppState>,
    Json(request): Json<LinkTaskChainRequest>,
) -> Result<Json<LinkTaskChainResponse>, (StatusCode, String)> {
    let db = state.db.lock().unwrap();
    let links = db.link_task_chain(&request.chain).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("Failed to link task chain: {e}"),
        )
    })?;
    drop(db);

    for (task_id, _) in &links {
        emit_task_changed(&state, "updated", task_id, None);
    }

    Ok(Json(LinkTaskChainResponse {
        status: "updated".to_string(),
        links: links
            .into_iter()
            .map(|(task_id, depends_on)| TaskDependencyLink {
                task_id,
                depends_on,
            })
            .collect(),
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
            depends_on: task.depends_on,
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

fn claude_event_kind_from_event(
    event_type: &str,
) -> Option<crate::agent_lifecycle::AgentLifecycleEventKind> {
    match event_type {
        "pre-tool-use" | "post-tool-use" => {
            Some(crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy)
        }
        "stop" | "session-end" => Some(crate::agent_lifecycle::AgentLifecycleEventKind::Ended),
        "notification-permission" => {
            Some(crate::agent_lifecycle::AgentLifecycleEventKind::RequestedPermission)
        }
        "notification" => None,
        _ => None,
    }
}

#[cfg(test)]
pub(crate) fn map_hook_to_status(event_type: &str, current_status: &str) -> Option<String> {
    let kind = claude_event_kind_from_event(event_type)?;
    let (target_status, eligible_statuses) =
        crate::agent_lifecycle::lifecycle_status_transition(kind);
    if !eligible_statuses.contains(&current_status) {
        return None;
    }
    if current_status == target_status
        && kind != crate::agent_lifecycle::AgentLifecycleEventKind::Ended
    {
        return None;
    }
    Some(target_status.to_string())
}

async fn handle_hook(
    State(state): State<AppState>,
    Json(payload): Json<ClaudeHookPayload>,
    event_type: &str,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if let Some(task_id) = &payload.claude_task_id {
        let payload_value = serde_json::to_value(&payload).unwrap_or(serde_json::json!({}));
        publish_app_event_to_runtime(
            state.app.as_ref(),
            &state.app_event_tx,
            "claude-hook-event",
            &serde_json::json!({
                "task_id": task_id,
                "event_type": event_type,
                "payload": payload_value
            }),
        );

        if let Some(kind) = claude_event_kind_from_event(event_type) {
            let notification = crate::agent_lifecycle::AgentLifecycleNotification {
                provider: "claude-code".to_string(),
                task_id: task_id.clone(),
                pty_instance_id: payload.pty_instance_id,
                provider_session_id: payload.session_id.clone(),
                kind,
                raw_event_type: Some(event_type.to_string()),
                raw_status_type: None,
            };
            if let Some(change) = record_agent_lifecycle_notification(&state, &notification) {
                emit_agent_status_changed(&state, &change);
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

pub async fn pi_agent_start_handler(
    State(state): State<AppState>,
    Json(payload): Json<PiAgentLifecyclePayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_agent_lifecycle_notification(
        state,
        crate::agent_lifecycle::AgentLifecycleNotification {
            provider: "pi".to_string(),
            task_id: payload.task_id,
            pty_instance_id: Some(payload.pty_instance_id),
            provider_session_id: None,
            kind: crate::agent_lifecycle::AgentLifecycleEventKind::Started,
            raw_event_type: Some("agent.start".to_string()),
            raw_status_type: None,
        },
    )
    .await
}

pub async fn pi_agent_end_handler(
    State(state): State<AppState>,
    Json(payload): Json<PiAgentLifecyclePayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_agent_lifecycle_notification(
        state,
        crate::agent_lifecycle::AgentLifecycleNotification {
            provider: "pi".to_string(),
            task_id: payload.task_id,
            pty_instance_id: Some(payload.pty_instance_id),
            provider_session_id: None,
            kind: crate::agent_lifecycle::AgentLifecycleEventKind::Ended,
            raw_event_type: Some("agent.end".to_string()),
            raw_status_type: None,
        },
    )
    .await
}

fn opencode_event_kind_from_event(
    event_type: &str,
    status_type: Option<&str>,
) -> Option<crate::agent_lifecycle::AgentLifecycleEventKind> {
    match (event_type, status_type) {
        ("session.status" | "session.created" | "session.updated", Some("idle"))
        | ("session.idle", _) => Some(crate::agent_lifecycle::AgentLifecycleEventKind::BecameIdle),
        (
            "session.status" | "session.created" | "session.updated",
            Some("busy" | "retry" | "running"),
        )
        | ("message.updated", _)
        | ("tool.execute.before" | "tool.execute.after", _) => {
            Some(crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy)
        }
        ("session.status" | "session.created" | "session.updated", Some("error" | "failed"))
        | ("session.error", _) => Some(crate::agent_lifecycle::AgentLifecycleEventKind::Failed),
        _ => None,
    }
}

#[cfg(test)]
fn opencode_status_from_event(
    event_type: &str,
    status_type: Option<&str>,
) -> Option<(&'static str, &'static [&'static str])> {
    let kind = opencode_event_kind_from_event(event_type, status_type)?;
    Some(crate::agent_lifecycle::lifecycle_status_transition(kind))
}

pub async fn opencode_event_handler(
    State(state): State<AppState>,
    Json(payload): Json<OpenCodePluginEventPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "opencode-plugin-event",
        &serde_json::json!({
            "task_id": payload.task_id,
            "event_type": payload.event_type,
            "session_id": payload.session_id,
            "status_type": payload.status_type,
        }),
    );

    let Some(kind) =
        opencode_event_kind_from_event(&payload.event_type, payload.status_type.as_deref())
    else {
        return Ok(Json(serde_json::json!({ "status": "ok" })));
    };

    let notification = crate::agent_lifecycle::AgentLifecycleNotification {
        provider: "opencode".to_string(),
        task_id: payload.task_id,
        pty_instance_id: Some(payload.pty_instance_id),
        provider_session_id: payload.session_id,
        kind,
        raw_event_type: Some(payload.event_type),
        raw_status_type: payload.status_type,
    };

    handle_agent_lifecycle_notification(state, notification).await
}

pub async fn agent_lifecycle_handler(
    State(state): State<AppState>,
    Json(payload): Json<AgentLifecycleNotificationPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_agent_lifecycle_notification(state, payload).await
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

fn app_event_sse_data(envelope: &AppEventEnvelope) -> String {
    serde_json::to_string(envelope).unwrap_or_else(|_| {
        "{\"eventName\":\"app-event-serialization-failed\",\"payload\":null}".to_string()
    })
}

fn app_event_sse_event(envelope: &AppEventEnvelope) -> Event {
    let event = Event::default()
        .event("openforge-event")
        .data(app_event_sse_data(envelope));
    if let Some(id) = envelope.id.as_ref() {
        event.id(id.as_sse_id())
    } else {
        event
    }
}

fn app_event_keep_alive() -> KeepAlive {
    KeepAlive::new()
        .interval(APP_EVENT_KEEPALIVE_INTERVAL)
        .text(APP_EVENT_KEEPALIVE_TEXT)
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

async fn app_readiness_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AppReadinessResponse>, (StatusCode, String)> {
    require_backend_token(&state, &headers)?;
    Ok(Json(AppReadinessResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        events: AppReadinessEventsResponse {
            available: state.app_event_bus.is_some() || state.app_event_tx.is_some(),
        },
        startup_resume: state.sidecar_readiness.startup_resume(),
        degraded: state.sidecar_readiness.degraded(),
    }))
}

async fn app_events_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (StatusCode, String)> {
    require_backend_token(&state, &headers)?;

    if let Some(bus) = state.app_event_bus.as_ref() {
        let cursor = headers
            .get("last-event-id")
            .and_then(|value| value.to_str().ok())
            .and_then(AppEventCursor::parse);
        let subscription = bus.subscribe(cursor).map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "app event stream is not available".to_string(),
            )
        })?;
        let stream = futures::stream::unfold(subscription, |mut subscription| async move {
            subscription.recv().await.map(|frame| {
                let event = match frame {
                    AppEventFrame::Event(envelope) => app_event_sse_event(&envelope),
                    AppEventFrame::Gap(gap) => app_event_sse_event(&gap.into_envelope()),
                };
                (Ok(event), subscription)
            })
        })
        .boxed();

        return Ok(Sse::new(stream).keep_alive(app_event_keep_alive()));
    }

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
                Ok(envelope) => return Some((Ok(app_event_sse_event(&envelope)), receiver)),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
            }
        }
    })
    .boxed();

    Ok(Sse::new(stream).keep_alive(app_event_keep_alive()))
}

async fn app_invoke_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<AppInvokeRequest>,
) -> Result<Json<AppInvokeResponse>, (StatusCode, String)> {
    require_backend_token(&state, &headers)?;

    let value = crate::app_invoke::handle_command(&state, &request).await?;
    Ok(Json(AppInvokeResponse { value }))
}

/// Create the HTTP router with all available routes
pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/app/health", get(app_health_handler))
        .route("/app/readiness", get(app_readiness_handler))
        .route("/app/events", get(app_events_handler))
        .route(
            "/app/invoke",
            post(app_invoke_handler).layer(DefaultBodyLimit::max(APP_INVOKE_MAX_BODY_BYTES)),
        )
        .route("/create_task", post(create_task_handler))
        .route("/update_task", post(update_task_handler))
        .route(
            "/set_task_dependencies",
            post(set_task_dependencies_handler),
        )
        .route("/add_task_dependency", post(add_task_dependency_handler))
        .route("/link_task_chain", post(link_task_chain_handler))
        .route("/task/:id", get(get_task_info_handler))
        .route("/projects", get(get_projects_handler))
        .route("/tasks", get(get_tasks_handler))
        .route("/project/:id/attention", get(get_project_attention_handler))
        .route("/hooks/agent-lifecycle", post(agent_lifecycle_handler))
        .route("/hooks/pi-agent-start", post(pi_agent_start_handler))
        .route("/hooks/pi-agent-end", post(pi_agent_end_handler))
        .route("/hooks/opencode-event", post(opencode_event_handler))
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
pub fn electron_sidecar_app_handle(
    app_data_dir: PathBuf,
    resource_dir: PathBuf,
) -> crate::backend_runtime::AppHandle {
    crate::backend_runtime::AppHandle::with_app_paths(app_data_dir, resource_dir)
}

async fn sidecar_shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            warn!(
                "[http_server] Failed to listen for ctrl-c shutdown signal: {}",
                error
            );
        }
    };

    #[cfg(unix)]
    {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut terminate) => {
                tokio::select! {
                    _ = ctrl_c => {},
                    _ = terminate.recv() => {},
                }
            }
            Err(error) => {
                warn!(
                    "[http_server] Failed to listen for SIGTERM shutdown signal: {}",
                    error
                );
                ctrl_c.await;
            }
        }
    }

    #[cfg(not(unix))]
    ctrl_c.await;
}

async fn shutdown_sidecar_runtime(state: &AppState) {
    info!("[http_server] Rust sidecar shutdown cleanup started");

    if let Some(plugin_host) = &state.plugin_host {
        if let Err(error) = plugin_host.stop_sidecar().await {
            warn!(
                "[http_server] Failed to stop plugin sidecar during shutdown: {}",
                error
            );
        }
    }

    if let Some(pty_manager) = &state.pty_manager {
        pty_manager.kill_all().await;
    }

    info!("[http_server] Rust sidecar shutdown cleanup completed");
}

pub async fn start_http_sidecar_server(
    app: crate::backend_runtime::AppHandle,
    db: std::sync::Arc<Mutex<db::Database>>,
    pty_manager: PtyManager,
    whisper: std::sync::Arc<WhisperManager>,
    sidecar_readiness: SidecarReadinessState,
    ready_tx: tokio::sync::oneshot::Sender<()>,
) -> Result<(), Box<dyn std::error::Error>> {
    start_http_server_with_app_state(
        Some(app),
        db,
        pty_manager,
        Some(whisper),
        sidecar_readiness,
        true,
        ready_tx,
    )
    .await
}

async fn start_http_server_with_app_state(
    app: Option<crate::backend_runtime::AppHandle>,
    db: std::sync::Arc<Mutex<db::Database>>,
    pty_manager: PtyManager,
    whisper: Option<std::sync::Arc<WhisperManager>>,
    sidecar_readiness: SidecarReadinessState,
    is_electron_sidecar: bool,
    ready_tx: tokio::sync::oneshot::Sender<()>,
) -> Result<(), Box<dyn std::error::Error>> {
    let port = resolve_http_server_port(
        std::env::var("OPENFORGE_BACKEND_PORT").ok(),
        std::env::var("AI_COMMAND_CENTER_PORT").ok(),
    );

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let app_event_bus = AppEventBus::new(1024, 1024);
    let app_event_tx = app_event_bus.sender();
    if let Some(app) = app.as_ref() {
        app.set_app_event_adapter(std::sync::Arc::new(InMemoryAppEventAdapter::new(
            app_event_bus.clone(),
        )));
    }
    let github_client = app
        .as_ref()
        .and_then(|app| app.try_state::<GitHubClient>())
        .map(|state| state.inner().clone())
        .unwrap_or_else(GitHubClient::new);
    let plugin_host = Some(PluginHost::with_app_event_sender(
        app.clone()
            .unwrap_or_else(crate::backend_runtime::AppHandle::new),
        Some(app_event_tx.clone()),
    ));
    let state = AppState {
        app,
        db: db.clone(),
        backend_token: std::env::var("OPENFORGE_BACKEND_TOKEN").ok(),
        pty_manager: Some(pty_manager),
        github_client: github_client.clone(),
        plugin_host,
        app_event_tx: Some(app_event_tx.clone()),
        app_event_bus: Some(app_event_bus),
        whisper,
        sidecar_readiness,
    };

    if is_electron_sidecar {
        tokio::spawn(crate::github_poller::start_github_poller_for_sidecar(
            db,
            github_client,
            Some(app_event_tx),
        ));
    }

    let shutdown_state = state.clone();
    let router = create_router(state);

    info!("[http_server] Starting on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    // Signal that the server is listening before entering the serve loop
    let _ = ready_tx.send(());
    if is_electron_sidecar {
        axum::serve(listener, router)
            .with_graceful_shutdown(sidecar_shutdown_signal())
            .await?;

        if tokio::time::timeout(
            SIDECAR_RUNTIME_SHUTDOWN_TIMEOUT,
            shutdown_sidecar_runtime(&shutdown_state),
        )
        .await
        .is_err()
        {
            warn!(
                "[http_server] Rust sidecar shutdown cleanup timed out after {:?}",
                SIDECAR_RUNTIME_SHUTDOWN_TIMEOUT
            );
        }
    } else {
        axum::serve(listener, router).await?;
    }

    Ok(())
}

#[cfg(test)]
#[path = "http_server_tests/mod.rs"]
mod tests;
