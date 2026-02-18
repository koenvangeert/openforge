use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use crate::db;
use eventsource_client::{self as es, Client};
use futures::TryStreamExt;

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
        let bridges_clone = self.bridges.clone();

        tokio::spawn(async move {
            println!("[SSE] Starting bridge for task {} on port {}", task_id_clone, server_port);

            let stream = client.stream();

            tokio::select! {
                result = stream.try_for_each(|event| {
                    let app_clone = app.clone();
                    let task_id = task_id_clone.clone();

                    async move {
                        match event {
                            es::SSE::Event(evt) => {
                                // Parse JSON payload to extract the real event type and session ID.
                                // OpenCode does NOT set the SSE `event:` header — the event type
                                // lives inside the JSON payload's `type` field.
                                let parsed = serde_json::from_str::<serde_json::Value>(&evt.data).ok();

                                let real_event_type = parsed.as_ref()
                                    .and_then(|v| v.get("type"))
                                    .and_then(|t| t.as_str())
                                    .unwrap_or(&evt.event_type);

                                // Skip text-streaming events — PTY handles display now
                                match real_event_type {
                                    "message.part.delta" | "message.part.updated" |
                                    "message.updated" | "message.removed" |
                                    "server.heartbeat" | "server.connected" => {
                                        return Ok(());
                                    }
                                    _ => {}
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

                                if real_event_type == "session.idle" || real_event_type == "session.status" && parsed.as_ref()
                                    .and_then(|v| v.get("properties"))
                                    .and_then(|p| p.get("status"))
                                    .and_then(|s| s.get("type"))
                                    .and_then(|t| t.as_str()) == Some("idle") {
                                    println!("[SSE] Session idle → emitting action-complete for task {}", task_id);

                                    let completion = CompletionPayload {
                                        task_id: task_id.clone(),
                                    };
                                    if let Err(e) = app_clone.emit("action-complete", &completion) {
                                        eprintln!("[SSE] Failed to emit action-complete: {}", e);
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
