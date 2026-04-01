use crate::db;
use crate::opencode_client::{OpenCodeClient, OpenCodeError, SessionInfo, SessionStatusInfo};
use eventsource_client::{self as es, Client};
use futures::TryStreamExt;
use log::{debug, error, info, warn};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

// ============================================================================
// Constants
// ============================================================================

/// Polling interval for checking child session status (seconds)
const CHILD_CHECK_INTERVAL_SECS: u64 = 5;
/// Maximum time to wait for child sessions to complete (seconds)
const CHILD_CHECK_TIMEOUT_SECS: u64 = 600; // 10 minutes
const DESCENDANT_IDLE_CONFIRMATION_POLLS: u64 = 2;

// ============================================================================
// Error Types
// ============================================================================

#[derive(Debug)]
pub enum SseBridgeError {
    ConnectionFailed(String),
    AlreadyRunning(String),
}

impl std::fmt::Display for SseBridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SseBridgeError::ConnectionFailed(msg) => write!(f, "SSE connection failed: {}", msg),
            SseBridgeError::AlreadyRunning(task_id) => {
                write!(f, "SSE bridge already running for task: {}", task_id)
            }
        }
    }
}

impl std::error::Error for SseBridgeError {}

// ============================================================================
// Event Payloads
// ============================================================================

/// Payload for agent events forwarded to frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct AgentEventPayload {
    pub task_id: String,
    pub event_type: String,
    pub data: String,
    pub timestamp: u64,
}

/// Payload for action-complete event
#[derive(Debug, Clone, serde::Serialize)]
pub struct CompletionPayload {
    pub task_id: String,
}

/// Payload for implementation-failed event
#[derive(Debug, Clone, serde::Serialize)]
pub struct FailurePayload {
    pub task_id: String,
    pub error: String,
}

// ============================================================================
// Helpers
// ============================================================================

fn persist_session_completed(app: &AppHandle, task_id: &str) {
    let db = app.state::<Arc<std::sync::Mutex<db::Database>>>();
    if let Ok(db_lock) = db.lock() {
        if let Ok(Some(session)) = db_lock.get_latest_session_for_ticket(task_id) {
            if let Err(e) =
                db_lock.update_agent_session(&session.id, &session.stage, "completed", None, None)
            {
                error!(
                    "[SSE] Failed to persist completed status for task {}: {}",
                    task_id, e
                );
            }
        }
    };
}

fn persist_session_interrupted(app: &AppHandle, task_id: &str, reason: &str) {
    let db = app.state::<Arc<std::sync::Mutex<db::Database>>>();
    if let Ok(db_lock) = db.lock() {
        if let Ok(Some(session)) = db_lock.get_latest_session_for_ticket(task_id) {
            if let Err(e) = db_lock.update_agent_session(
                &session.id,
                &session.stage,
                "interrupted",
                None,
                Some(reason),
            ) {
                error!(
                    "[SSE] Failed to persist interrupted status for task {}: {}",
                    task_id, e
                );
            }
        }
    };
}

fn emit_session_interrupted(app: &AppHandle, task_id: &str) {
    if let Err(e) = app.emit(
        "agent-status-changed",
        serde_json::json!({
            "task_id": task_id,
            "status": "interrupted",
            "provider": "opencode"
        }),
    ) {
        warn!(
            "[SSE] Failed to emit interrupted status for task {}: {}",
            task_id, e
        );
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DescendantPollOutcome {
    AllIdle,
    LookupFailed,
    MissingRootSessionId,
    TimedOut,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CompletionAction {
    EmitComplete,
    MarkInterrupted,
}

fn completion_action_for_descendant_outcome(outcome: DescendantPollOutcome) -> CompletionAction {
    match outcome {
        DescendantPollOutcome::AllIdle => CompletionAction::EmitComplete,
        DescendantPollOutcome::LookupFailed
        | DescendantPollOutcome::MissingRootSessionId
        | DescendantPollOutcome::TimedOut => CompletionAction::MarkInterrupted,
    }
}

fn interruption_reason_for_descendant_outcome(outcome: DescendantPollOutcome) -> &'static str {
    match outcome {
        DescendantPollOutcome::AllIdle => "",
        DescendantPollOutcome::LookupFailed => {
            "OpenCode child session status lookup failed during idle reconciliation"
        }
        DescendantPollOutcome::MissingRootSessionId => {
            "OpenCode session id unavailable during idle reconciliation"
        }
        DescendantPollOutcome::TimedOut => {
            "OpenCode idle reconciliation timed out before completion was confirmed"
        }
    }
}

fn should_persist_completed_status(spawned_child_poll: bool, child_poll_in_progress: bool) -> bool {
    !spawned_child_poll && !child_poll_in_progress
}

fn is_status_event_type(event_type: &str) -> bool {
    matches!(
        event_type,
        "session.idle"
            | "session.status"
            | "session.error"
            | "permission.asked"
            | "permission.updated"
            | "permission.replied"
            | "question.asked"
            | "question.replied"
            | "question.rejected"
            | "question.answered"
    )
}

fn map_checkpoint_event_to_session_status(event_type: &str) -> Option<&'static str> {
    match event_type {
        "permission.asked" | "permission.updated" | "question.asked" => Some("paused"),
        "permission.replied" | "question.replied" | "question.rejected" | "question.answered" => {
            Some("running")
        }
        _ => None,
    }
}

fn collect_descendant_ids(
    root_session_id: &str,
    children_by_parent: &HashMap<String, Vec<SessionInfo>>,
) -> HashSet<String> {
    let mut descendants = HashSet::new();
    let mut stack = vec![root_session_id.to_string()];

    while let Some(parent_id) = stack.pop() {
        if let Some(children) = children_by_parent.get(&parent_id) {
            for child in children {
                if descendants.insert(child.id.clone()) {
                    stack.push(child.id.clone());
                }
            }
        }
    }

    descendants
}

fn has_active_descendants(
    descendant_ids: &HashSet<String>,
    statuses: &HashMap<String, SessionStatusInfo>,
) -> bool {
    descendant_ids.iter().any(|id| {
        statuses
            .get(id)
            .map(|status| status.status_type != "idle")
            .unwrap_or(false)
    })
}

fn descendant_snapshot_is_idle_candidate(
    descendant_ids: &HashSet<String>,
    statuses: &HashMap<String, SessionStatusInfo>,
) -> bool {
    descendant_ids.is_empty() || !has_active_descendants(descendant_ids, statuses)
}

fn root_session_is_idle_candidate(
    root_session_id: &str,
    statuses: &HashMap<String, SessionStatusInfo>,
) -> bool {
    statuses
        .get(root_session_id)
        .map(|status| status.status_type == "idle")
        .unwrap_or(true)
}

fn completion_snapshot_is_idle_candidate(
    root_session_id: &str,
    descendant_ids: &HashSet<String>,
    statuses: &HashMap<String, SessionStatusInfo>,
) -> bool {
    root_session_is_idle_candidate(root_session_id, statuses)
        && descendant_snapshot_is_idle_candidate(descendant_ids, statuses)
}

async fn fetch_descendant_session_ids(
    client: &OpenCodeClient,
    root_session_id: &str,
) -> Result<HashSet<String>, OpenCodeError> {
    let mut children_by_parent: HashMap<String, Vec<SessionInfo>> = HashMap::new();
    let mut pending = vec![root_session_id.to_string()];

    while let Some(parent_id) = pending.pop() {
        let children = client.get_session_children(&parent_id).await?;
        for child in &children {
            pending.push(child.id.clone());
        }
        children_by_parent.insert(parent_id, children);
    }

    Ok(collect_descendant_ids(root_session_id, &children_by_parent))
}

// ============================================================================
// Bridge Handle
// ============================================================================

/// Handle for a running SSE bridge (private)
struct BridgeHandle {
    cancel_tx: tokio::sync::oneshot::Sender<()>,
}

// ============================================================================
// SSE Bridge Manager
// ============================================================================

/// Manages multiple concurrent SSE bridges (one per active task/worktree)
#[derive(Clone)]
pub struct SseBridgeManager {
    bridges: Arc<Mutex<HashMap<String, BridgeHandle>>>,
}

impl SseBridgeManager {
    /// Create a new SSE bridge manager
    pub fn new() -> Self {
        Self {
            bridges: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start a new SSE bridge for a task
    ///
    /// # Arguments
    /// * `app` - Tauri application handle for event emission
    /// * `task_id` - Unique identifier for this task
    /// * `opencode_session_id` - Optional OpenCode session ID for filtering events
    /// * `server_port` - Port where OpenCode server is listening
    ///
    /// # Returns
    /// * `Ok(())` if bridge started successfully
    /// * `Err(SseBridgeError::AlreadyRunning)` if bridge already exists for this task_id
    /// * `Err(SseBridgeError::ConnectionFailed)` if client creation fails
    pub async fn start_bridge(
        &self,
        app: AppHandle,
        task_id: String,
        opencode_session_id: Option<String>,
        server_port: u16,
    ) -> Result<(), SseBridgeError> {
        {
            let bridges = self.bridges.lock().await;
            if bridges.contains_key(&task_id) {
                return Err(SseBridgeError::AlreadyRunning(task_id));
            }
        }

        let url = format!("http://127.0.0.1:{}/event", server_port);

        let client = es::ClientBuilder::for_url(&url)
            .map_err(|e| {
                SseBridgeError::ConnectionFailed(format!("Failed to build client: {}", e))
            })?
            .reconnect(
                es::ReconnectOptions::reconnect(true)
                    .retry_initial(true)
                    .delay(std::time::Duration::from_millis(500))
                    .backoff_factor(2)
                    .delay_max(std::time::Duration::from_secs(30))
                    .build(),
            )
            .build();

        let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();

        let task_id_clone = task_id.clone();
        let opencode_session_id_clone = opencode_session_id.clone();
        let bridges_clone = self.bridges.clone();

        tokio::spawn(async move {
            info!(
                "[SSE] Starting bridge for task {} on port {}",
                task_id_clone, server_port
            );

            let stream = client.stream();

            let child_poll_in_progress = Arc::new(AtomicBool::new(false));

            tokio::select! {
                result = stream.try_for_each(|event| {
                    let app_clone = app.clone();
                    let task_id = task_id_clone.clone();
                    let opencode_session_id_clone = opencode_session_id_clone.clone();
                    let child_poll_in_progress = child_poll_in_progress.clone();

                    async move {
                        match event {
                            es::SSE::Event(evt) => {
                                let parsed = serde_json::from_str::<serde_json::Value>(&evt.data).ok();

                                let real_event_type = parsed.as_ref()
                                    .and_then(|v| v.get("type"))
                                    .and_then(|t| t.as_str())
                                    .unwrap_or(&evt.event_type);

                                match real_event_type {
                                    "message.part.delta" if task_id.starts_with("pr-review-") => {
                                        // Allow streaming deltas through for PR review sessions
                                        if let Some(ref parsed_val) = parsed {
                                            let delta_preview = parsed_val
                                                .get("properties")
                                                .and_then(|p| p.get("delta"))
                                                .and_then(|d| d.as_str())
                                                .map(|s| if s.len() > 100 { format!("{}...", &s[..100]) } else { s.to_string() })
                                                .unwrap_or_else(|| "<no delta field>".to_string());
                                            let field = parsed_val
                                                .get("properties")
                                                .and_then(|p| p.get("field"))
                                                .and_then(|f| f.as_str())
                                                .unwrap_or("<no field>");
                                            debug!("[SSE][{}] message.part.delta field={} delta_preview={}", task_id, field, delta_preview);
                                        } else {
                                            debug!("[SSE][{}] message.part.delta (unparsed): {}", task_id, &evt.data[..std::cmp::min(200, evt.data.len())]);
                                        }
                                    }
                                    "message.part.delta" | "message.part.updated" |
                                    "message.updated" | "message.removed" |
                                    "server.heartbeat" | "server.connected" => {
                                        return Ok(());
                                    }
                                    _ => {}
                                }

                                // Log all events emitted for pr-review tasks
                                if task_id.starts_with("pr-review-") {
                                    debug!("[SSE][{}] Emitting event: {} data_len={}", task_id, real_event_type, evt.data.len());
                                }

                                let payload = AgentEventPayload {
                                    task_id: task_id.clone(),
                                    event_type: real_event_type.to_string(),
                                    data: evt.data.clone(),
                                    timestamp: std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap()
                                        .as_secs(),
                                };

                                if let Err(e) = app_clone.emit("agent-event", &payload) {
                                    warn!("[SSE] Failed to emit agent-event: {}", e);
                                }

                                // Layer 1: SessionID filtering — only react to status-changing events
                                // from OUR session. Child/unrelated session events are still forwarded
                                // to the frontend above, but completion/error/pause logic is skipped.
                                let event_session_id = parsed.as_ref()
                                    .and_then(|v| v.get("properties"))
                                    .and_then(|p| p.get("sessionID"))
                                    .and_then(|s| s.as_str())
                                    .map(|s| s.to_string());

                                let is_status_event = is_status_event_type(real_event_type);

                                if is_status_event {
                                    if let (Some(ref our_session_id), Some(ref event_sid)) = (&opencode_session_id_clone, &event_session_id) {
                                        if our_session_id != event_sid {
                                            return Ok(());
                                        }
                                    }
                                }

                                // Layer 2: Child-check polling on parent idle.
                                // When our session goes idle, check if children are still busy
                                // before emitting action-complete. Polling runs in a separate task
                                // so the SSE stream is not blocked.
                                let is_session_idle = real_event_type == "session.idle"
                                    || (real_event_type == "session.status" && parsed.as_ref()
                                        .and_then(|v| v.get("properties"))
                                        .and_then(|p| p.get("status"))
                                        .and_then(|s| s.get("type"))
                                        .and_then(|t| t.as_str()) == Some("idle"));

                                let mut spawned_child_poll = false;

                                if is_session_idle {
                                    info!("[SSE] Session idle for task {} — checking for active children", task_id);

                                    if child_poll_in_progress.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
                                        spawned_child_poll = true;
                                        let our_session_id_opt = opencode_session_id_clone.clone();
                                        let app_for_poll = app_clone.clone();
                                        let task_id_for_poll = task_id.clone();
                                        let poll_flag = child_poll_in_progress.clone();

                                        tokio::spawn(async move {
                                            let emit_complete = |app: &AppHandle, task_id: &str| {
                                                let completion = CompletionPayload { task_id: task_id.to_string() };
                                                if let Err(e) = app.emit("action-complete", &completion) {
                                                    warn!("[SSE] Failed to emit action-complete: {}", e);
                                                }
                                            };

                                            let mark_interrupted = |app: &AppHandle, task_id: &str, outcome: DescendantPollOutcome| {
                                                let reason = interruption_reason_for_descendant_outcome(outcome);
                                                warn!(
                                                    "[SSE] Descendant polling ended without confirmed completion for task {} ({:?}) — marking interrupted",
                                                    task_id, outcome
                                                );
                                                persist_session_interrupted(app, task_id, reason);
                                                emit_session_interrupted(app, task_id);
                                            };

                                            let our_session_id = match our_session_id_opt {
                                                Some(ref id) => id.clone(),
                                                None => {
                                                    match completion_action_for_descendant_outcome(DescendantPollOutcome::MissingRootSessionId) {
                                                        CompletionAction::EmitComplete => {
                                                            emit_complete(&app_for_poll, &task_id_for_poll);
                                                            persist_session_completed(&app_for_poll, &task_id_for_poll);
                                                        }
                                                        CompletionAction::MarkInterrupted => {
                                                            mark_interrupted(
                                                                &app_for_poll,
                                                                &task_id_for_poll,
                                                                DescendantPollOutcome::MissingRootSessionId,
                                                            );
                                                        }
                                                    }
                                                    poll_flag.store(false, Ordering::SeqCst);
                                                    return;
                                                }
                                            };

                                            let oc_client = OpenCodeClient::with_base_url(
                                                format!("http://127.0.0.1:{}", server_port)
                                            );

                                            let max_iterations = CHILD_CHECK_TIMEOUT_SECS / CHILD_CHECK_INTERVAL_SECS;
                                            let mut poll_outcome = DescendantPollOutcome::TimedOut;
                                            let mut consecutive_idle_snapshots = 0;

                                            for iteration in 0..max_iterations {
                                                let descendant_ids = match fetch_descendant_session_ids(&oc_client, &our_session_id).await {
                                                    Ok(ids) => ids,
                                                    Err(e) => {
                                                        warn!("[SSE] fetch_descendant_session_ids failed for task {} (iter {}): {}", task_id_for_poll, iteration + 1, e);
                                                        poll_outcome = DescendantPollOutcome::LookupFailed;
                                                        break;
                                                    }
                                                };

                                                let statuses = match oc_client.get_all_session_statuses().await {
                                                    Ok(s) => s,
                                                    Err(e) => {
                                                        warn!("[SSE] get_all_session_statuses failed (task {}, iter {}): {}", task_id_for_poll, iteration + 1, e);
                                                        poll_outcome = DescendantPollOutcome::LookupFailed;
                                                        break;
                                                    }
                                                };

                                                if completion_snapshot_is_idle_candidate(&our_session_id, &descendant_ids, &statuses) {
                                                    consecutive_idle_snapshots += 1;
                                                    if consecutive_idle_snapshots >= DESCENDANT_IDLE_CONFIRMATION_POLLS {
                                                        info!("[SSE] Root and descendants idle — emitting action-complete for task {}", task_id_for_poll);
                                                        poll_outcome = DescendantPollOutcome::AllIdle;
                                                        break;
                                                    }
                                                } else {
                                                    consecutive_idle_snapshots = 0;
                                                }

                                                debug!("[SSE] Descendants still busy (iter {}/{}) for task {} — waiting {}s", iteration + 1, max_iterations, task_id_for_poll, CHILD_CHECK_INTERVAL_SECS);
                                                tokio::time::sleep(tokio::time::Duration::from_secs(CHILD_CHECK_INTERVAL_SECS)).await;
                                            }

                                            match completion_action_for_descendant_outcome(poll_outcome) {
                                                CompletionAction::EmitComplete => {
                                                    emit_complete(&app_for_poll, &task_id_for_poll);
                                                    persist_session_completed(&app_for_poll, &task_id_for_poll);
                                                }
                                                CompletionAction::MarkInterrupted => {
                                                    mark_interrupted(&app_for_poll, &task_id_for_poll, poll_outcome);
                                                }
                                            }

                                            poll_flag.store(false, Ordering::SeqCst);
                                        });
                                    } else {
                                        debug!("[SSE] Child-check poll already in progress for task {} — skipping", task_id);
                                    }
                                } else if real_event_type == "session.error" {
                                    info!("[SSE] Session error → emitting implementation-failed for task {}", task_id);
                                    let failure = FailurePayload {
                                        task_id: task_id.clone(),
                                        error: evt.data.clone(),
                                    };
                                    if let Err(e) = app_clone.emit("implementation-failed", &failure) {
                                        warn!("[SSE] Failed to emit implementation-failed: {}", e);
                                    }
                                }

                                let child_poll_active = child_poll_in_progress.load(Ordering::SeqCst);

                                let new_session_status = if real_event_type == "session.idle" {
                                    if should_persist_completed_status(spawned_child_poll, child_poll_active) { Some("completed") } else { None }
                                } else if real_event_type == "session.status" {
                                    match parsed.as_ref()
                                        .and_then(|v| v.get("properties"))
                                        .and_then(|p| p.get("status"))
                                        .and_then(|s| s.get("type"))
                                        .and_then(|t| t.as_str())
                                    {
                                        Some("idle") => if should_persist_completed_status(spawned_child_poll, child_poll_active) { Some("completed") } else { None },
                                        Some("busy") => Some("running"),
                                        Some("retry") => Some("running"),
                                        _ => None,
                                    }
                                } else if real_event_type == "session.error" {
                                    Some("failed")
                                } else {
                                    map_checkpoint_event_to_session_status(real_event_type)
                                };

                                if let Some(new_status) = new_session_status {
                                    let db = app_clone.state::<Arc<std::sync::Mutex<db::Database>>>();
                                    let lock_result = db.lock();
                                    if let Ok(db_lock) = lock_result {
                                        if let Ok(Some(session)) = db_lock.get_latest_session_for_ticket(&task_id) {
                                            let error_msg = if new_status == "failed" {
                                                Some(evt.data.as_str())
                                            } else {
                                                None
                                            };
                                            let checkpoint = if new_status == "paused" {
                                                Some(evt.data.as_str())
                                            } else {
                                                None
                                            };
                                            if let Err(e) = db_lock.update_agent_session(
                                                &session.id, &session.stage, new_status, checkpoint, error_msg
                                            ) {
                                                error!("[SSE] Failed to persist session status '{}' for task {}: {}", new_status, task_id, e);
                                            }
                                        }
                                    }
                                }
                            }
                            es::SSE::Connected(_) => {
                                info!("[SSE] Connected for task {}", task_id);
                            }
                            es::SSE::Comment(_) => {}
                        }
                        Ok(())
                    }
                }) => {
                    match result {
                        Ok(_) => info!("[SSE] Stream ended for task {}", task_id_clone),
                        Err(e) => error!("[SSE] Stream error for task {}: {}", task_id_clone, e),
                    }
                }
                _ = &mut cancel_rx => {
                    info!("[SSE] Cancelled for task {}", task_id_clone);
                }
            }

            let mut bridges = bridges_clone.lock().await;
            bridges.remove(&task_id_clone);
        });

        let handle = BridgeHandle { cancel_tx };
        let mut bridges = self.bridges.lock().await;
        bridges.insert(task_id, handle);

        Ok(())
    }

    /// Stop SSE bridge for a specific task
    ///
    /// # Arguments
    /// * `task_id` - Task identifier to stop
    pub async fn stop_bridge(&self, task_id: &str) {
        let mut bridges = self.bridges.lock().await;
        if let Some(handle) = bridges.remove(task_id) {
            let _ = handle.cancel_tx.send(());
            info!("[SSE] Stopped bridge for task {}", task_id);
        }
    }

    /// Stop all active SSE bridges
    pub async fn stop_all(&self) {
        let mut bridges = self.bridges.lock().await;
        for (task_id, handle) in bridges.drain() {
            let _ = handle.cancel_tx.send(());
            info!("[SSE] Stopped bridge for task {}", task_id);
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::opencode_client::SessionStatusInfo;
    use std::collections::HashSet;

    fn make_session(id: &str, parent_id: Option<&str>) -> crate::opencode_client::SessionInfo {
        crate::opencode_client::SessionInfo {
            id: id.to_string(),
            title: id.to_string(),
            parent_id: parent_id.map(str::to_string),
            extra: serde_json::Map::new(),
        }
    }

    #[test]
    fn test_extract_session_id_from_event() {
        let json = r#"{"type": "session.idle", "properties": {"sessionID": "ses_abc123"}}"#;
        let parsed: serde_json::Value = serde_json::from_str(json).unwrap();
        let session_id = parsed
            .get("properties")
            .and_then(|p| p.get("sessionID"))
            .and_then(|s| s.as_str());
        assert_eq!(session_id, Some("ses_abc123"));
    }

    #[test]
    fn test_extract_event_type_from_json() {
        let json = r#"{"type": "session.status", "properties": {"sessionID": "ses_1", "status": {"type": "idle"}}}"#;
        let parsed: serde_json::Value = serde_json::from_str(json).unwrap();
        let event_type = parsed.get("type").and_then(|t| t.as_str());
        assert_eq!(event_type, Some("session.status"));
    }

    #[test]
    fn test_session_id_filter_matching() {
        let our_session_id = Some("ses_parent".to_string());
        let event_session_id = Some("ses_parent".to_string());

        let should_skip = match (&our_session_id, &event_session_id) {
            (Some(our), Some(event)) => our != event,
            _ => false,
        };
        assert!(!should_skip);
    }

    #[test]
    fn test_session_id_filter_non_matching() {
        let our_session_id = Some("ses_parent".to_string());
        let event_session_id = Some("ses_child".to_string());

        let should_skip = match (&our_session_id, &event_session_id) {
            (Some(our), Some(event)) => our != event,
            _ => false,
        };
        assert!(should_skip);
    }

    #[test]
    fn test_session_id_filter_none_fallthrough() {
        let our_session_id: Option<String> = None;
        let event_session_id = Some("ses_child".to_string());

        let should_skip = match (&our_session_id, &event_session_id) {
            (Some(our), Some(event)) => our != event,
            _ => false,
        };
        assert!(!should_skip);
    }

    #[test]
    fn test_collect_descendant_ids_includes_grandchildren() {
        let mut children_by_parent = HashMap::new();
        children_by_parent.insert(
            "ses_root".to_string(),
            vec![make_session("ses_child", Some("ses_root"))],
        );
        children_by_parent.insert(
            "ses_child".to_string(),
            vec![make_session("ses_grandchild", Some("ses_child"))],
        );

        let descendants = collect_descendant_ids("ses_root", &children_by_parent);

        assert_eq!(
            descendants,
            HashSet::from(["ses_child".to_string(), "ses_grandchild".to_string(),])
        );
    }

    #[test]
    fn test_has_active_descendants_detects_grandchildren() {
        let descendants = HashSet::from(["ses_child".to_string(), "ses_grandchild".to_string()]);
        let statuses = HashMap::from([(
            "ses_grandchild".to_string(),
            SessionStatusInfo {
                status_type: "busy".to_string(),
            },
        )]);

        assert!(has_active_descendants(&descendants, &statuses));
    }

    #[test]
    fn test_child_lookup_failure_marks_session_interrupted() {
        assert_eq!(
            completion_action_for_descendant_outcome(DescendantPollOutcome::LookupFailed),
            CompletionAction::MarkInterrupted,
        );
    }

    #[test]
    fn test_polling_timeout_marks_session_interrupted() {
        assert_eq!(
            completion_action_for_descendant_outcome(DescendantPollOutcome::TimedOut),
            CompletionAction::MarkInterrupted,
        );
    }

    #[test]
    fn test_missing_root_session_id_marks_session_interrupted() {
        assert_eq!(
            completion_action_for_descendant_outcome(DescendantPollOutcome::MissingRootSessionId),
            CompletionAction::MarkInterrupted,
        );
    }

    #[test]
    fn test_should_not_persist_completed_status_while_child_poll_is_running() {
        assert!(!should_persist_completed_status(false, true));
        assert!(!should_persist_completed_status(true, false));
        assert!(should_persist_completed_status(false, false));
    }

    #[test]
    fn test_descendant_snapshot_empty_is_only_idle_candidate() {
        let descendants = HashSet::new();
        let statuses = HashMap::new();

        assert!(descendant_snapshot_is_idle_candidate(
            &descendants,
            &statuses
        ));
    }

    #[test]
    fn test_descendant_snapshot_with_missing_statuses_is_idle_candidate() {
        let descendants = HashSet::from(["ses_child".to_string()]);
        let statuses = HashMap::new();

        assert!(descendant_snapshot_is_idle_candidate(
            &descendants,
            &statuses
        ));
    }

    #[test]
    fn test_completion_snapshot_rejects_busy_root_even_when_descendants_are_idle() {
        let descendants = HashSet::from(["ses_child".to_string()]);
        let statuses = HashMap::from([(
            "ses_root".to_string(),
            SessionStatusInfo {
                status_type: "busy".to_string(),
            },
        )]);

        assert!(!completion_snapshot_is_idle_candidate(
            "ses_root",
            &descendants,
            &statuses
        ));
    }

    #[test]
    fn test_completion_snapshot_accepts_missing_root_when_descendants_are_idle() {
        let descendants = HashSet::from(["ses_child".to_string()]);
        let statuses = HashMap::new();

        assert!(completion_snapshot_is_idle_candidate(
            "ses_root",
            &descendants,
            &statuses
        ));
    }

    #[test]
    fn test_detect_idle_from_session_status_event() {
        let json = r#"{"type": "session.status", "properties": {"sessionID": "ses_1", "status": {"type": "idle"}}}"#;
        let parsed: serde_json::Value = serde_json::from_str(json).unwrap();
        let status_type = parsed
            .get("properties")
            .and_then(|p| p.get("status"))
            .and_then(|s| s.get("type"))
            .and_then(|t| t.as_str());
        assert_eq!(status_type, Some("idle"));
    }

    #[test]
    fn test_input_requested_event_types_include_current_opencode_names() {
        assert!(is_status_event_type("permission.asked"));
        assert!(is_status_event_type("question.asked"));
        assert_eq!(
            map_checkpoint_event_to_session_status("permission.asked"),
            Some("paused")
        );
        assert_eq!(
            map_checkpoint_event_to_session_status("question.asked"),
            Some("paused")
        );
    }

    #[test]
    fn test_input_resolved_event_types_include_current_opencode_names() {
        assert!(is_status_event_type("permission.replied"));
        assert!(is_status_event_type("question.replied"));
        assert!(is_status_event_type("question.rejected"));
        assert_eq!(
            map_checkpoint_event_to_session_status("permission.replied"),
            Some("running")
        );
        assert_eq!(
            map_checkpoint_event_to_session_status("question.replied"),
            Some("running")
        );
        assert_eq!(
            map_checkpoint_event_to_session_status("question.rejected"),
            Some("running")
        );
    }

    #[test]
    fn test_child_busy_detection() {
        let mut statuses: HashMap<String, SessionStatusInfo> = HashMap::new();
        statuses.insert(
            "ses_child1".to_string(),
            SessionStatusInfo {
                status_type: "busy".to_string(),
            },
        );

        let child_ids = ["ses_child1".to_string(), "ses_child2".to_string()];
        let any_busy = child_ids.iter().any(|id| statuses.contains_key(id));
        assert!(any_busy);

        statuses.remove("ses_child1");
        let any_busy = child_ids.iter().any(|id| statuses.contains_key(id));
        assert!(!any_busy);
    }
}
