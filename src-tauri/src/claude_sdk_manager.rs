use std::collections::HashMap;
use std::fmt;
use std::io;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use crate::db;
use crate::claude_sdk_protocol::{
    CLIMessage, ControlRequestType, PermissionMode, PermissionResult, ProtocolPeer,
};
use crate::sse_bridge::{AgentEventPayload, CompletionPayload, FailurePayload};

// ============================================================================
// Constants
// ============================================================================

const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

/// Hook callback ID for auto-approved tool calls (file edits in AcceptEdits mode)
const AUTO_APPROVE_CALLBACK_ID: &str = "auto_approve";

/// Hook callback ID for tool calls that need user approval
const TOOL_APPROVAL_CALLBACK_ID: &str = "tool_approval";

// ============================================================================
// Error Types
// ============================================================================

#[derive(Debug)]
pub enum ClaudeSdkError {
    SpawnFailed(String),
    SessionNotFound(String),
    IoError(io::Error),
    ProtocolError(String),
}

impl fmt::Display for ClaudeSdkError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ClaudeSdkError::SpawnFailed(msg) => write!(f, "Failed to spawn Claude CLI: {}", msg),
            ClaudeSdkError::SessionNotFound(task_id) => {
                write!(f, "No Claude session found for task: {}", task_id)
            }
            ClaudeSdkError::IoError(e) => write!(f, "IO error: {}", e),
            ClaudeSdkError::ProtocolError(msg) => write!(f, "Protocol error: {}", msg),
        }
    }
}

impl std::error::Error for ClaudeSdkError {}

impl From<io::Error> for ClaudeSdkError {
    fn from(err: io::Error) -> Self {
        ClaudeSdkError::IoError(err)
    }
}

// ============================================================================
// Session Options
// ============================================================================

/// Options for starting a new Claude CLI session
#[derive(Debug, Clone)]
pub struct SessionOptions {
    /// Permission mode controlling tool approval behavior
    pub permission_mode: PermissionMode,
    /// Model to use (None = use default)
    pub model: Option<String>,
    /// Session ID to resume (None = new session)
    pub resume_session_id: Option<String>,
}

impl Default for SessionOptions {
    fn default() -> Self {
        Self {
            permission_mode: PermissionMode::AcceptEdits,
            model: None,
            resume_session_id: None,
        }
    }
}

// ============================================================================
// Tool Approval Event Payload
// ============================================================================

/// Payload emitted to frontend for tool approval requests
#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolApprovalEventPayload {
    pub task_id: String,
    pub request_id: String,
    pub session_id: String,
    pub tool_use_id: String,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub description: Option<String>,
}

// ============================================================================
// CLI Argument Builder (Pure Function)
// ============================================================================

/// Build command-line arguments for spawning the Claude CLI process.
///
/// The base flags are always present:
///   `-p --verbose --output-format=stream-json --input-format=stream-json
///    --include-partial-messages --replay-user-messages --permission-prompt-tool=stdio`
///
/// Optional flags are added based on `SessionOptions`:
///   `--permission-mode=<mode>` (unless Default)
///   `--model <model>` (if specified)
///   `--resume <session_id>` (if resuming)
pub fn build_cli_args(options: &SessionOptions) -> Vec<String> {
    let mut args = vec![
        "-p".to_string(),
        "--verbose".to_string(),
        "--output-format=stream-json".to_string(),
        "--input-format=stream-json".to_string(),
        "--include-partial-messages".to_string(),
        "--replay-user-messages".to_string(),
        "--permission-prompt-tool=stdio".to_string(),
    ];

    args.push(format!("--permission-mode={}", options.permission_mode));

    if let Some(ref model) = options.model {
        args.push("--model".to_string());
        args.push(model.clone());
    }

    if let Some(ref session_id) = options.resume_session_id {
        args.push("--resume".to_string());
        args.push(session_id.clone());
    }

    args
}

// ============================================================================
// Hook Configuration Builder (Pure Function)
// ============================================================================

/// Build the hooks JSON configuration for the Initialize control request.
///
/// Creates `pre_tool_use` hooks that route tool calls through our approval system:
/// - In `AcceptEdits` mode: file-editing tools get auto-approved, everything else asks
/// - In `Default` mode: all tool calls ask for approval
/// - In `BypassPermissions` mode: all tool calls get auto-approved
/// - In `Plan` mode: no hooks (plan mode doesn't execute tools)
///
/// Returns `None` if no hooks are needed.
pub fn build_hooks(mode: PermissionMode) -> Option<serde_json::Value> {
    match mode {
        PermissionMode::Plan => None,
        PermissionMode::BypassPermissions => {
            Some(serde_json::json!({
                "pre_tool_use": [
                    {
                        "callback_id": AUTO_APPROVE_CALLBACK_ID,
                        "tool_name": ".*",
                        "tool_input": {}
                    }
                ]
            }))
        }
        PermissionMode::AcceptEdits => {
            Some(serde_json::json!({
                "pre_tool_use": [
                    {
                        "callback_id": AUTO_APPROVE_CALLBACK_ID,
                        "tool_name": "^(Write|Edit|MultiEdit|NotebookEdit)$",
                        "tool_input": {}
                    },
                    {
                        "callback_id": TOOL_APPROVAL_CALLBACK_ID,
                        "tool_name": ".*",
                        "tool_input": {}
                    }
                ]
            }))
        }
        PermissionMode::Default => {
            Some(serde_json::json!({
                "pre_tool_use": [
                    {
                        "callback_id": TOOL_APPROVAL_CALLBACK_ID,
                        "tool_name": ".*",
                        "tool_input": {}
                    }
                ]
            }))
        }
    }
}

// ============================================================================
// Hook Callback Response Builder (Pure Function)
// ============================================================================

/// Determine the response for a hook callback based on the callback ID.
///
/// - `AUTO_APPROVE_CALLBACK_ID` → immediately allow the tool call
/// - `TOOL_APPROVAL_CALLBACK_ID` → returns None (needs user approval via frontend)
/// - Unknown callback IDs → immediately allow (safe default)
///
/// Returns `Some(json)` if the response can be sent immediately, `None` if user
/// interaction is needed.
pub fn build_hook_response(callback_id: &str) -> Option<serde_json::Value> {
    match callback_id {
        TOOL_APPROVAL_CALLBACK_ID => None,
        AUTO_APPROVE_CALLBACK_ID | _ => {
            Some(serde_json::json!({
                "hookSpecificOutput": {
                    "permissionDecision": "allow"
                }
            }))
        }
    }
}

// ============================================================================
// CLI Message → Event Translation (Pure Functions)
// ============================================================================

/// Describes the action to take for a given CLI message.
///
/// This enum separates the "what to do" decision from the "do it" side-effects,
/// making the routing logic testable without Tauri's event system.
#[derive(Debug, PartialEq)]
pub enum MessageAction {
    /// Emit an `agent-event` Tauri event
    EmitAgentEvent {
        event_type: String,
        data: String,
        /// Whether to persist this event to the `agent_logs` table for replay on remount
        persist: bool,
    },
    /// A tool needs user approval — emit `claude-tool-approval` and register a pending approval
    RequestToolApproval {
        request_id: String,
        tool_name: String,
        tool_input: serde_json::Value,
        tool_use_id: Option<String>,
    },
    /// A hook callback that can be auto-approved
    AutoApproveHook {
        request_id: String,
    },
    /// Session completed successfully — emit `action-complete`, persist status
    SessionCompleted {
        result: serde_json::Value,
    },
    /// Session failed — emit `implementation-failed`, persist error
    SessionFailed {
        error: String,
    },
    /// Cancel a pending approval request
    CancelApproval {
        request_id: String,
    },
    /// Ignore this message (e.g. heartbeat, unknown type)
    Ignore,
}

/// Translate a raw CLIMessage into the action the manager should take.
///
/// This is a pure function — no side-effects, fully testable.
pub fn classify_message(msg: &CLIMessage) -> MessageAction {
    match msg {
        CLIMessage::ControlRequest { request_id, request } => match request {
            ControlRequestType::CanUseTool {
                tool_name,
                input,
                tool_use_id,
                ..
            } => MessageAction::RequestToolApproval {
                request_id: request_id.clone(),
                tool_name: tool_name.clone(),
                tool_input: input.clone(),
                tool_use_id: tool_use_id.clone(),
            },
            ControlRequestType::HookCallback { callback_id, .. } => {
                if build_hook_response(callback_id).is_some() {
                    MessageAction::AutoApproveHook {
                        request_id: request_id.clone(),
                    }
                } else {
                        MessageAction::RequestToolApproval {
                        request_id: request_id.clone(),
                        tool_name: "unknown".to_string(),
                        tool_input: serde_json::Value::Null,
                        tool_use_id: None,
                    }
                }
            }
        },
        CLIMessage::ControlResponse { .. } => MessageAction::Ignore,
        CLIMessage::ControlCancelRequest { request_id } => MessageAction::CancelApproval {
            request_id: request_id.clone(),
        },
        CLIMessage::Result(value) => {
            let is_error = value.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
            if is_error {
                let error = value
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error")
                    .to_string();
                MessageAction::SessionFailed { error }
            } else {
                MessageAction::SessionCompleted {
                    result: value.clone(),
                }
            }
        }
        CLIMessage::Other(value) => {
            let raw_type = value
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let (event_type, data) = transform_cli_event(raw_type, value);
            let persist = should_persist_event(raw_type, value);
            MessageAction::EmitAgentEvent { event_type, data, persist }
        }
    }
}

pub fn should_persist_event(raw_type: &str, _value: &serde_json::Value) -> bool {
    matches!(raw_type, "system" | "assistant" | "tool_use" | "tool_result")
}

/// Transform a raw CLI NDJSON message into the `(event_type, data_json)` pair
/// that the frontend `useClaudeSession` composable expects.
///
/// The Claude CLI outputs messages in its native wire format (e.g. assistant
/// messages nest text inside `message.content[]`, streaming deltas are wrapped
/// in `stream_event`). This pure function bridges the CLI wire format to the
/// simplified flat schema the frontend expects.
///
/// # Mapping
///
/// | CLI `type`       | Frontend `event_type` | Data shape                           |
/// |------------------|-----------------------|--------------------------------------|
/// | `system`         | `system.init`         | `{ sessionId }`                      |
/// | `assistant`      | `assistant`           | `{ text, toolUses? }`                |
/// | `stream_event`*  | `assistant_delta`     | `{ text }`                           |
/// | `tool_use`       | `tool_use`            | `{ toolUseId, toolName, toolInput }` |
/// | `tool_result`    | `tool_result`         | `{ toolUseId, content, isError }`    |
/// | other            | (passthrough)         | raw JSON                             |
///
/// *Only `content_block_delta` with `text_delta` inside `stream_event` is mapped;
///  other inner event types (message_start, content_block_stop, etc.) are ignored.
pub fn transform_cli_event(raw_type: &str, value: &serde_json::Value) -> (String, String) {
    match raw_type {
        "system" => {
            let session_id = value.get("session_id").and_then(|v| v.as_str());
            let data = serde_json::json!({ "sessionId": session_id });
            (
                "system.init".to_string(),
                serde_json::to_string(&data).unwrap_or_default(),
            )
        }
        "assistant" => {
            let content = value
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array());

            let mut text_parts: Vec<&str> = Vec::new();
            let mut tool_uses: Vec<serde_json::Value> = Vec::new();

            if let Some(blocks) = content {
                for block in blocks {
                    match block.get("type").and_then(|t| t.as_str()) {
                        Some("text") => {
                            if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                                text_parts.push(t);
                            }
                        }
                        Some("tool_use") => {
                            tool_uses.push(serde_json::json!({
                                "id": block.get("id"),
                                "name": block.get("name"),
                                "input": block.get("input"),
                            }));
                        }
                        _ => {}
                    }
                }
            }

            let text = text_parts.join("\n");
            let data = if tool_uses.is_empty() {
                serde_json::json!({ "text": text })
            } else {
                serde_json::json!({ "text": text, "toolUses": tool_uses })
            };
            (
                "assistant".to_string(),
                serde_json::to_string(&data).unwrap_or_default(),
            )
        }
        "stream_event" => {
            let event = value.get("event");
            let inner_type = event
                .and_then(|e| e.get("type"))
                .and_then(|t| t.as_str())
                .unwrap_or("");

            if inner_type == "content_block_delta" {
                let delta_type = event
                    .and_then(|e| e.get("delta"))
                    .and_then(|d| d.get("type"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("");

                if delta_type == "text_delta" {
                    let text = event
                        .and_then(|e| e.get("delta"))
                        .and_then(|d| d.get("text"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("");
                    let data = serde_json::json!({ "text": text });
                    return (
                        "assistant_delta".to_string(),
                        serde_json::to_string(&data).unwrap_or_default(),
                    );
                }
            }

            (String::new(), String::new())
        }
        "tool_use" => {
            let data = serde_json::json!({
                "toolUseId": value.get("id"),
                "toolName": value.get("tool_name").or_else(|| value.get("name")),
                "toolInput": value.get("input"),
            });
            (
                "tool_use".to_string(),
                serde_json::to_string(&data).unwrap_or_default(),
            )
        }
        "tool_result" => {
            let content = value.get("result").or_else(|| value.get("content"));
            let data = serde_json::json!({
                "toolUseId": value.get("tool_use_id"),
                "content": content,
                "isError": value.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false),
            });
            (
                "tool_result".to_string(),
                serde_json::to_string(&data).unwrap_or_default(),
            )
        }
        _ => {
            (
                raw_type.to_string(),
                serde_json::to_string(value).unwrap_or_default(),
            )
        }
    }
}

// ============================================================================
// Managed CLI Process
// ============================================================================

#[allow(dead_code)]
struct ManagedCliProcess {
    child: Child,
    peer: ProtocolPeer,
    task_id: String,
    pid: u32,
    cancel_tx: Option<oneshot::Sender<()>>,
    claude_session_id: Option<String>,
    pending_approvals: HashMap<String, oneshot::Sender<PermissionResult>>,
}

// ============================================================================
// Claude SDK Manager
// ============================================================================

/// Manages multiple concurrent Claude CLI processes (one per active task)
pub struct ClaudeSdkManager {
    sessions: Arc<Mutex<HashMap<String, ManagedCliProcess>>>,
    pid_dir_override: Option<PathBuf>,
}

impl ClaudeSdkManager {
    /// Creates a new ClaudeSdkManager with an empty session map
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            pid_dir_override: None,
        }
    }

    // ============================================================================
    // Public API
    // ============================================================================

    /// Start a new Claude CLI session for the given task.
    ///
    /// Spawns the Claude CLI process with the given prompt and options,
    /// sends initialize + set_permission_mode + user message, and begins
    /// forwarding events to the Tauri frontend.
    ///
    /// # Arguments
    /// * `app` - Tauri application handle for event emission and DB access
    /// * `task_id` - Unique identifier for the task
    /// * `prompt` - Initial prompt to send to the agent
    /// * `cwd` - Working directory for the agent
    /// * `options` - Session configuration options
    pub async fn start_session(
        &self,
        app: AppHandle,
        task_id: &str,
        prompt: &str,
        cwd: &str,
        options: SessionOptions,
    ) -> Result<(), ClaudeSdkError> {
        let pid_dir = self.get_pid_dir()?;
        std::fs::create_dir_all(&pid_dir)?;

        println!(
            "[ClaudeSdkManager] Spawning Claude CLI for task {} in {}",
            task_id, cwd
        );

        let args = build_cli_args(&options);
        println!("[ClaudeSdkManager] CLI args: {:?}", args);
        let mut child = Command::new("claude")
            .args(&args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| ClaudeSdkError::SpawnFailed(e.to_string()))?;

        let pid = child
            .id()
            .ok_or_else(|| ClaudeSdkError::SpawnFailed("Failed to get PID".to_string()))?;

        let raw_stdin = child
            .stdin
            .take()
            .ok_or_else(|| ClaudeSdkError::SpawnFailed("Failed to capture stdin".to_string()))?;

        let raw_stdout = child
            .stdout
            .take()
            .ok_or_else(|| ClaudeSdkError::SpawnFailed("Failed to capture stdout".to_string()))?;

        let raw_stderr = child
            .stderr
            .take()
            .ok_or_else(|| ClaudeSdkError::SpawnFailed("Failed to capture stderr".to_string()))?;

        println!(
            "[ClaudeSdkManager] Claude CLI for task {} started (PID: {})",
            task_id, pid
        );

        let pid_file = pid_dir.join(format!("{}-claude-sdk.pid", task_id));
        std::fs::write(&pid_file, pid.to_string())?;

        let task_id_for_stderr = task_id.to_string();
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let reader = BufReader::new(raw_stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[ClaudeCLI:{}] {}", task_id_for_stderr, line);
            }
        });

        let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
        let (peer, msg_rx) = ProtocolPeer::spawn(raw_stdin, raw_stdout, cancel_rx);

        // NOTE: Do NOT send initialize or set_permission_mode control requests.
        // The Claude CLI (v2.x) hangs when it receives an initialize control_request
        // via --input-format=stream-json. Permission mode and hooks are configured
        // via CLI flags instead (--permission-mode, --permission-prompt-tool=stdio).

        let prompt_owned = prompt.to_string();
        if !prompt_owned.is_empty() {
            println!("[ClaudeSdkManager] Sending user message ({} chars)...", prompt_owned.len());
            peer.send_user_message(prompt_owned)
                .await
                .map_err(|e| ClaudeSdkError::IoError(e))?;
            println!("[ClaudeSdkManager] User message sent OK");
        }

        let task_id_clone = task_id.to_string();
        let sessions_clone = self.sessions.clone();
        let pid_dir_clone = pid_dir.clone();
        let peer_clone = peer.clone();

        tokio::spawn(async move {
            run_message_loop(
                app,
                task_id_clone,
                msg_rx,
                peer_clone,
                sessions_clone,
                pid_dir_clone,
            )
            .await;
        });

        let mut sessions = self.sessions.lock().await;
        sessions.insert(
            task_id.to_string(),
            ManagedCliProcess {
                child,
                peer,
                task_id: task_id.to_string(),
                pid,
                cancel_tx: Some(cancel_tx),
                claude_session_id: options.resume_session_id.clone(),
                pending_approvals: HashMap::new(),
            },
        );

        Ok(())
    }

    /// Resume an existing Claude CLI session.
    ///
    /// Spawns a new Claude CLI process with `--resume <session_id>`.
    ///
    /// # Arguments
    /// * `app` - Tauri application handle for event emission and DB access
    /// * `task_id` - Unique identifier for the task
    /// * `session_id` - The Claude session ID to resume
    /// * `cwd` - Working directory for the agent
    pub async fn resume_session(
        &self,
        app: AppHandle,
        task_id: &str,
        session_id: &str,
        cwd: &str,
    ) -> Result<(), ClaudeSdkError> {
        let options = SessionOptions {
            resume_session_id: Some(session_id.to_string()),
            ..Default::default()
        };

        self.start_session(app, task_id, "", cwd, options).await
    }

    /// Send user input text to the running session.
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    /// * `text` - User input text to send
    pub async fn send_input(&self, task_id: &str, text: &str) -> Result<(), ClaudeSdkError> {
        let sessions = self.sessions.lock().await;
        let process = sessions
            .get(task_id)
            .ok_or_else(|| ClaudeSdkError::SessionNotFound(task_id.to_string()))?;

        process
            .peer
            .send_user_message(text.to_string())
            .await
            .map_err(ClaudeSdkError::IoError)
    }

    /// Interrupt the running session (like pressing Ctrl+C).
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    pub async fn interrupt_session(&self, task_id: &str) -> Result<(), ClaudeSdkError> {
        let sessions = self.sessions.lock().await;
        let process = sessions
            .get(task_id)
            .ok_or_else(|| ClaudeSdkError::SessionNotFound(task_id.to_string()))?;

        process
            .peer
            .interrupt()
            .await
            .map_err(ClaudeSdkError::IoError)
    }

    /// Respond to a tool approval request.
    ///
    /// Resolves the pending oneshot channel for the given request_id with the
    /// user's decision.
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    /// * `request_id` - The request_id from the approval request
    /// * `approved` - Whether the tool call is approved
    /// * `message` - Optional reason for denial
    pub async fn respond_tool_approval(
        &self,
        task_id: &str,
        request_id: &str,
        behavior: &str,
        message: Option<&str>,
    ) -> Result<(), ClaudeSdkError> {
        let mut sessions = self.sessions.lock().await;
        let process = sessions
            .get_mut(task_id)
            .ok_or_else(|| ClaudeSdkError::SessionNotFound(task_id.to_string()))?;

        let result = match behavior {
            "allow" | "allowForSession" => PermissionResult::Allow {
                updated_input: serde_json::Value::Null,
                updated_permissions: None,
            },
            "deny" | _ => PermissionResult::Deny {
                message: message.unwrap_or("Denied by user").to_string(),
                interrupt: None,
            },
        };

        process
            .peer
            .send_permission_response(request_id.to_string(), result)
            .await
            .map_err(ClaudeSdkError::IoError)
    }

    /// Stop the session for the given task.
    ///
    /// Triggers graceful shutdown via the cancel token, waits for exit, then
    /// cleans up. The cancel token causes the ProtocolPeer to send an Interrupt
    /// and drain until a Result message arrives.
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    pub async fn stop_session(&self, task_id: &str) -> Result<(), ClaudeSdkError> {
        let mut process = {
            let mut sessions = self.sessions.lock().await;
            sessions
                .remove(task_id)
                .ok_or_else(|| ClaudeSdkError::SessionNotFound(task_id.to_string()))?
        };

        println!(
            "[ClaudeSdkManager] Stopping session for task {} (PID: {})",
            task_id, process.pid
        );

        if let Some(cancel_tx) = process.cancel_tx.take() {
            let _ = cancel_tx.send(());
        }

        #[cfg(unix)]
        {
            use nix::sys::signal::{kill, Signal};
            use nix::unistd::Pid;

            let pid = Pid::from_raw(process.pid as i32);
            let _ = kill(pid, Signal::SIGTERM);

            let wait_result =
                tokio::time::timeout(SHUTDOWN_TIMEOUT, process.child.wait()).await;
            match wait_result {
                Ok(Ok(status)) => {
                    println!(
                        "[ClaudeSdkManager] Claude CLI for task {} exited gracefully: {:?}",
                        task_id, status
                    );
                }
                _ => {
                    println!(
                        "[ClaudeSdkManager] Graceful shutdown timed out for task {}, forcing kill...",
                        task_id
                    );
                    let _ = process.child.kill().await;
                    let _ = process.child.wait().await;
                }
            }
        }

        #[cfg(not(unix))]
        {
            let _ = process.child.kill().await;
            let _ = process.child.wait().await;
        }

        let pid_file = self
            .get_pid_dir()?
            .join(format!("{}-claude-sdk.pid", task_id));
        let _ = std::fs::remove_file(&pid_file);

        println!("[ClaudeSdkManager] Session for task {} stopped", task_id);

        Ok(())
    }

    /// Stop all active sessions
    pub async fn stop_all(&self) -> Result<(), ClaudeSdkError> {
        let task_ids: Vec<String> = {
            let sessions = self.sessions.lock().await;
            sessions.keys().cloned().collect()
        };

        for task_id in task_ids {
            if let Err(e) = self.stop_session(&task_id).await {
                eprintln!(
                    "[ClaudeSdkManager] Failed to stop session for task {}: {}",
                    task_id, e
                );
            }
        }

        Ok(())
    }

    /// Returns true if a session is currently active for the given task_id
    pub async fn is_running(&self, task_id: &str) -> bool {
        let sessions = self.sessions.lock().await;
        sessions.contains_key(task_id)
    }

    /// Cleans up stale PID files for Claude CLI processes that are no longer running
    pub fn cleanup_stale_pids(&self) -> Result<(), ClaudeSdkError> {
        let pid_dir = self.get_pid_dir()?;

        if !pid_dir.exists() {
            return Ok(());
        }

        for entry in std::fs::read_dir(&pid_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension().and_then(|s| s.to_str()) != Some("pid") {
                continue;
            }

            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            if !filename.ends_with("-claude-sdk.pid") {
                continue;
            }

            let pid_str = match std::fs::read_to_string(&path) {
                Ok(s) => s,
                Err(_) => continue,
            };

            let pid: i32 = match pid_str.trim().parse() {
                Ok(p) => p,
                Err(_) => {
                    let _ = std::fs::remove_file(&path);
                    continue;
                }
            };

            let is_running = unsafe { libc::kill(pid, 0) == 0 };

            if !is_running {
                println!(
                    "[ClaudeSdkManager] Removing stale PID file (process dead): {:?}",
                    path
                );
                let _ = std::fs::remove_file(&path);
            } else {
                let is_claude = std::process::Command::new("ps")
                    .args(["-p", &pid.to_string(), "-o", "command="])
                    .output()
                    .map(|output| {
                        let cmd = String::from_utf8_lossy(&output.stdout);
                        cmd.contains("claude")
                    })
                    .unwrap_or(false);

                if is_claude {
                    println!(
                        "[ClaudeSdkManager] Killing orphaned claude process (PID: {})",
                        pid
                    );
                    unsafe {
                        libc::kill(pid, libc::SIGTERM);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let still_running = unsafe { libc::kill(pid, 0) == 0 };
                    if still_running {
                        println!(
                            "[ClaudeSdkManager] Force killing claude process (PID: {})",
                            pid
                        );
                        unsafe {
                            libc::kill(pid, libc::SIGKILL);
                        }
                    }
                } else {
                    println!(
                        "[ClaudeSdkManager] PID {} is not claude (PID reuse), removing stale file: {:?}",
                        pid, path
                    );
                }
                let _ = std::fs::remove_file(&path);
            }
        }

        Ok(())
    }

    // ============================================================================
    // Private Helpers
    // ============================================================================

    /// Returns the PID directory path
    fn get_pid_dir(&self) -> Result<PathBuf, ClaudeSdkError> {
        if let Some(ref dir) = self.pid_dir_override {
            return Ok(dir.clone());
        }
        let home = dirs::home_dir().ok_or_else(|| {
            ClaudeSdkError::IoError(io::Error::new(
                io::ErrorKind::NotFound,
                "Home directory not found",
            ))
        })?;
        Ok(home.join(".ai-command-center").join("pids"))
    }
}

impl Default for ClaudeSdkManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
impl ClaudeSdkManager {
    pub fn set_pid_dir(&mut self, dir: PathBuf) {
        self.pid_dir_override = Some(dir);
    }
}

// ============================================================================
// Message Processing Loop
// ============================================================================

/// Async task that receives CLIMessages from the ProtocolPeer and dispatches actions
async fn run_message_loop(
    app: AppHandle,
    task_id: String,
    mut msg_rx: mpsc::UnboundedReceiver<CLIMessage>,
    peer: ProtocolPeer,
    sessions: Arc<Mutex<HashMap<String, ManagedCliProcess>>>,
    pid_dir: PathBuf,
) {
    println!(
        "[ClaudeSdkManager] Starting message loop for task {}",
        task_id
    );

    let agent_session_id: Option<String> = {
        let db = app.state::<std::sync::Mutex<crate::db::Database>>();
        db.lock().ok()
            .and_then(|db_lock| db_lock.get_latest_session_for_ticket(&task_id).ok().flatten())
            .map(|s| s.id)
    };

    let timestamp = || -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    };

    while let Some(msg) = msg_rx.recv().await {
        let action = classify_message(&msg);

        match action {
            MessageAction::EmitAgentEvent { event_type, data, persist } => {
                if event_type.is_empty() {
                    continue;
                }
                println!(
                    "[ClaudeSdkManager] emit type={} persist={} task={}",
                    event_type, persist, task_id
                );
                let ts = timestamp();
                let payload = AgentEventPayload {
                    task_id: task_id.clone(),
                    event_type: event_type.clone(),
                    data: data.clone(),
                    timestamp: ts,
                };
                if let Err(e) = app.emit("agent-event", &payload) {
                    eprintln!("[ClaudeSdkManager]   EMIT FAILED: {}", e);
                }

                if persist {
                    if let Some(ref sid) = agent_session_id {
                        persist_agent_log(&app, sid, &event_type, &data);
                    } else {
                        println!("[ClaudeSdkManager]   persist skipped: no agent_session_id");
                    }
                }
            }

            MessageAction::RequestToolApproval {
                request_id,
                tool_name,
                tool_input,
                tool_use_id,
            } => {
                let approval_payload = ToolApprovalEventPayload {
                    task_id: task_id.clone(),
                    request_id: request_id.clone(),
                    session_id: String::new(),
                    tool_use_id: tool_use_id.clone().unwrap_or_default(),
                    tool_name: tool_name.clone(),
                    tool_input: tool_input.clone(),
                    description: None,
                };

                if let Err(e) = app.emit("claude-tool-approval", &approval_payload) {
                    eprintln!(
                        "[ClaudeSdkManager] Failed to emit claude-tool-approval: {}",
                        e
                    );
                }

                persist_session_paused(&app, &task_id);
            }

            MessageAction::AutoApproveHook { request_id } => {
                let response = build_hook_response(AUTO_APPROVE_CALLBACK_ID)
                    .expect("auto_approve always returns Some");
                if let Err(e) = peer.send_hook_response(request_id, response).await {
                    eprintln!(
                        "[ClaudeSdkManager] Failed to send auto-approve response: {}",
                        e
                    );
                }
            }

            MessageAction::SessionCompleted { result } => {
                println!(
                    "[ClaudeSdkManager] Session completed for task {}",
                    task_id
                );

                if let Some(session_id) = result.get("session_id").and_then(|v| v.as_str()) {
                    store_claude_session_id(&app, &task_id, session_id);
                }

                persist_session_completed(&app, &task_id);

                if let Some(ref sid) = agent_session_id {
                    persist_agent_log(&app, sid, "result.success",
                        &serde_json::to_string(&result).unwrap_or_default());
                }

                let completion = CompletionPayload {
                    task_id: task_id.clone(),
                };
                if let Err(e) = app.emit("action-complete", &completion) {
                    eprintln!("[ClaudeSdkManager] Failed to emit action-complete: {}", e);
                }
                break;
            }

            MessageAction::SessionFailed { error } => {
                println!(
                    "[ClaudeSdkManager] Session failed for task {}: {}",
                    task_id, error
                );

                persist_session_failed(&app, &task_id, &error);

                if let Some(ref sid) = agent_session_id {
                    persist_agent_log(&app, sid, "result.error", &error);
                }

                let failure = FailurePayload {
                    task_id: task_id.clone(),
                    error,
                };
                if let Err(e) = app.emit("implementation-failed", &failure) {
                    eprintln!(
                        "[ClaudeSdkManager] Failed to emit implementation-failed: {}",
                        e
                    );
                }
                break;
            }

            MessageAction::CancelApproval { request_id } => {
                println!(
                    "[ClaudeSdkManager] Approval cancelled for request {} in task {}",
                    request_id, task_id
                );
                let mut sessions_guard = sessions.lock().await;
                if let Some(process) = sessions_guard.get_mut(&task_id) {
                    process.pending_approvals.remove(&request_id);
                }
            }

            MessageAction::Ignore => {}
        }
    }

    {
        let mut sessions_guard = sessions.lock().await;
        sessions_guard.remove(&task_id);
    }

    let pid_file = pid_dir.join(format!("{}-claude-sdk.pid", &task_id));
    let _ = std::fs::remove_file(&pid_file);

    println!(
        "[ClaudeSdkManager] Message loop exited for task {}",
        task_id
    );
}

// ============================================================================
// DB Helpers
// ============================================================================

fn persist_agent_log(app: &AppHandle, session_id: &str, log_type: &str, content: &str) {
    let db = app.state::<std::sync::Mutex<db::Database>>();
    if let Ok(db_lock) = db.lock() {
        if let Err(e) = db_lock.insert_agent_log(session_id, log_type, content) {
            eprintln!("[ClaudeSdkManager] Failed to persist agent log ({}): {}", log_type, e);
        }
    };
}

fn store_claude_session_id(app: &AppHandle, task_id: &str, claude_session_id: &str) {
    let db = app.state::<std::sync::Mutex<db::Database>>();
    if let Ok(db_lock) = db.lock() {
        if let Ok(Some(session)) = db_lock.get_latest_session_for_ticket(task_id) {
            if let Err(e) = db_lock.set_agent_session_claude_id(&session.id, claude_session_id) {
                eprintln!(
                    "[ClaudeSdkManager] Failed to set claude session id for task {}: {}",
                    task_id, e
                );
            }
        }
    };
}

fn persist_session_completed(app: &AppHandle, task_id: &str) {
    let db = app.state::<std::sync::Mutex<db::Database>>();
    if let Ok(db_lock) = db.lock() {
        if let Ok(Some(session)) = db_lock.get_latest_session_for_ticket(task_id) {
            if let Err(e) =
                db_lock.update_agent_session(&session.id, &session.stage, "completed", None, None)
            {
                eprintln!(
                    "[ClaudeSdkManager] Failed to persist completed status for task {}: {}",
                    task_id, e
                );
            }
        }
    };
}

fn persist_session_failed(app: &AppHandle, task_id: &str, error_msg: &str) {
    let db = app.state::<std::sync::Mutex<db::Database>>();
    if let Ok(db_lock) = db.lock() {
        if let Ok(Some(session)) = db_lock.get_latest_session_for_ticket(task_id) {
            if let Err(e) = db_lock.update_agent_session(
                &session.id,
                &session.stage,
                "failed",
                None,
                Some(error_msg),
            ) {
                eprintln!(
                    "[ClaudeSdkManager] Failed to persist failed status for task {}: {}",
                    task_id, e
                );
            }
        }
    };
}

fn persist_session_paused(app: &AppHandle, task_id: &str) {
    let db = app.state::<std::sync::Mutex<db::Database>>();
    if let Ok(db_lock) = db.lock() {
        if let Ok(Some(session)) = db_lock.get_latest_session_for_ticket(task_id) {
            if let Err(e) =
                db_lock.update_agent_session(&session.id, &session.stage, "paused", None, None)
            {
                eprintln!(
                    "[ClaudeSdkManager] Failed to persist paused status for task {}: {}",
                    task_id, e
                );
            }
        }
    };
}

#[allow(dead_code)]
fn persist_session_interrupted(app: &AppHandle, task_id: &str) {
    let db = app.state::<std::sync::Mutex<db::Database>>();
    if let Ok(db_lock) = db.lock() {
        if let Ok(Some(session)) = db_lock.get_latest_session_for_ticket(task_id) {
            if let Err(e) = db_lock.update_agent_session(
                &session.id,
                &session.stage,
                "interrupted",
                None,
                Some("Process ended without result"),
            ) {
                eprintln!(
                    "[ClaudeSdkManager] Failed to persist interrupted status for task {}: {}",
                    task_id, e
                );
            }
        }
    };
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claude_sdk_protocol::PermissionMode;

    // ========================================================================
    // Error type tests
    // ========================================================================

    #[test]
    fn test_error_display_spawn_failed() {
        let err = ClaudeSdkError::SpawnFailed("no such file".to_string());
        assert!(err.to_string().contains("Failed to spawn Claude CLI"));
        assert!(err.to_string().contains("no such file"));
    }

    #[test]
    fn test_error_display_session_not_found() {
        let err = ClaudeSdkError::SessionNotFound("task-42".to_string());
        assert!(err.to_string().contains("task-42"));
        assert!(err.to_string().contains("No Claude session found"));
    }

    #[test]
    fn test_error_display_protocol_error() {
        let err = ClaudeSdkError::ProtocolError("bad json".to_string());
        assert!(err.to_string().contains("Protocol error"));
        assert!(err.to_string().contains("bad json"));
    }

    #[test]
    fn test_error_from_io_error() {
        let io_err = io::Error::new(io::ErrorKind::BrokenPipe, "pipe broken");
        let err = ClaudeSdkError::from(io_err);
        assert!(err.to_string().contains("IO error"));
    }

    // ========================================================================
    // SessionOptions tests
    // ========================================================================

    #[test]
    fn test_session_options_default() {
        let opts = SessionOptions::default();
        assert_eq!(opts.permission_mode, PermissionMode::AcceptEdits);
        assert!(opts.model.is_none());
        assert!(opts.resume_session_id.is_none());
    }

    // ========================================================================
    // build_cli_args tests
    // ========================================================================

    #[test]
    fn test_build_cli_args_default_options() {
        let opts = SessionOptions::default();
        let args = build_cli_args(&opts);

        assert!(args.contains(&"-p".to_string()));
        assert!(args.contains(&"--verbose".to_string()));
        assert!(args.contains(&"--output-format=stream-json".to_string()));
        assert!(args.contains(&"--input-format=stream-json".to_string()));
        assert!(args.contains(&"--include-partial-messages".to_string()));
        assert!(args.contains(&"--replay-user-messages".to_string()));
        assert!(args.contains(&"--permission-prompt-tool=stdio".to_string()));

        assert!(args.contains(&"--permission-mode=acceptEdits".to_string()));

        assert!(!args.contains(&"--model".to_string()));
        assert!(!args.contains(&"--resume".to_string()));
    }

    #[test]
    fn test_build_cli_args_with_model() {
        let opts = SessionOptions {
            model: Some("claude-sonnet-4-20250514".to_string()),
            ..Default::default()
        };
        let args = build_cli_args(&opts);

        let model_idx = args.iter().position(|a| a == "--model").expect("--model flag present");
        assert_eq!(args[model_idx + 1], "claude-sonnet-4-20250514");
    }

    #[test]
    fn test_build_cli_args_with_resume() {
        let opts = SessionOptions {
            resume_session_id: Some("sess-abc-123".to_string()),
            ..Default::default()
        };
        let args = build_cli_args(&opts);

        let resume_idx = args.iter().position(|a| a == "--resume").expect("--resume flag present");
        assert_eq!(args[resume_idx + 1], "sess-abc-123");
    }

    #[test]
    fn test_build_cli_args_bypass_permissions_mode() {
        let opts = SessionOptions {
            permission_mode: PermissionMode::BypassPermissions,
            ..Default::default()
        };
        let args = build_cli_args(&opts);

        assert!(args.contains(&"--permission-mode=bypassPermissions".to_string()));
    }

    #[test]
    fn test_build_cli_args_plan_mode() {
        let opts = SessionOptions {
            permission_mode: PermissionMode::Plan,
            ..Default::default()
        };
        let args = build_cli_args(&opts);

        assert!(args.contains(&"--permission-mode=plan".to_string()));
    }

    #[test]
    fn test_build_cli_args_default_permission_mode() {
        let opts = SessionOptions {
            permission_mode: PermissionMode::Default,
            ..Default::default()
        };
        let args = build_cli_args(&opts);

        assert!(args.contains(&"--permission-mode=default".to_string()));
    }

    #[test]
    fn test_build_cli_args_all_options() {
        let opts = SessionOptions {
            permission_mode: PermissionMode::BypassPermissions,
            model: Some("claude-opus-4-20250514".to_string()),
            resume_session_id: Some("sess-xyz".to_string()),
        };
        let args = build_cli_args(&opts);

        assert!(args.contains(&"--permission-mode=bypassPermissions".to_string()));
        assert!(args.contains(&"--model".to_string()));
        assert!(args.contains(&"claude-opus-4-20250514".to_string()));
        assert!(args.contains(&"--resume".to_string()));
        assert!(args.contains(&"sess-xyz".to_string()));
    }

    #[test]
    fn test_build_cli_args_order_base_flags_first() {
        let opts = SessionOptions::default();
        let args = build_cli_args(&opts);

        assert_eq!(args[0], "-p");
    }

    // ========================================================================
    // build_hooks tests
    // ========================================================================

    #[test]
    fn test_build_hooks_plan_mode_returns_none() {
        let hooks = build_hooks(PermissionMode::Plan);
        assert!(hooks.is_none(), "Plan mode should not have hooks");
    }

    #[test]
    fn test_build_hooks_bypass_permissions_auto_approves_all() {
        let hooks = build_hooks(PermissionMode::BypassPermissions).expect("hooks present");

        let pre_tool_use = hooks["pre_tool_use"].as_array().expect("pre_tool_use array");
        assert_eq!(pre_tool_use.len(), 1, "Only one catch-all hook");

        assert_eq!(pre_tool_use[0]["callback_id"], AUTO_APPROVE_CALLBACK_ID);
        assert_eq!(pre_tool_use[0]["tool_name"], ".*");
    }

    #[test]
    fn test_build_hooks_accept_edits_has_two_hooks() {
        let hooks = build_hooks(PermissionMode::AcceptEdits).expect("hooks present");

        let pre_tool_use = hooks["pre_tool_use"].as_array().expect("pre_tool_use array");
        assert_eq!(pre_tool_use.len(), 2, "Should have auto-approve + ask hooks");

        assert_eq!(pre_tool_use[0]["callback_id"], AUTO_APPROVE_CALLBACK_ID);
        let tool_pattern = pre_tool_use[0]["tool_name"].as_str().unwrap();
        assert!(
            tool_pattern.contains("Write") && tool_pattern.contains("Edit"),
            "Should match Write/Edit tools, got: {}",
            tool_pattern
        );

        assert_eq!(pre_tool_use[1]["callback_id"], TOOL_APPROVAL_CALLBACK_ID);
        assert_eq!(pre_tool_use[1]["tool_name"], ".*");
    }

    #[test]
    fn test_build_hooks_default_asks_for_everything() {
        let hooks = build_hooks(PermissionMode::Default).expect("hooks present");

        let pre_tool_use = hooks["pre_tool_use"].as_array().expect("pre_tool_use array");
        assert_eq!(pre_tool_use.len(), 1, "Only one catch-all hook");

        assert_eq!(pre_tool_use[0]["callback_id"], TOOL_APPROVAL_CALLBACK_ID);
        assert_eq!(pre_tool_use[0]["tool_name"], ".*");
    }

    // ========================================================================
    // build_hook_response tests
    // ========================================================================

    #[test]
    fn test_hook_response_auto_approve_returns_allow() {
        let response = build_hook_response(AUTO_APPROVE_CALLBACK_ID);
        assert!(response.is_some(), "auto_approve should return a response");

        let json = response.unwrap();
        assert_eq!(
            json["hookSpecificOutput"]["permissionDecision"],
            "allow"
        );
    }

    #[test]
    fn test_hook_response_tool_approval_returns_none() {
        let response = build_hook_response(TOOL_APPROVAL_CALLBACK_ID);
        assert!(
            response.is_none(),
            "tool_approval needs user interaction, should return None"
        );
    }

    #[test]
    fn test_hook_response_unknown_callback_returns_allow() {
        let response = build_hook_response("some_unknown_callback");
        assert!(
            response.is_some(),
            "Unknown callbacks should auto-approve (safe default)"
        );
    }

    // ========================================================================
    // classify_message tests
    // ========================================================================

    #[test]
    fn test_classify_can_use_tool_returns_request_approval() {
        let msg = CLIMessage::ControlRequest {
            request_id: "req-1".to_string(),
            request: ControlRequestType::CanUseTool {
                tool_name: "bash".to_string(),
                input: serde_json::json!({"command": "ls -la"}),
                permission_suggestions: None,
                blocked_paths: None,
                tool_use_id: Some("tu-1".to_string()),
            },
        };

        let action = classify_message(&msg);
        match action {
            MessageAction::RequestToolApproval {
                request_id,
                tool_name,
                tool_use_id,
                ..
            } => {
                assert_eq!(request_id, "req-1");
                assert_eq!(tool_name, "bash");
                assert_eq!(tool_use_id, Some("tu-1".to_string()));
            }
            _ => panic!("Expected RequestToolApproval, got {:?}", action),
        }
    }

    #[test]
    fn test_classify_hook_callback_auto_approve() {
        let msg = CLIMessage::ControlRequest {
            request_id: "req-2".to_string(),
            request: ControlRequestType::HookCallback {
                callback_id: AUTO_APPROVE_CALLBACK_ID.to_string(),
                input: serde_json::json!({"tool": "Write"}),
                tool_use_id: None,
            },
        };

        let action = classify_message(&msg);
        match action {
            MessageAction::AutoApproveHook { request_id } => {
                assert_eq!(request_id, "req-2");
            }
            _ => panic!("Expected AutoApproveHook, got {:?}", action),
        }
    }

    #[test]
    fn test_classify_hook_callback_needs_approval() {
        let msg = CLIMessage::ControlRequest {
            request_id: "req-3".to_string(),
            request: ControlRequestType::HookCallback {
                callback_id: TOOL_APPROVAL_CALLBACK_ID.to_string(),
                input: serde_json::json!({"tool": "Bash"}),
                tool_use_id: Some("tu-2".to_string()),
            },
        };

        let action = classify_message(&msg);
        match action {
            MessageAction::RequestToolApproval { request_id, .. } => {
                assert_eq!(request_id, "req-3");
            }
            _ => panic!("Expected RequestToolApproval, got {:?}", action),
        }
    }

    #[test]
    fn test_classify_control_response_is_ignored() {
        let msg = CLIMessage::ControlResponse {
            response: crate::claude_sdk_protocol::ControlResponseType::Success {
                request_id: "req-init".to_string(),
                response: None,
            },
        };

        let action = classify_message(&msg);
        assert_eq!(action, MessageAction::Ignore);
    }

    #[test]
    fn test_classify_control_cancel_request() {
        let msg = CLIMessage::ControlCancelRequest {
            request_id: "req-cancel".to_string(),
        };

        let action = classify_message(&msg);
        match action {
            MessageAction::CancelApproval { request_id } => {
                assert_eq!(request_id, "req-cancel");
            }
            _ => panic!("Expected CancelApproval, got {:?}", action),
        }
    }

    #[test]
    fn test_classify_result_success() {
        let msg = CLIMessage::Result(serde_json::json!({
            "type": "result",
            "subtype": "success",
            "session_id": "sess-123",
            "cost_usd": 0.05
        }));

        let action = classify_message(&msg);
        match action {
            MessageAction::SessionCompleted { result } => {
                assert_eq!(result["session_id"], "sess-123");
                assert_eq!(result["cost_usd"], 0.05);
            }
            _ => panic!("Expected SessionCompleted, got {:?}", action),
        }
    }

    #[test]
    fn test_classify_result_error() {
        let msg = CLIMessage::Result(serde_json::json!({
            "type": "result",
            "subtype": "error",
            "is_error": true,
            "error": "Rate limit exceeded"
        }));

        let action = classify_message(&msg);
        match action {
            MessageAction::SessionFailed { error } => {
                assert_eq!(error, "Rate limit exceeded");
            }
            _ => panic!("Expected SessionFailed, got {:?}", action),
        }
    }

    #[test]
    fn test_classify_result_without_is_error_flag_is_success() {
        let msg = CLIMessage::Result(serde_json::json!({
            "type": "result",
            "cost_usd": 0.01
        }));

        let action = classify_message(&msg);
        assert!(
            matches!(action, MessageAction::SessionCompleted { .. }),
            "Result without is_error should be success"
        );
    }

    #[test]
    fn test_classify_other_assistant_extracts_text() {
        let msg = CLIMessage::Other(serde_json::json!({
            "type": "assistant",
            "session_id": "ses-1",
            "message": {"content": [{"type": "text", "text": "Hello!"}]}
        }));

        let action = classify_message(&msg);
        match action {
            MessageAction::EmitAgentEvent { event_type, data, .. } => {
                assert_eq!(event_type, "assistant");
                let parsed: serde_json::Value = serde_json::from_str(&data).unwrap();
                assert_eq!(parsed["text"], "Hello!");
            }
            _ => panic!("Expected EmitAgentEvent, got {:?}", action),
        }
    }

    #[test]
    fn test_classify_other_without_type_field() {
        let msg = CLIMessage::Other(serde_json::json!({
            "data": "something"
        }));

        let action = classify_message(&msg);
        match action {
            MessageAction::EmitAgentEvent { event_type, .. } => {
                assert_eq!(event_type, "unknown");
            }
            _ => panic!("Expected EmitAgentEvent, got {:?}", action),
        }
    }

    // ========================================================================
    // transform_cli_event tests
    // ========================================================================

    #[test]
    fn test_transform_system_to_system_init() {
        let value = serde_json::json!({
            "type": "system",
            "subtype": "init",
            "session_id": "ses-abc",
            "cwd": "/tmp",
            "tools": ["Read", "Edit"]
        });
        let (event_type, data) = transform_cli_event("system", &value);
        assert_eq!(event_type, "system.init");
        let parsed: serde_json::Value = serde_json::from_str(&data).unwrap();
        assert_eq!(parsed["sessionId"], "ses-abc");
    }

    #[test]
    fn test_transform_assistant_extracts_text_and_tool_uses() {
        let value = serde_json::json!({
            "type": "assistant",
            "session_id": "ses-1",
            "message": {
                "content": [
                    {"type": "text", "text": "Let me read that file."},
                    {"type": "tool_use", "id": "tu-1", "name": "Read", "input": {"file_path": "main.rs"}}
                ],
                "stop_reason": "tool_use"
            }
        });
        let (event_type, data) = transform_cli_event("assistant", &value);
        assert_eq!(event_type, "assistant");
        let parsed: serde_json::Value = serde_json::from_str(&data).unwrap();
        assert_eq!(parsed["text"], "Let me read that file.");
        let tool_uses = parsed["toolUses"].as_array().unwrap();
        assert_eq!(tool_uses.len(), 1);
        assert_eq!(tool_uses[0]["id"], "tu-1");
        assert_eq!(tool_uses[0]["name"], "Read");
    }

    #[test]
    fn test_transform_assistant_text_only() {
        let value = serde_json::json!({
            "type": "assistant",
            "message": {
                "content": [{"type": "text", "text": "Just text, no tools."}],
                "stop_reason": "end_turn"
            }
        });
        let (event_type, data) = transform_cli_event("assistant", &value);
        assert_eq!(event_type, "assistant");
        let parsed: serde_json::Value = serde_json::from_str(&data).unwrap();
        assert_eq!(parsed["text"], "Just text, no tools.");
        assert!(parsed.get("toolUses").is_none());
    }

    #[test]
    fn test_transform_stream_event_text_delta() {
        let value = serde_json::json!({
            "type": "stream_event",
            "session_id": "ses-1",
            "event": {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": "Hello "}
            }
        });
        let (event_type, data) = transform_cli_event("stream_event", &value);
        assert_eq!(event_type, "assistant_delta");
        let parsed: serde_json::Value = serde_json::from_str(&data).unwrap();
        assert_eq!(parsed["text"], "Hello ");
    }

    #[test]
    fn test_transform_stream_event_non_text_delta_ignored() {
        let value = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "thinking_delta", "thinking": "hmm"}
            }
        });
        let (event_type, _) = transform_cli_event("stream_event", &value);
        assert!(event_type.is_empty(), "Non-text deltas should be skipped");
    }

    #[test]
    fn test_transform_stream_event_message_start_ignored() {
        let value = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "message_start",
                "message": {"role": "assistant"}
            }
        });
        let (event_type, _) = transform_cli_event("stream_event", &value);
        assert!(event_type.is_empty());
    }

    #[test]
    fn test_transform_tool_use() {
        let value = serde_json::json!({
            "type": "tool_use",
            "id": "toolu_abc",
            "tool_name": "Bash",
            "input": {"command": "ls"},
            "session_id": "ses-1"
        });
        let (event_type, data) = transform_cli_event("tool_use", &value);
        assert_eq!(event_type, "tool_use");
        let parsed: serde_json::Value = serde_json::from_str(&data).unwrap();
        assert_eq!(parsed["toolUseId"], "toolu_abc");
        assert_eq!(parsed["toolName"], "Bash");
        assert_eq!(parsed["toolInput"]["command"], "ls");
    }

    #[test]
    fn test_transform_tool_result() {
        let value = serde_json::json!({
            "type": "tool_result",
            "tool_use_id": "toolu_abc",
            "result": "file contents here",
            "is_error": false,
            "session_id": "ses-1"
        });
        let (event_type, data) = transform_cli_event("tool_result", &value);
        assert_eq!(event_type, "tool_result");
        let parsed: serde_json::Value = serde_json::from_str(&data).unwrap();
        assert_eq!(parsed["toolUseId"], "toolu_abc");
        assert_eq!(parsed["content"], "file contents here");
        assert_eq!(parsed["isError"], false);
    }

    #[test]
    fn test_transform_tool_result_error() {
        let value = serde_json::json!({
            "type": "tool_result",
            "tool_use_id": "toolu_xyz",
            "result": "Permission denied",
            "is_error": true
        });
        let (_, data) = transform_cli_event("tool_result", &value);
        let parsed: serde_json::Value = serde_json::from_str(&data).unwrap();
        assert_eq!(parsed["isError"], true);
    }

    #[test]
    fn test_transform_unknown_type_passthrough() {
        let value = serde_json::json!({
            "type": "rate_limit_event",
            "retry_after": 5
        });
        let (event_type, data) = transform_cli_event("rate_limit_event", &value);
        assert_eq!(event_type, "rate_limit_event");
        assert!(data.contains("retry_after"));
    }

    // ========================================================================
    // Manager construction tests
    // ========================================================================

    #[test]
    fn test_manager_new() {
        let manager = ClaudeSdkManager::new();
        assert!(manager.sessions.try_lock().is_ok());
    }

    #[tokio::test]
    async fn test_is_running_returns_false_when_no_session() {
        let manager = ClaudeSdkManager::new();
        assert!(!manager.is_running("nonexistent_task").await);
    }

    // ========================================================================
    // PID file tests
    // ========================================================================

    #[test]
    fn test_cleanup_stale_pids_empty_dir() {
        let mut manager = ClaudeSdkManager::new();
        let tmp_dir = std::env::temp_dir().join("test_sdk_cleanup_empty_v2");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        manager.set_pid_dir(tmp_dir.clone());

        let result = manager.cleanup_stale_pids();
        assert!(result.is_ok());

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_cleanup_stale_pids_invalid_content() {
        let mut manager = ClaudeSdkManager::new();
        let tmp_dir = std::env::temp_dir().join("test_sdk_cleanup_invalid_v2");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        manager.set_pid_dir(tmp_dir.clone());

        let pid_file = tmp_dir.join("task123-claude-sdk.pid");
        std::fs::write(&pid_file, "not_a_number").unwrap();
        assert!(pid_file.exists());

        let result = manager.cleanup_stale_pids();
        assert!(result.is_ok());
        assert!(!pid_file.exists(), "Invalid PID file should be removed");

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_cleanup_stale_pids_dead_process() {
        let mut manager = ClaudeSdkManager::new();
        let tmp_dir = std::env::temp_dir().join("test_sdk_cleanup_dead_v2");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        manager.set_pid_dir(tmp_dir.clone());

        let pid_file = tmp_dir.join("dead_task-claude-sdk.pid");
        std::fs::write(&pid_file, "999999").unwrap();
        assert!(pid_file.exists());

        let result = manager.cleanup_stale_pids();
        assert!(result.is_ok());
        assert!(
            !pid_file.exists(),
            "Stale PID file for dead process should be removed"
        );

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_cleanup_stale_pids_non_sdk_files_ignored() {
        let mut manager = ClaudeSdkManager::new();
        let tmp_dir = std::env::temp_dir().join("test_sdk_cleanup_other_v2");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        manager.set_pid_dir(tmp_dir.clone());

        let other_pid_file = tmp_dir.join("task123-claude.pid");
        std::fs::write(&other_pid_file, "999999").unwrap();
        let server_pid_file = tmp_dir.join("task123.pid");
        std::fs::write(&server_pid_file, "999999").unwrap();

        let result = manager.cleanup_stale_pids();
        assert!(result.is_ok());
        assert!(
            other_pid_file.exists(),
            "Claude (non-sdk) PID files should not be touched"
        );
        assert!(
            server_pid_file.exists(),
            "Server PID files should not be touched"
        );

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_cleanup_stale_pids_non_pid_files_ignored() {
        let mut manager = ClaudeSdkManager::new();
        let tmp_dir = std::env::temp_dir().join("test_sdk_cleanup_txt_v2");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        manager.set_pid_dir(tmp_dir.clone());

        let non_pid_file = tmp_dir.join("README.txt");
        std::fs::write(&non_pid_file, "not a pid file").unwrap();

        let result = manager.cleanup_stale_pids();
        assert!(result.is_ok());
        assert!(
            non_pid_file.exists(),
            "Non-.pid files should not be removed"
        );

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    // ========================================================================
    // Integration-style tests (verify full message → action flow)
    // ========================================================================

    #[test]
    fn test_full_flow_can_use_tool_with_tool_input() {
        let json = r#"{
            "type": "control_request",
            "request_id": "req-abc",
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "Bash",
                "input": {"command": "npm install", "description": "Install dependencies"},
                "tool_use_id": "tu-xyz"
            }
        }"#;

        let msg: CLIMessage = serde_json::from_str(json).expect("parse");
        let action = classify_message(&msg);

        match action {
            MessageAction::RequestToolApproval {
                request_id,
                tool_name,
                tool_input,
                tool_use_id,
            } => {
                assert_eq!(request_id, "req-abc");
                assert_eq!(tool_name, "Bash");
                assert_eq!(tool_input["command"], "npm install");
                assert_eq!(tool_use_id, Some("tu-xyz".to_string()));
            }
            _ => panic!("Expected RequestToolApproval, got {:?}", action),
        }
    }

    #[test]
    fn test_full_flow_hook_auto_approve_file_edit() {
        let json = format!(
            r#"{{
                "type": "control_request",
                "request_id": "req-write",
                "request": {{
                    "subtype": "hook_callback",
                    "callback_id": "{}",
                    "input": {{"tool": "Write", "path": "/tmp/file.txt"}}
                }}
            }}"#,
            AUTO_APPROVE_CALLBACK_ID
        );

        let msg: CLIMessage = serde_json::from_str(&json).expect("parse");
        let action = classify_message(&msg);

        match action {
            MessageAction::AutoApproveHook { request_id } => {
                assert_eq!(request_id, "req-write");
            }
            _ => panic!("Expected AutoApproveHook, got {:?}", action),
        }
    }

    #[test]
    fn test_full_flow_result_extracts_cost() {
        let json = r#"{
            "type": "result",
            "subtype": "success",
            "session_id": "sess-final",
            "cost_usd": 0.123,
            "duration_ms": 45000
        }"#;

        let msg: CLIMessage = serde_json::from_str(json).expect("parse");
        let action = classify_message(&msg);

        match action {
            MessageAction::SessionCompleted { result } => {
                assert_eq!(result["session_id"], "sess-final");
                assert_eq!(result["cost_usd"], 0.123);
            }
            _ => panic!("Expected SessionCompleted, got {:?}", action),
        }
    }

    #[test]
    fn test_should_persist_meaningful_events() {
        let v = serde_json::json!({});
        assert!(should_persist_event("system", &v));
        assert!(should_persist_event("assistant", &v));
        assert!(should_persist_event("tool_use", &v));
        assert!(should_persist_event("tool_result", &v));
    }

    #[test]
    fn test_should_not_persist_transient_events() {
        let v = serde_json::json!({});
        assert!(!should_persist_event("stream_event", &v));
        assert!(!should_persist_event("user", &v));
        assert!(!should_persist_event("result", &v));
        assert!(!should_persist_event("unknown", &v));
    }
}
