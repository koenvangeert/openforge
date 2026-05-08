use crate::app_events::{publish_app_event_to_runtime, AppEventSender};
use log::{info, warn};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use super::session::{LastOutputTimes, PtyOutputBuffers, PtySessions};

pub(super) async fn finalize_pty_exit(
    sessions: &PtySessions,
    last_output: &LastOutputTimes,
    output_buffers: &PtyOutputBuffers,
    pid_file: &Path,
    session_key: &str,
    instance_id: u64,
    preserve_output_buffer: bool,
) -> bool {
    let removed_session = {
        let mut sessions = sessions.lock().await;
        let matches_instance = sessions
            .get(session_key)
            .map(|session| session.instance_id == instance_id)
            .unwrap_or(false);
        if matches_instance {
            sessions.remove(session_key)
        } else {
            None
        }
    };

    let Some(mut session) = removed_session else {
        return false;
    };

    if !preserve_output_buffer {
        let mut buffers = output_buffers.lock().await;
        buffers.remove(session_key);
    }

    {
        let mut times = last_output.lock().await;
        times.remove(session_key);
    }

    let _ = std::fs::remove_file(pid_file);

    tokio::task::spawn_blocking(move || {
        session
            .child
            .wait()
            .map(|status| status.success())
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

// ============================================================================
// Ring Buffer
// ============================================================================

pub(super) const CLAUDE_BUFFER_CAPACITY: usize = 262_144; // 256KB

pub(super) struct RingBuffer {
    data: Vec<u8>,
    capacity: usize,
}

impl RingBuffer {
    pub(super) fn new(capacity: usize) -> Self {
        Self {
            data: Vec::with_capacity(capacity),
            capacity,
        }
    }

    pub(super) fn push(&mut self, bytes: &[u8]) {
        self.data.extend_from_slice(bytes);
        if self.data.len() > self.capacity {
            let excess = self.data.len() - self.capacity;
            self.data.drain(0..excess);
        }
    }

    pub(super) fn snapshot(&self) -> String {
        String::from_utf8_lossy(&self.data).to_string()
    }
}

pub(super) type SharedRingBuffer = Arc<std::sync::Mutex<RingBuffer>>;

// ============================================================================
// PTY Output Reader and Event Batching
// ============================================================================

const PTY_READ_BUFFER_SIZE: usize = 8192;
const PTY_FLUSH_INTERVAL_MS: u64 = 16;
const PTY_MAX_BATCH_SIZE: usize = 65_536;

type PtyOutputMessage = Option<String>;
type PtyOutputSender = tokio::sync::mpsc::UnboundedSender<PtyOutputMessage>;
pub(super) type PtyOutputReceiver = tokio::sync::mpsc::UnboundedReceiver<PtyOutputMessage>;
type PtyEmitResult = Result<(), String>;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(super) fn read_pty_output_loop<R: Read + ?Sized>(
    reader: &mut R,
    tx: PtyOutputSender,
    session_key: &str,
    last_output: Option<Arc<AtomicU64>>,
) {
    let mut buffer = [0u8; PTY_READ_BUFFER_SIZE];
    let mut incomplete_utf8: Vec<u8> = Vec::new();

    loop {
        match reader.read(&mut buffer) {
            Ok(0) => {
                info!("[PTY] key={} closed (EOF)", session_key);
                let _ = tx.send(None);
                break;
            }
            Ok(n) => {
                if let Some(last_output) = &last_output {
                    last_output.store(now_ms(), Ordering::Relaxed);
                }

                let mut data = if incomplete_utf8.is_empty() {
                    buffer[..n].to_vec()
                } else {
                    let mut combined = std::mem::take(&mut incomplete_utf8);
                    combined.extend_from_slice(&buffer[..n]);
                    combined
                };

                let valid_up_to = find_utf8_boundary(&data);
                if valid_up_to < data.len() {
                    incomplete_utf8 = data[valid_up_to..].to_vec();
                    data.truncate(valid_up_to);
                }

                if !data.is_empty() {
                    let text = String::from_utf8_lossy(&data).to_string();
                    if tx.send(Some(text)).is_err() {
                        info!("[PTY] key={} channel closed, reader exiting", session_key);
                        break;
                    }
                }
            }
            Err(e) => {
                info!("[PTY] key={} read error: {}", session_key, e);
                let _ = tx.send(None);
                break;
            }
        }
    }
}

pub(super) fn spawn_pty_output_reader(
    mut reader: Box<dyn Read + Send>,
    session_key: String,
    last_output: Option<Arc<AtomicU64>>,
) -> PtyOutputReceiver {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    tokio::task::spawn_blocking(move || {
        read_pty_output_loop(&mut reader, tx, &session_key, last_output);
    });
    rx
}

pub(super) struct PtyOutputBatcher {
    session_key: String,
    instance_id: u64,
    ring_buffer: Arc<std::sync::Mutex<RingBuffer>>,
    pending: String,
    max_buffer_size: usize,
}

impl PtyOutputBatcher {
    pub(super) fn new(
        session_key: String,
        instance_id: u64,
        ring_buffer: Arc<std::sync::Mutex<RingBuffer>>,
        max_buffer_size: usize,
    ) -> Self {
        Self {
            session_key,
            instance_id,
            ring_buffer,
            pending: String::new(),
            max_buffer_size,
        }
    }

    pub(super) fn push_output<E>(&mut self, text: &str, emit: &mut E) -> bool
    where
        E: FnMut(&str, &serde_json::Value) -> PtyEmitResult,
    {
        self.pending.push_str(text);
        if self.pending.len() >= self.max_buffer_size {
            self.flush_pending(emit)
        } else {
            false
        }
    }

    pub(super) fn flush_pending<E>(&mut self, emit: &mut E) -> bool
    where
        E: FnMut(&str, &serde_json::Value) -> PtyEmitResult,
    {
        if self.pending.is_empty() {
            return false;
        }

        let data = std::mem::take(&mut self.pending);
        if let Ok(mut buf) = self.ring_buffer.lock() {
            buf.push(data.as_bytes());
        }

        let event_name = format!("pty-output-{}", self.session_key);
        let payload = serde_json::json!({
            "task_id": &self.session_key,
            "data": &data,
            "instance_id": self.instance_id,
        });
        if let Err(e) = emit(&event_name, &payload) {
            warn!("[PTY] Failed to emit {}: {}", event_name, e);
        }
        true
    }
}

pub(super) enum PtyExitAction {
    Cleanup {
        sessions: PtySessions,
        last_output: LastOutputTimes,
        output_buffers: PtyOutputBuffers,
        pid_file: PathBuf,
        emit_agent_exit: bool,
        preserve_output_buffer: bool,
    },
}

pub(super) struct PtyEventEmitterConfig {
    pub(super) session_key: String,
    pub(super) instance_id: u64,
    pub(super) app_handle: Option<crate::backend_runtime::AppHandle>,
    pub(super) app_event_tx: Option<AppEventSender>,
    pub(super) ring_buffer: Arc<std::sync::Mutex<RingBuffer>>,
    pub(super) exit_action: PtyExitAction,
}

pub(super) fn spawn_batched_pty_event_emitter(
    mut rx: PtyOutputReceiver,
    config: PtyEventEmitterConfig,
) {
    tokio::spawn(async move {
        let PtyEventEmitterConfig {
            session_key,
            instance_id,
            app_handle,
            app_event_tx,
            ring_buffer,
            exit_action,
        } = config;
        let mut batcher = PtyOutputBatcher::new(
            session_key.clone(),
            instance_id,
            ring_buffer,
            PTY_MAX_BATCH_SIZE,
        );
        let mut interval =
            tokio::time::interval(tokio::time::Duration::from_millis(PTY_FLUSH_INTERVAL_MS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        let mut emit_pty_event = |event_name: &str, payload: &serde_json::Value| {
            publish_app_event_to_runtime(app_handle.as_ref(), &app_event_tx, event_name, payload);
            Ok(())
        };

        loop {
            tokio::select! {
                msg = rx.recv() => {
                    match msg {
                        Some(Some(text)) => {
                            batcher.push_output(&text, &mut emit_pty_event);
                        }
                        Some(None) | None => {
                            batcher.flush_pending(&mut emit_pty_event);

                            let agent_success = match exit_action {
                                PtyExitAction::Cleanup {
                                    sessions,
                                    last_output,
                                    output_buffers,
                                    pid_file,
                                    emit_agent_exit,
                                    preserve_output_buffer,
                                } => {
                                    let success = finalize_pty_exit(
                                        &sessions,
                                        &last_output,
                                        &output_buffers,
                                        &pid_file,
                                        &session_key,
                                        instance_id,
                                        preserve_output_buffer,
                                    ).await;
                                    emit_agent_exit.then_some(success)
                                }
                            };

                            info!("[PTY] key={} emitter received exit signal", session_key);
                            let exit_event_name = format!("pty-exit-{}", session_key);
                            let exit_payload = serde_json::json!({"instance_id": instance_id});
                            publish_app_event_to_runtime(app_handle.as_ref(), &app_event_tx, &exit_event_name, &exit_payload);
                            if let Some(success) = agent_success {
                                let payload = serde_json::json!({"task_id": &session_key, "success": success});
                                publish_app_event_to_runtime(app_handle.as_ref(), &app_event_tx, "agent-pty-exited", &payload);
                            }
                            break;
                        }
                    }
                }
                _ = interval.tick() => {
                    batcher.flush_pending(&mut emit_pty_event);
                }
            }
        }
    });
}

// ============================================================================
// UTF-8 Boundary Detection
// ============================================================================

/// Finds the last valid UTF-8 boundary in a byte slice.
/// Returns the index up to which bytes are valid UTF-8.
/// If the buffer ends with an incomplete multi-byte sequence, returns the index before it.
pub(super) fn find_utf8_boundary(bytes: &[u8]) -> usize {
    let len = bytes.len();

    // Fast path: check if entire buffer is valid UTF-8
    if std::str::from_utf8(bytes).is_ok() {
        return len;
    }

    // Scan from the end to find incomplete multi-byte sequence
    // UTF-8 continuation bytes start with 0b10xxxxxx
    // Multi-byte sequences start with 0b11xxxxxx
    for i in (0..len).rev().take(4) {
        let byte = bytes[i];

        // Check if this is the start of a multi-byte sequence
        if byte & 0b1100_0000 == 0b1100_0000 {
            // This is a start byte, check if the sequence is complete
            let expected_len = if byte & 0b1110_0000 == 0b1100_0000 {
                2 // 110xxxxx
            } else if byte & 0b1111_0000 == 0b1110_0000 {
                3 // 1110xxxx
            } else if byte & 0b1111_1000 == 0b1111_0000 {
                4 // 11110xxx
            } else {
                continue;
            };

            let actual_len = len - i;
            if actual_len < expected_len {
                // Incomplete sequence, return index before it
                return i;
            }
        }
    }

    // Fallback: use std::str::from_utf8 to find valid boundary
    std::str::from_utf8(bytes)
        .err()
        .map(|e| e.valid_up_to())
        .unwrap_or(len)
}
