use std::path::Path;
use tauri::AppHandle;

use crate::db::AgentSessionRow;
use crate::pty_manager::PtyManager;
use super::ProviderSessionResult;

pub struct ClaudeCodeProvider {
    pub pty_mgr: PtyManager,
}

impl ClaudeCodeProvider {
    pub fn new(pty_mgr: PtyManager) -> Self {
        Self { pty_mgr }
    }

    pub async fn start(
        &self,
        task_id: &str,
        worktree_path: &Path,
        prompt: &str,
        _agent: Option<&str>,
        permission_mode: Option<&str>,
        app: &AppHandle,
    ) -> Result<ProviderSessionResult, String> {
        let port = crate::claude_hooks::get_http_server_port();
        let hooks_path = crate::claude_hooks::generate_hooks_settings(port)
            .map_err(|e| e.to_string())?;

        self.pty_mgr
            .spawn_claude_pty(
                task_id,
                worktree_path,
                prompt,
                None,
                false,
                &hooks_path,
                permission_mode,
                80,
                24,
                app.clone(),
            )
            .await
            .map_err(|e| e.to_string())?;

        Ok(ProviderSessionResult { port: 0, opencode_session_id: None })
    }

    pub async fn resume(
        &self,
        task_id: &str,
        session: &AgentSessionRow,
        worktree_path: &Path,
        prompt: Option<&str>,
        _agent: Option<&str>,
        permission_mode: Option<&str>,
        app: &AppHandle,
    ) -> Result<ProviderSessionResult, String> {
        let port = crate::claude_hooks::get_http_server_port();
        let hooks_path = crate::claude_hooks::generate_hooks_settings(port)
            .map_err(|e| e.to_string())?;

        let resume_id = session.claude_session_id.as_deref();

        // Distinguish between two contexts:
        // - Some(prompt) → run_action: user sending new prompt, never use --continue
        // - None → startup resume: resume in-progress session, use --continue if no session ID
        let (actual_prompt, use_continue) = match prompt {
            Some(p) => (p, false),
            None => ("", resume_id.is_none()),
        };

        self.pty_mgr
            .spawn_claude_pty(
                task_id,
                worktree_path,
                actual_prompt,
                resume_id,
                use_continue,
                &hooks_path,
                permission_mode,
                80,
                24,
                app.clone(),
            )
            .await
            .map_err(|e| e.to_string())?;

        Ok(ProviderSessionResult { port: 0, opencode_session_id: None })
    }

    pub async fn abort(
        &self,
        task_id: &str,
        _session: &AgentSessionRow,
    ) -> Result<(), String> {
        self.pty_mgr
            .kill_pty(task_id)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn cleanup(&self, task_id: &str) -> Result<(), String> {
        self.pty_mgr
            .kill_pty(task_id)
            .await
            .map_err(|e| e.to_string())
    }

    pub fn provider_name(&self) -> &'static str {
        "claude-code"
    }

    pub fn provider_session_id(&self, session: &AgentSessionRow) -> Option<String> {
        session.claude_session_id.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::AgentSessionRow;

    fn make_session(claude_session_id: Option<&str>) -> AgentSessionRow {
        AgentSessionRow {
            id: "session-1".to_string(),
            ticket_id: "T-001".to_string(),
            opencode_session_id: None,
            stage: "implementing".to_string(),
            status: "running".to_string(),
            checkpoint_data: None,
            error_message: None,
            created_at: 0,
            updated_at: 0,
            provider: "claude-code".to_string(),
            claude_session_id: claude_session_id.map(str::to_string),
        }
    }

    #[test]
    fn test_provider_name() {
        let provider = ClaudeCodeProvider::new(PtyManager::new());
        assert_eq!(provider.provider_name(), "claude-code");
    }

    #[test]
    fn test_provider_session_id_with_claude_session() {
        let provider = ClaudeCodeProvider::new(PtyManager::new());
        let session = make_session(Some("claude-abc123"));
        assert_eq!(
            provider.provider_session_id(&session),
            Some("claude-abc123".to_string())
        );
    }

    #[test]
    fn test_provider_session_id_without_claude_session() {
        let provider = ClaudeCodeProvider::new(PtyManager::new());
        let session = make_session(None);
        assert_eq!(provider.provider_session_id(&session), None);
    }
}
