use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use crate::db;
use crate::opencode_client::OpenCodeClient;
use eventsource_client::{self as es, Client};
use futures::TryStreamExt;

// ============================================================================
// Constants
// ============================================================================

/// Polling interval for checking child session status (seconds)
const CHILD_CHECK_INTERVAL_SECS: u64 = 5;
/// Maximum time to wait for child sessions to complete (seconds)
const CHILD_CHECK_TIMEOUT_SECS: u64 = 600; // 10 minutes

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
            if let Err(e) = db_lock.update_agent_session(&session.id, &session.stage, "completed", None, None) {
                eprintln!("[SSE] Failed to persist completed status for task {}: {}", task_id, e);
            }
        }
    };
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
            .map_err(|e| SseBridgeError::ConnectionFailed(format!("Failed to build client: {}", e)))?
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
            println!("[SSE] Starting bridge for task {} on port {}", task_id_clone, server_port);

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
                                            println!("[SSE][{}] message.part.delta field={} delta_preview={}", task_id, field, delta_preview);
                                        } else {
                                            println!("[SSE][{}] message.part.delta (unparsed): {}", task_id, &evt.data[..std::cmp::min(200, evt.data.len())]);
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
                                    println!("[SSE][{}] Emitting event: {} data_len={}", task_id, real_event_type, evt.data.len());
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
                                    eprintln!("[SSE] Failed to emit agent-event: {}", e);
                                }

                                // Layer 1: SessionID filtering — only react to status-changing events
                                // from OUR session. Child/unrelated session events are still forwarded
                                // to the frontend above, but completion/error/pause logic is skipped.
                                let event_session_id = parsed.as_ref()
                                    .and_then(|v| v.get("properties"))
                                    .and_then(|p| p.get("sessionID"))
                                    .and_then(|s| s.as_str())
                                    .map(|s| s.to_string());

                                let is_status_event = matches!(real_event_type,
                                    "session.idle" | "session.status" | "session.error" |
                                    "permission.updated" | "permission.replied" |
                                    "question.asked" | "question.answered"
                                );

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
                                    println!("[SSE] Session idle for task {} — checking for active children", task_id);

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
                                                    eprintln!("[SSE] Failed to emit action-complete: {}", e);
                                                }
                                            };

                                            let our_session_id = match our_session_id_opt {
                                                Some(ref id) => id.clone(),
                                                None => {
                                                    println!("[SSE] No session ID — emitting action-complete for task {}", task_id_for_poll);
                                                    emit_complete(&app_for_poll, &task_id_for_poll);
                                                    persist_session_completed(&app_for_poll, &task_id_for_poll);
                                                    poll_flag.store(false, Ordering::SeqCst);
                                                    return;
                                                }
                                            };

                                            let oc_client = OpenCodeClient::with_base_url(
                                                format!("http://127.0.0.1:{}", server_port)
                                            );

                                            let children = match oc_client.get_session_children(&our_session_id).await {
                                                Ok(c) => c,
                                                Err(e) => {
                                                    eprintln!("[SSE] get_session_children failed for task {}: {} — completing immediately", task_id_for_poll, e);
                                                    emit_complete(&app_for_poll, &task_id_for_poll);
                                                    persist_session_completed(&app_for_poll, &task_id_for_poll);
                                                    poll_flag.store(false, Ordering::SeqCst);
                                                    return;
                                                }
                                            };

                                            if children.is_empty() {
                                                println!("[SSE] No children — emitting action-complete for task {}", task_id_for_poll);
                                                emit_complete(&app_for_poll, &task_id_for_poll);
                                                persist_session_completed(&app_for_poll, &task_id_for_poll);
                                                poll_flag.store(false, Ordering::SeqCst);
                                                return;
                                            }

                                            let child_ids: Vec<String> = children.iter().map(|c| c.id.clone()).collect();
                                            println!("[SSE] {} child session(s) found for task {} — polling until idle", child_ids.len(), task_id_for_poll);

                                            let max_iterations = CHILD_CHECK_TIMEOUT_SECS / CHILD_CHECK_INTERVAL_SECS;
                                            for iteration in 0..max_iterations {
                                                let statuses = match oc_client.get_all_session_statuses().await {
                                                    Ok(s) => s,
                                                    Err(e) => {
                                                        eprintln!("[SSE] get_all_session_statuses failed (task {}, iter {}): {} — completing", task_id_for_poll, iteration, e);
                                                        emit_complete(&app_for_poll, &task_id_for_poll);
                                                        persist_session_completed(&app_for_poll, &task_id_for_poll);
                                                        poll_flag.store(false, Ordering::SeqCst);
                                                        return;
                                                    }
                                                };

                                                let any_busy = child_ids.iter().any(|id| statuses.contains_key(id));
                                                if !any_busy {
                                                    println!("[SSE] All children idle — emitting action-complete for task {}", task_id_for_poll);
                                                    emit_complete(&app_for_poll, &task_id_for_poll);
                                                    persist_session_completed(&app_for_poll, &task_id_for_poll);
                                                    poll_flag.store(false, Ordering::SeqCst);
                                                    return;
                                                }

                                                println!("[SSE] Children still busy (iter {}/{}) for task {} — waiting {}s", iteration + 1, max_iterations, task_id_for_poll, CHILD_CHECK_INTERVAL_SECS);
                                                tokio::time::sleep(tokio::time::Duration::from_secs(CHILD_CHECK_INTERVAL_SECS)).await;
                                            }

                                            eprintln!("[SSE] Child-check timeout ({}s) for task {} — emitting action-complete anyway", CHILD_CHECK_TIMEOUT_SECS, task_id_for_poll);
                                            emit_complete(&app_for_poll, &task_id_for_poll);
                                            persist_session_completed(&app_for_poll, &task_id_for_poll);
                                            poll_flag.store(false, Ordering::SeqCst);
                                        });
                                    } else {
                                        println!("[SSE] Child-check poll already in progress for task {} — skipping", task_id);
                                    }
                                } else if real_event_type == "session.error" {
                                    println!("[SSE] Session error → emitting implementation-failed for task {}", task_id);
                                    let failure = FailurePayload {
                                        task_id: task_id.clone(),
                                        error: evt.data.clone(),
                                    };
                                    if let Err(e) = app_clone.emit("implementation-failed", &failure) {
                                        eprintln!("[SSE] Failed to emit implementation-failed: {}", e);
                                    }
                                }

                                let new_session_status = if real_event_type == "session.idle" {
                                    if spawned_child_poll { None } else { Some("completed") }
                                } else if real_event_type == "session.status" {
                                    match parsed.as_ref()
                                        .and_then(|v| v.get("properties"))
                                        .and_then(|p| p.get("status"))
                                        .and_then(|s| s.get("type"))
                                        .and_then(|t| t.as_str())
                                    {
                                        Some("idle") => if spawned_child_poll { None } else { Some("completed") },
                                        Some("busy") => Some("running"),
                                        Some("retry") => Some("running"),
                                        _ => None,
                                    }
                                } else if real_event_type == "session.error" {
                                    Some("failed")
                                } else if real_event_type == "permission.updated" || real_event_type == "question.asked" {
                                    Some("paused")
                                } else if real_event_type == "permission.replied" || real_event_type == "question.answered" {
                                    Some("running")
                                } else {
                                    None
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
                                                eprintln!("[SSE] Failed to persist session status '{}' for task {}: {}", new_status, task_id, e);
                                            }
                                        }
                                    }
                                }
                            }
                            es::SSE::Connected(_) => {
                                println!("[SSE] Connected for task {}", task_id);
                            }
                            es::SSE::Comment(_) => {}
                        }
                        Ok(())
                    }
                }) => {
                    match result {
                        Ok(_) => println!("[SSE] Stream ended for task {}", task_id_clone),
                        Err(e) => eprintln!("[SSE] Stream error for task {}: {}", task_id_clone, e),
                    }
                }
                _ = &mut cancel_rx => {
                    println!("[SSE] Cancelled for task {}", task_id_clone);
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
            println!("[SSE] Stopped bridge for task {}", task_id);
        }
    }

    /// Stop all active SSE bridges
    pub async fn stop_all(&self) {
        let mut bridges = self.bridges.lock().await;
        for (task_id, handle) in bridges.drain() {
            let _ = handle.cancel_tx.send(());
            println!("[SSE] Stopped bridge for task {}", task_id);
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

    #[test]
    fn test_extract_session_id_from_event() {
        let json = r#"{"type": "session.idle", "properties": {"sessionID": "ses_abc123"}}"#;
        let parsed: serde_json::Value = serde_json::from_str(json).unwrap();
        let session_id = parsed.get("properties")
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
    fn test_detect_idle_from_session_status_event() {
        let json = r#"{"type": "session.status", "properties": {"sessionID": "ses_1", "status": {"type": "idle"}}}"#;
        let parsed: serde_json::Value = serde_json::from_str(json).unwrap();
        let status_type = parsed.get("properties")
            .and_then(|p| p.get("status"))
            .and_then(|s| s.get("type"))
            .and_then(|t| t.as_str());
        assert_eq!(status_type, Some("idle"));
    }

    #[test]
    fn test_child_busy_detection() {
        let mut statuses: HashMap<String, SessionStatusInfo> = HashMap::new();
        statuses.insert("ses_child1".to_string(), SessionStatusInfo { status_type: "busy".to_string() });

        let child_ids = vec!["ses_child1".to_string(), "ses_child2".to_string()];
        let any_busy = child_ids.iter().any(|id| statuses.contains_key(id));
        assert!(any_busy);

        statuses.remove("ses_child1");
        let any_busy = child_ids.iter().any(|id| statuses.contains_key(id));
        assert!(!any_busy);
    }
}
