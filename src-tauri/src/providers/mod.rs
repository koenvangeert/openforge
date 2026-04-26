pub mod claude_code;
pub mod opencode;
pub mod pi;

use std::path::Path;
use tauri::AppHandle;

use crate::db::AgentSessionRow;
use claude_code::ClaudeCodeProvider;
use opencode::OpenCodeProvider;
use pi::PiProvider;

// ============================================================================
// Shared Types
// ============================================================================

/// Result returned by provider `start` and `resume` methods
#[derive(Debug, Clone)]
pub struct ProviderSessionResult {
    /// The port the provider session is listening on (0 if not applicable)
    pub port: u16,
    pub opencode_session_id: Option<String>,
    pub pi_session_id: Option<String>,
    pub pty_instance_id: Option<u64>,
}

// ============================================================================
// Provider Enum (enum dispatch — no dyn Trait, no async-trait)
// ============================================================================

/// Unified provider enum. Add a new variant here when adding a new provider.
pub enum Provider {
    ClaudeCode(ClaudeCodeProvider),
    OpenCode(OpenCodeProvider),
    Pi(PiProvider),
}

impl Provider {
    /// Construct a `Provider` from the provider name string stored in the DB.
    ///
    /// Returns `Err` if the name is unrecognised.
    pub fn from_name(
        name: &str,
        pty_mgr: crate::pty_manager::PtyManager,
        server_mgr: crate::server_manager::ServerManager,
        sse_mgr: crate::sse_bridge::SseBridgeManager,
    ) -> Result<Self, String> {
        match name {
            "claude-code" => Ok(Provider::ClaudeCode(ClaudeCodeProvider::new(pty_mgr))),
            "opencode" => Ok(Provider::OpenCode(OpenCodeProvider::new(
                server_mgr, sse_mgr,
            ))),
            "pi" => Ok(Provider::Pi(PiProvider::new(pty_mgr))),
            other => Err(format!("Unknown provider: {}", other)),
        }
    }

    // ------------------------------------------------------------------
    // Delegating methods — each arm calls the inner type's method
    // ------------------------------------------------------------------

    /// Start a new provider session in the given worktree with a prompt.
    #[allow(clippy::too_many_arguments)]
    pub async fn start(
        &self,
        task_id: &str,
        worktree_path: &Path,
        prompt: &str,
        agent: Option<&str>,
        permission_mode: Option<&str>,
        model: Option<&crate::opencode_client::PromptModel>,
        app: &AppHandle,
    ) -> Result<ProviderSessionResult, String> {
        match self {
            Provider::ClaudeCode(p) => {
                p.start(
                    task_id,
                    worktree_path,
                    prompt,
                    agent,
                    permission_mode,
                    model,
                    app,
                )
                .await
            }
            Provider::OpenCode(p) => {
                p.start(
                    task_id,
                    worktree_path,
                    prompt,
                    agent,
                    permission_mode,
                    model,
                    app,
                )
                .await
            }
            Provider::Pi(p) => {
                p.start(
                    task_id,
                    worktree_path,
                    prompt,
                    agent,
                    permission_mode,
                    model,
                    app,
                )
                .await
            }
        }
    }

    /// Resume an existing session (used at startup to re-attach to in-progress agents).
    #[allow(clippy::too_many_arguments)]
    pub async fn resume(
        &self,
        task_id: &str,
        session: &AgentSessionRow,
        worktree_path: &Path,
        prompt: Option<&str>,
        agent: Option<&str>,
        permission_mode: Option<&str>,
        model: Option<&crate::opencode_client::PromptModel>,
        app: &AppHandle,
    ) -> Result<ProviderSessionResult, String> {
        match self {
            Provider::ClaudeCode(p) => {
                p.resume(
                    task_id,
                    session,
                    worktree_path,
                    prompt,
                    agent,
                    permission_mode,
                    model,
                    app,
                )
                .await
            }
            Provider::OpenCode(p) => {
                p.resume(
                    task_id,
                    session,
                    worktree_path,
                    prompt,
                    agent,
                    permission_mode,
                    model,
                    app,
                )
                .await
            }
            Provider::Pi(p) => {
                p.resume(
                    task_id,
                    session,
                    worktree_path,
                    prompt,
                    agent,
                    permission_mode,
                    model,
                    app,
                )
                .await
            }
        }
    }

    /// Abort a running session.
    pub async fn abort(&self, task_id: &str, session: &AgentSessionRow) -> Result<(), String> {
        match self {
            Provider::ClaudeCode(p) => p.abort(task_id, session).await,
            Provider::OpenCode(p) => p.abort(task_id, session).await,
            Provider::Pi(p) => p.abort(task_id, session).await,
        }
    }

    /// Clean up resources (called during shutdown or after the session ends).
    pub async fn cleanup(&self, task_id: &str) -> Result<(), String> {
        match self {
            Provider::ClaudeCode(p) => p.cleanup(task_id).await,
            Provider::OpenCode(p) => p.cleanup(task_id).await,
            Provider::Pi(p) => p.cleanup(task_id).await,
        }
    }

    /// Provider name used for DB storage (`"claude-code"` or `"opencode"`).
    pub fn provider_name(&self) -> &'static str {
        match self {
            Provider::ClaudeCode(p) => p.provider_name(),
            Provider::OpenCode(p) => p.provider_name(),
            Provider::Pi(p) => p.provider_name(),
        }
    }

    /// Extract the provider-specific session ID from the DB row.
    pub fn provider_session_id(&self, session: &AgentSessionRow) -> Option<String> {
        match self {
            Provider::ClaudeCode(p) => p.provider_session_id(session),
            Provider::OpenCode(p) => p.provider_session_id(session),
            Provider::Pi(p) => p.provider_session_id(session),
        }
    }

    /// List available commands for the project (provider-specific discovery).
    pub fn list_commands(
        &self,
        project_path: Option<&str>,
    ) -> Vec<crate::opencode_client::CommandInfo> {
        match self {
            Provider::ClaudeCode(p) => p.list_commands(project_path),
            Provider::OpenCode(p) => p.list_commands(project_path),
            Provider::Pi(p) => p.list_commands(project_path),
        }
    }

    /// List available agents for the project (provider-specific discovery).
    pub fn list_agents(
        &self,
        project_path: Option<&str>,
    ) -> Vec<crate::opencode_client::AgentInfo> {
        match self {
            Provider::ClaudeCode(p) => p.list_agents(project_path),
            Provider::OpenCode(p) => p.list_agents(project_path),
            Provider::Pi(p) => p.list_agents(project_path),
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::AgentSessionRow;
    use crate::providers::pi::PiProvider;

    fn make_session(
        claude_session_id: Option<&str>,
        opencode_session_id: Option<&str>,
        pi_session_id: Option<&str>,
        provider: &str,
    ) -> AgentSessionRow {
        AgentSessionRow {
            id: "session-1".to_string(),
            ticket_id: "T-001".to_string(),
            opencode_session_id: opencode_session_id.map(str::to_string),
            stage: "implementing".to_string(),
            status: "running".to_string(),
            checkpoint_data: None,
            error_message: None,
            created_at: 0,
            updated_at: 0,
            provider: provider.to_string(),
            claude_session_id: claude_session_id.map(str::to_string),
            pi_session_id: pi_session_id.map(str::to_string),
        }
    }

    #[test]
    fn test_provider_session_result_pi_session_id() {
        let result = ProviderSessionResult {
            port: 0,
            opencode_session_id: None,
            pi_session_id: Some("pi-session-123".to_string()),
            pty_instance_id: None,
        };

        assert_eq!(result.pi_session_id, Some("pi-session-123".to_string()));
    }

    // ------------------------------------------------------------------
    // ClaudeCodeProvider tests
    // ------------------------------------------------------------------

    #[test]
    fn test_claude_code_provider_name() {
        let provider = ClaudeCodeProvider::new(crate::pty_manager::PtyManager::new());
        assert_eq!(provider.provider_name(), "claude-code");
    }

    #[test]
    fn test_claude_code_provider_session_id_some() {
        let provider = ClaudeCodeProvider::new(crate::pty_manager::PtyManager::new());
        let session = make_session(Some("claude-abc123"), None, None, "claude-code");
        assert_eq!(
            provider.provider_session_id(&session),
            Some("claude-abc123".to_string())
        );
    }

    #[test]
    fn test_claude_code_provider_session_id_none() {
        let provider = ClaudeCodeProvider::new(crate::pty_manager::PtyManager::new());
        let session = make_session(None, None, None, "claude-code");
        assert_eq!(provider.provider_session_id(&session), None);
    }

    // ------------------------------------------------------------------
    // OpenCodeProvider tests
    // ------------------------------------------------------------------

    #[test]
    fn test_opencode_provider_name() {
        let provider = OpenCodeProvider::new(
            crate::server_manager::ServerManager::new(),
            crate::sse_bridge::SseBridgeManager::new(),
        );
        assert_eq!(provider.provider_name(), "opencode");
    }

    #[test]
    fn test_opencode_provider_session_id_some() {
        let provider = OpenCodeProvider::new(
            crate::server_manager::ServerManager::new(),
            crate::sse_bridge::SseBridgeManager::new(),
        );
        let session = make_session(None, Some("oc-xyz789"), None, "opencode");
        assert_eq!(
            provider.provider_session_id(&session),
            Some("oc-xyz789".to_string())
        );
    }

    #[test]
    fn test_opencode_provider_session_id_none() {
        let provider = OpenCodeProvider::new(
            crate::server_manager::ServerManager::new(),
            crate::sse_bridge::SseBridgeManager::new(),
        );
        let session = make_session(None, None, None, "opencode");
        assert_eq!(provider.provider_session_id(&session), None);
    }

    // ------------------------------------------------------------------
    // PiProvider tests
    // ------------------------------------------------------------------

    #[test]
    fn test_pi_provider_name() {
        let provider = PiProvider::new(crate::pty_manager::PtyManager::new());
        assert_eq!(provider.provider_name(), "pi");
    }

    #[test]
    fn test_pi_provider_session_id() {
        let provider = PiProvider::new(crate::pty_manager::PtyManager::new());
        let session = make_session(None, None, Some("pi-session-123"), "pi");
        assert_eq!(
            provider.provider_session_id(&session),
            Some("pi-session-123".to_string())
        );
    }

    // ------------------------------------------------------------------
    // Provider enum dispatch tests
    // ------------------------------------------------------------------

    #[test]
    fn test_provider_enum_claude_code_name() {
        let p = Provider::ClaudeCode(ClaudeCodeProvider::new(
            crate::pty_manager::PtyManager::new(),
        ));
        assert_eq!(p.provider_name(), "claude-code");
    }

    #[test]
    fn test_provider_enum_opencode_name() {
        let p = Provider::OpenCode(OpenCodeProvider::new(
            crate::server_manager::ServerManager::new(),
            crate::sse_bridge::SseBridgeManager::new(),
        ));
        assert_eq!(p.provider_name(), "opencode");
    }

    #[test]
    fn test_provider_enum_claude_code_session_id() {
        let p = Provider::ClaudeCode(ClaudeCodeProvider::new(
            crate::pty_manager::PtyManager::new(),
        ));
        let session = make_session(Some("claude-abc"), None, None, "claude-code");
        assert_eq!(
            p.provider_session_id(&session),
            Some("claude-abc".to_string())
        );
    }

    #[test]
    fn test_provider_enum_opencode_session_id() {
        let p = Provider::OpenCode(OpenCodeProvider::new(
            crate::server_manager::ServerManager::new(),
            crate::sse_bridge::SseBridgeManager::new(),
        ));
        let session = make_session(None, Some("oc-abc"), None, "opencode");
        assert_eq!(p.provider_session_id(&session), Some("oc-abc".to_string()));
    }

    #[test]
    fn test_provider_enum_pi_name() {
        let p = Provider::Pi(PiProvider::new(crate::pty_manager::PtyManager::new()));
        assert_eq!(p.provider_name(), "pi");
    }

    #[test]
    fn test_provider_enum_pi_session_id() {
        let p = Provider::Pi(PiProvider::new(crate::pty_manager::PtyManager::new()));
        let session = make_session(None, None, Some("pi-abc"), "pi");
        assert_eq!(p.provider_session_id(&session), Some("pi-abc".to_string()));
    }

    #[test]
    fn test_from_name_claude_code() {
        let result = Provider::from_name(
            "claude-code",
            crate::pty_manager::PtyManager::new(),
            crate::server_manager::ServerManager::new(),
            crate::sse_bridge::SseBridgeManager::new(),
        );
        assert!(result.is_ok());
        assert_eq!(result.unwrap().provider_name(), "claude-code");
    }

    #[test]
    fn test_from_name_opencode() {
        let result = Provider::from_name(
            "opencode",
            crate::pty_manager::PtyManager::new(),
            crate::server_manager::ServerManager::new(),
            crate::sse_bridge::SseBridgeManager::new(),
        );
        assert!(result.is_ok());
        assert_eq!(result.unwrap().provider_name(), "opencode");
    }

    #[test]
    fn test_pi_provider_from_name() {
        let result = Provider::from_name(
            "pi",
            crate::pty_manager::PtyManager::new(),
            crate::server_manager::ServerManager::new(),
            crate::sse_bridge::SseBridgeManager::new(),
        );
        assert!(result.is_ok());
        assert_eq!(result.unwrap().provider_name(), "pi");
    }

    #[test]
    fn test_from_name_unknown() {
        let result = Provider::from_name(
            "unknown-provider",
            crate::pty_manager::PtyManager::new(),
            crate::server_manager::ServerManager::new(),
            crate::sse_bridge::SseBridgeManager::new(),
        );
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("Unknown provider"));
    }

    #[test]
    fn test_provider_enum_list_commands_claude_code() {
        let p = Provider::ClaudeCode(ClaudeCodeProvider::new(
            crate::pty_manager::PtyManager::new(),
        ));
        let commands = p.list_commands(None);
        let command_names: std::collections::HashSet<_> = commands
            .iter()
            .map(|command| command.name.as_str())
            .collect();

        for builtin in crate::command_discovery::builtin_claude_commands() {
            assert!(
                command_names.contains(builtin.name.as_str()),
                "missing built-in command '{}'",
                builtin.name
            );
        }
    }

    #[test]
    fn test_provider_enum_list_agents_claude_code() {
        let p = Provider::ClaudeCode(ClaudeCodeProvider::new(
            crate::pty_manager::PtyManager::new(),
        ));
        let agents = p.list_agents(None);
        let _ = agents;
    }

    #[test]
    fn test_provider_enum_list_commands_opencode() {
        let p = Provider::OpenCode(OpenCodeProvider::new(
            crate::server_manager::ServerManager::new(),
            crate::sse_bridge::SseBridgeManager::new(),
        ));
        let commands = p.list_commands(None);
        assert!(
            commands.is_empty(),
            "OpenCode list_commands should return empty vec"
        );
    }

    #[test]
    fn test_provider_enum_list_agents_opencode() {
        let p = Provider::OpenCode(OpenCodeProvider::new(
            crate::server_manager::ServerManager::new(),
            crate::sse_bridge::SseBridgeManager::new(),
        ));
        let agents = p.list_agents(None);
        assert!(
            agents.is_empty(),
            "OpenCode list_agents should return empty vec"
        );
    }
}
