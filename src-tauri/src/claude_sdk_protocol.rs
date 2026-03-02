use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::{mpsc, Mutex};

// ============================================================================
// Incoming Messages (CLI → Rust)
// ============================================================================

/// Top-level message types from CLI stdout.
/// Deserialized from NDJSON lines written to the process's stdout.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CLIMessage {
    /// CLI is requesting a control action from the SDK (e.g. permission check)
    ControlRequest {
        request_id: String,
        request: ControlRequestType,
    },
    /// CLI is responding to a previous SDK control request
    ControlResponse {
        response: ControlResponseType,
    },
    /// CLI wants to cancel a previously issued control request
    ControlCancelRequest {
        request_id: String,
    },
    /// Final result of the agent run; signals end-of-stream
    Result(serde_json::Value),
    /// Any message type not covered by the above variants
    #[serde(untagged)]
    Other(serde_json::Value),
}

/// Subtypes of control requests that the CLI sends to the SDK.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "subtype", rename_all = "snake_case")]
pub enum ControlRequestType {
    /// CLI is asking whether it may use a particular tool
    CanUseTool {
        tool_name: String,
        input: serde_json::Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        permission_suggestions: Option<Vec<PermissionUpdate>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        blocked_paths: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_use_id: Option<String>,
    },
    /// CLI is invoking a hook callback registered by the SDK
    HookCallback {
        #[serde(rename = "callback_id")]
        callback_id: String,
        input: serde_json::Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_use_id: Option<String>,
    },
}

// ============================================================================
// Outgoing Messages (Rust → CLI)
// ============================================================================

/// Wrapper sent on stdin to respond to a CLI control request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlResponseMessage {
    #[serde(rename = "type")]
    message_type: String, // Always "control_response"
    pub response: ControlResponseType,
}

impl ControlResponseMessage {
    pub fn new(response: ControlResponseType) -> Self {
        Self {
            message_type: "control_response".to_string(),
            response,
        }
    }
}

/// Success / error variants for control responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "subtype", rename_all = "snake_case")]
pub enum ControlResponseType {
    Success {
        request_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        response: Option<serde_json::Value>,
    },
    Error {
        request_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
}

/// Wrapper sent on stdin to issue a control request from SDK → CLI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SDKControlRequest {
    #[serde(rename = "type")]
    message_type: String, // Always "control_request"
    pub request_id: String,
    pub request: SDKControlRequestType,
}

impl SDKControlRequest {
    /// Create a new SDK control request with a freshly generated UUID.
    pub fn new(request: SDKControlRequestType) -> Self {
        Self {
            message_type: "control_request".to_string(),
            request_id: uuid::Uuid::new_v4().to_string(),
            request,
        }
    }
}

/// Subtypes of control requests that the SDK sends to the CLI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "subtype", rename_all = "snake_case")]
pub enum SDKControlRequestType {
    /// Tell the CLI which permission mode to enforce
    SetPermissionMode { mode: PermissionMode },
    /// Sent once at startup to exchange capability information
    Initialize {
        #[serde(skip_serializing_if = "Option::is_none")]
        hooks: Option<serde_json::Value>,
    },
    /// Ask the CLI to stop the current agent turn
    Interrupt {},
}

/// A user-turn message pushed onto the CLI's stdin conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Message {
    User { message: ClaudeUserMessage },
}

/// Inner payload of a user message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeUserMessage {
    role: String,
    content: String,
}

impl Message {
    /// Convenience constructor for a plain-text user message.
    pub fn new_user(content: String) -> Self {
        Self::User {
            message: ClaudeUserMessage {
                role: "user".to_string(),
                content,
            },
        }
    }
}

// ============================================================================
// Permission Types
// ============================================================================

/// Result of a `CanUseTool` permission check.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "behavior", rename_all = "camelCase")]
pub enum PermissionResult {
    Allow {
        #[serde(rename = "updatedInput")]
        updated_input: serde_json::Value,
        #[serde(skip_serializing_if = "Option::is_none", rename = "updatedPermissions")]
        updated_permissions: Option<Vec<PermissionUpdate>>,
    },
    Deny {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        interrupt: Option<bool>,
    },
}

/// A single persistent-permission rule to apply after a tool call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionUpdate {
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_type: Option<PermissionUpdateType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination: Option<PermissionUpdateDestination>,
}

/// Whether the permission is granted or revoked.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionUpdateType {
    Allow,
    Deny,
}

/// Where the persistent permission should be stored.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionUpdateDestination {
    LocalNoProject,
    LocalProject,
    UserGlobal,
}

/// Controls how strictly the CLI enforces tool permissions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    Default,
    AcceptEdits,
    Plan,
    BypassPermissions,
}

impl std::fmt::Display for PermissionMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Default => write!(f, "default"),
            Self::AcceptEdits => write!(f, "acceptEdits"),
            Self::Plan => write!(f, "plan"),
            Self::BypassPermissions => write!(f, "bypassPermissions"),
        }
    }
}

// ============================================================================
// Protocol Peer
// ============================================================================

/// Bidirectional NDJSON communication channel with a Claude Code CLI process.
///
/// - **Stdout** (incoming): a background task reads lines and sends them on the
///   `UnboundedReceiver<CLIMessage>` returned by [`ProtocolPeer::spawn`].
/// - **Stdin** (outgoing): callers write through the async helper methods.
///
/// When the one-shot `cancel_rx` fires the reader sends an [`SDKControlRequest`]
/// with [`SDKControlRequestType::Interrupt`] and then drains output until a
/// `CLIMessage::Result` arrives (or EOF), so the CLI process exits cleanly.
#[derive(Clone)]
pub struct ProtocolPeer {
    stdin: Arc<Mutex<ChildStdin>>,
}

impl ProtocolPeer {
    /// Spawn the background reader loop.
    ///
    /// # Returns
    /// `(peer, rx)` where `rx` delivers every [`CLIMessage`] parsed from stdout.
    ///
    /// # Cancellation
    /// Drop or resolve `cancel_tx` (the sender side of the oneshot pair) to
    /// trigger a graceful interrupt: the peer sends `Interrupt` and continues
    /// reading until the CLI emits a `Result` message or closes stdout.
    pub fn spawn(
        stdin: ChildStdin,
        stdout: ChildStdout,
        cancel_rx: tokio::sync::oneshot::Receiver<()>,
    ) -> (Self, mpsc::UnboundedReceiver<CLIMessage>) {
        let (tx, rx) = mpsc::unbounded_channel::<CLIMessage>();
        let stdin = Arc::new(Mutex::new(stdin));
        let peer = Self {
            stdin: Arc::clone(&stdin),
        };
        let peer_for_task = peer.clone();

        tokio::spawn(async move {
            Self::read_loop(peer_for_task, stdout, cancel_rx, tx).await;
        });

        (peer, rx)
    }

    async fn read_loop(
        peer: ProtocolPeer,
        stdout: ChildStdout,
        cancel_rx: tokio::sync::oneshot::Receiver<()>,
        tx: mpsc::UnboundedSender<CLIMessage>,
    ) {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut cancel_rx = cancel_rx;
        let mut cancelled = false;

        loop {
            if cancelled {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        if let Ok(msg) = serde_json::from_str::<CLIMessage>(&line) {
                            let done = matches!(msg, CLIMessage::Result(_));
                            let _ = tx.send(msg);
                            if done {
                                break;
                            }
                        }
                    }
                    _ => break,
                }
            } else {
                tokio::select! {
                    biased;

                    _ = &mut cancel_rx => {
                        cancelled = true;
                        let _ = peer.interrupt().await;
                    }

                    line = lines.next_line() => {
                        match line {
                            Ok(Some(line)) => {
                                let raw_type = serde_json::from_str::<serde_json::Value>(&line)
                                    .ok()
                                    .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(String::from))
                                    .unwrap_or_else(|| "??".to_string());
                                println!("[ProtocolPeer] stdout type={} len={}", raw_type, line.len());
                                match serde_json::from_str::<CLIMessage>(&line) {
                                    Ok(msg) => {
                                        let variant = match &msg {
                                            CLIMessage::ControlRequest { .. } => "ControlRequest",
                                            CLIMessage::ControlResponse { .. } => "ControlResponse",
                                            CLIMessage::ControlCancelRequest { .. } => "ControlCancelRequest",
                                            CLIMessage::Result(_) => "Result",
                                            CLIMessage::Other(_) => "Other",
                                        };
                                        println!("[ProtocolPeer] parsed as CLIMessage::{}", variant);
                                        let done = matches!(msg, CLIMessage::Result(_));
                                        let _ = tx.send(msg);
                                        if done {
                                            break;
                                        }
                                    }
                                    Err(e) => {
                                        eprintln!("[ProtocolPeer] PARSE FAILED: {} — raw: {:.300}", e, line);
                                    }
                                }
                            }
                            Ok(None) => {
                                println!("[ProtocolPeer] stdout EOF");
                                break;
                            }
                            Err(e) => {
                                eprintln!("[ProtocolPeer] stdout read error: {}", e);
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    async fn send_json<T: serde::Serialize>(&self, message: &T) -> Result<(), std::io::Error> {
        let json = serde_json::to_string(message)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        println!("[ProtocolPeer] stdin → {:.500}", json);
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(json.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        println!("[ProtocolPeer] stdin flush OK");
        Ok(())
    }

    /// Send a user-turn message to the CLI.
    pub async fn send_user_message(&self, content: String) -> Result<(), std::io::Error> {
        self.send_json(&Message::new_user(content)).await
    }

    /// Send an `initialize` control request (call once at startup).
    pub async fn initialize(
        &self,
        hooks: Option<serde_json::Value>,
    ) -> Result<(), std::io::Error> {
        let req = SDKControlRequest::new(SDKControlRequestType::Initialize { hooks });
        self.send_json(&req).await
    }

    /// Send an `interrupt` control request to stop the current agent turn.
    pub async fn interrupt(&self) -> Result<(), std::io::Error> {
        let req = SDKControlRequest::new(SDKControlRequestType::Interrupt {});
        self.send_json(&req).await
    }

    /// Change the permission mode on the running CLI session.
    pub async fn set_permission_mode(&self, mode: PermissionMode) -> Result<(), std::io::Error> {
        let req = SDKControlRequest::new(SDKControlRequestType::SetPermissionMode { mode });
        self.send_json(&req).await
    }

    /// Respond to a `HookCallback` control request with a successful result.
    pub async fn send_hook_response(
        &self,
        request_id: String,
        hook_output: serde_json::Value,
    ) -> Result<(), std::io::Error> {
        let msg = ControlResponseMessage::new(ControlResponseType::Success {
            request_id,
            response: Some(hook_output),
        });
        self.send_json(&msg).await
    }

    /// Respond to a control request with an error.
    pub async fn send_error(
        &self,
        request_id: String,
        error: String,
    ) -> Result<(), std::io::Error> {
        let msg = ControlResponseMessage::new(ControlResponseType::Error {
            request_id,
            error: Some(error),
        });
        self.send_json(&msg).await
    }

    /// Respond to a `CanUseTool` control request.
    pub async fn send_permission_response(
        &self,
        request_id: String,
        result: PermissionResult,
    ) -> Result<(), std::io::Error> {
        let value = serde_json::to_value(&result)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        let msg = ControlResponseMessage::new(ControlResponseType::Success {
            request_id,
            response: Some(value),
        });
        self.send_json(&msg).await
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================================================
    // CLIMessage deserialization
    // ========================================================================

    #[test]
    fn test_cli_message_control_request_can_use_tool() {
        let json = r#"{
            "type": "control_request",
            "request_id": "req-1",
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "bash",
                "input": {"command": "ls"}
            }
        }"#;

        let msg: CLIMessage = serde_json::from_str(json).expect("deserialize");
        match msg {
            CLIMessage::ControlRequest { request_id, request } => {
                assert_eq!(request_id, "req-1");
                match request {
                    ControlRequestType::CanUseTool { tool_name, .. } => {
                        assert_eq!(tool_name, "bash");
                    }
                    _ => panic!("Expected CanUseTool"),
                }
            }
            _ => panic!("Expected ControlRequest"),
        }
    }

    #[test]
    fn test_cli_message_control_request_hook_callback() {
        let json = r#"{
            "type": "control_request",
            "request_id": "req-2",
            "request": {
                "subtype": "hook_callback",
                "callback_id": "cb-42",
                "input": {"data": "hello"},
                "tool_use_id": "tu-1"
            }
        }"#;

        let msg: CLIMessage = serde_json::from_str(json).expect("deserialize");
        match msg {
            CLIMessage::ControlRequest { request_id, request } => {
                assert_eq!(request_id, "req-2");
                match request {
                    ControlRequestType::HookCallback { callback_id, tool_use_id, .. } => {
                        assert_eq!(callback_id, "cb-42");
                        assert_eq!(tool_use_id, Some("tu-1".to_string()));
                    }
                    _ => panic!("Expected HookCallback"),
                }
            }
            _ => panic!("Expected ControlRequest"),
        }
    }

    #[test]
    fn test_cli_message_control_cancel_request() {
        let json = r#"{"type": "control_cancel_request", "request_id": "req-99"}"#;
        let msg: CLIMessage = serde_json::from_str(json).expect("deserialize");
        match msg {
            CLIMessage::ControlCancelRequest { request_id } => {
                assert_eq!(request_id, "req-99");
            }
            _ => panic!("Expected ControlCancelRequest"),
        }
    }

    #[test]
    fn test_cli_message_result() {
        let json = r#"{"type": "result", "subtype": "success", "cost_usd": 0.01}"#;
        let msg: CLIMessage = serde_json::from_str(json).expect("deserialize");
        match msg {
            CLIMessage::Result(val) => {
                assert_eq!(val["cost_usd"], serde_json::json!(0.01));
            }
            _ => panic!("Expected Result"),
        }
    }

    #[test]
    fn test_cli_message_other_unknown_type() {
        let json = r#"{"type": "some_future_type", "data": "anything"}"#;
        let msg: CLIMessage = serde_json::from_str(json).expect("deserialize");
        assert!(matches!(msg, CLIMessage::Other(_)));
    }

    #[test]
    fn test_cli_message_malformed_json_returns_error() {
        let malformed = r#"{"type": "control_request""#;
        let result = serde_json::from_str::<CLIMessage>(malformed);
        assert!(result.is_err(), "malformed JSON must fail");
    }

    // ========================================================================
    // ControlRequestType round-trip
    // ========================================================================

    #[test]
    fn test_control_request_type_can_use_tool_round_trip() {
        let original = ControlRequestType::CanUseTool {
            tool_name: "python".to_string(),
            input: serde_json::json!({"code": "print('hi')"}),
            permission_suggestions: None,
            blocked_paths: Some("/etc".to_string()),
            tool_use_id: Some("tu-abc".to_string()),
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let back: ControlRequestType = serde_json::from_str(&json).expect("deserialize");
        match back {
            ControlRequestType::CanUseTool { tool_name, blocked_paths, tool_use_id, .. } => {
                assert_eq!(tool_name, "python");
                assert_eq!(blocked_paths, Some("/etc".to_string()));
                assert_eq!(tool_use_id, Some("tu-abc".to_string()));
            }
            _ => panic!("Expected CanUseTool"),
        }
    }

    #[test]
    fn test_control_request_type_hook_callback_round_trip() {
        let original = ControlRequestType::HookCallback {
            callback_id: "cb-1".to_string(),
            input: serde_json::json!({"x": 1}),
            tool_use_id: None,
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let back: ControlRequestType = serde_json::from_str(&json).expect("deserialize");
        match back {
            ControlRequestType::HookCallback { callback_id, tool_use_id, .. } => {
                assert_eq!(callback_id, "cb-1");
                assert!(tool_use_id.is_none());
            }
            _ => panic!("Expected HookCallback"),
        }
    }

    // ========================================================================
    // SDKControlRequest round-trip
    // ========================================================================

    #[test]
    fn test_sdk_control_request_set_permission_mode_round_trip() {
        let req = SDKControlRequest::new(SDKControlRequestType::SetPermissionMode {
            mode: PermissionMode::AcceptEdits,
        });
        let json = serde_json::to_string(&req).expect("serialize");
        assert!(json.contains("\"type\":\"control_request\""));
        assert!(json.contains("\"subtype\":\"set_permission_mode\""));
        assert!(json.contains("\"acceptEdits\""));
        let back: SDKControlRequest = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.request_id, req.request_id);
        match back.request {
            SDKControlRequestType::SetPermissionMode { mode } => {
                assert_eq!(mode, PermissionMode::AcceptEdits);
            }
            _ => panic!("Expected SetPermissionMode"),
        }
    }

    #[test]
    fn test_sdk_control_request_initialize_round_trip() {
        let req = SDKControlRequest::new(SDKControlRequestType::Initialize {
            hooks: Some(serde_json::json!({"pre_tool_use": []})),
        });
        let json = serde_json::to_string(&req).expect("serialize");
        let back: SDKControlRequest = serde_json::from_str(&json).expect("deserialize");
        match back.request {
            SDKControlRequestType::Initialize { hooks } => {
                assert!(hooks.is_some());
            }
            _ => panic!("Expected Initialize"),
        }
    }

    #[test]
    fn test_sdk_control_request_interrupt_round_trip() {
        let req = SDKControlRequest::new(SDKControlRequestType::Interrupt {});
        let json = serde_json::to_string(&req).expect("serialize");
        assert!(json.contains("\"subtype\":\"interrupt\""));
        let back: SDKControlRequest = serde_json::from_str(&json).expect("deserialize");
        assert!(matches!(back.request, SDKControlRequestType::Interrupt {}));
    }

    #[test]
    fn test_sdk_control_request_new_generates_unique_ids() {
        let r1 = SDKControlRequest::new(SDKControlRequestType::Interrupt {});
        let r2 = SDKControlRequest::new(SDKControlRequestType::Interrupt {});
        assert_ne!(r1.request_id, r2.request_id);
    }

    // ========================================================================
    // ControlResponseMessage round-trip
    // ========================================================================

    #[test]
    fn test_control_response_message_success_round_trip() {
        let msg = ControlResponseMessage::new(ControlResponseType::Success {
            request_id: "req-1".to_string(),
            response: Some(serde_json::json!({"ok": true})),
        });
        let json = serde_json::to_string(&msg).expect("serialize");
        assert!(json.contains("\"type\":\"control_response\""));
        assert!(json.contains("\"subtype\":\"success\""));
        let back: ControlResponseMessage = serde_json::from_str(&json).expect("deserialize");
        match back.response {
            ControlResponseType::Success { request_id, response } => {
                assert_eq!(request_id, "req-1");
                assert!(response.is_some());
            }
            _ => panic!("Expected Success"),
        }
    }

    #[test]
    fn test_control_response_message_error_round_trip() {
        let msg = ControlResponseMessage::new(ControlResponseType::Error {
            request_id: "req-2".to_string(),
            error: Some("permission denied".to_string()),
        });
        let json = serde_json::to_string(&msg).expect("serialize");
        assert!(json.contains("\"subtype\":\"error\""));
        let back: ControlResponseMessage = serde_json::from_str(&json).expect("deserialize");
        match back.response {
            ControlResponseType::Error { request_id, error } => {
                assert_eq!(request_id, "req-2");
                assert_eq!(error, Some("permission denied".to_string()));
            }
            _ => panic!("Expected Error"),
        }
    }

    // ========================================================================
    // PermissionResult serialization
    // ========================================================================

    #[test]
    fn test_permission_result_allow_uses_behavior_tag() {
        let result = PermissionResult::Allow {
            updated_input: serde_json::json!({"cmd": "ls"}),
            updated_permissions: None,
        };
        let json = serde_json::to_string(&result).expect("serialize");
        assert!(
            json.contains("\"behavior\":\"allow\""),
            "expected behavior:allow, got: {json}"
        );
    }

    #[test]
    fn test_permission_result_deny_uses_behavior_tag() {
        let result = PermissionResult::Deny {
            message: "Not allowed".to_string(),
            interrupt: Some(true),
        };
        let json = serde_json::to_string(&result).expect("serialize");
        assert!(
            json.contains("\"behavior\":\"deny\""),
            "expected behavior:deny, got: {json}"
        );
    }

    #[test]
    fn test_permission_result_allow_round_trip() {
        let original = PermissionResult::Allow {
            updated_input: serde_json::json!({"file": "/tmp/out"}),
            updated_permissions: Some(vec![PermissionUpdate {
                tool_name: "write_file".to_string(),
                tool_input: serde_json::json!({}),
                update_type: Some(PermissionUpdateType::Allow),
                destination: Some(PermissionUpdateDestination::LocalProject),
            }]),
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let back: PermissionResult = serde_json::from_str(&json).expect("deserialize");
        match back {
            PermissionResult::Allow { updated_permissions, .. } => {
                let perms = updated_permissions.expect("permissions present");
                assert_eq!(perms.len(), 1);
                assert_eq!(perms[0].tool_name, "write_file");
            }
            _ => panic!("Expected Allow"),
        }
    }

    // ========================================================================
    // PermissionMode Display
    // ========================================================================

    #[test]
    fn test_permission_mode_display() {
        assert_eq!(PermissionMode::Default.to_string(), "default");
        assert_eq!(PermissionMode::AcceptEdits.to_string(), "acceptEdits");
        assert_eq!(PermissionMode::Plan.to_string(), "plan");
        assert_eq!(PermissionMode::BypassPermissions.to_string(), "bypassPermissions");
    }

    #[test]
    fn test_permission_mode_serde_camel_case() {
        let json = serde_json::to_string(&PermissionMode::BypassPermissions).expect("serialize");
        assert_eq!(json, "\"bypassPermissions\"");
        let back: PermissionMode = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, PermissionMode::BypassPermissions);
    }

    // ========================================================================
    // Message helpers
    // ========================================================================

    #[test]
    fn test_message_new_user() {
        let msg = Message::new_user("Hello Claude!".to_string());
        let json = serde_json::to_string(&msg).expect("serialize");
        assert!(json.contains("\"type\":\"user\""));
        assert!(json.contains("Hello Claude!"));
        assert!(json.contains("\"role\":\"user\""));
    }

    #[test]
    fn test_message_new_user_round_trip() {
        let original = Message::new_user("do something".to_string());
        let json = serde_json::to_string(&original).expect("serialize");
        let back: Message = serde_json::from_str(&json).expect("deserialize");
        match back {
            Message::User { message } => {
                assert_eq!(message.content, "do something");
                assert_eq!(message.role, "user");
            }
        }
    }
}
