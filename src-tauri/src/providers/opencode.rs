use std::path::Path;
use tauri::AppHandle;

use crate::db::AgentSessionRow;
use crate::opencode_client::OpenCodeClient;
use crate::server_manager::ServerManager;
use crate::sse_bridge::SseBridgeManager;
use super::ProviderSessionResult;

pub struct OpenCodeProvider {
    pub server_mgr: ServerManager,
    pub sse_mgr: SseBridgeManager,
}

impl OpenCodeProvider {
    pub fn new(server_mgr: ServerManager, sse_mgr: SseBridgeManager) -> Self {
        Self { server_mgr, sse_mgr }
    }

    pub async fn start(
        &self,
        task_id: &str,
        worktree_path: &Path,
        prompt: &str,
        agent: Option<&str>,
        _permission_mode: Option<&str>,
        app: &AppHandle,
    ) -> Result<ProviderSessionResult, String> {
        let port = self.server_mgr
            .spawn_server(task_id, worktree_path)
            .await
            .map_err(|e| e.to_string())?;

        let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));

        let opencode_session_id = client
            .create_session(format!("Task {}", task_id))
            .await
            .map_err(|e| format!("Failed to create session: {}", e))?;

        self.sse_mgr
            .start_bridge(app.clone(), task_id.to_string(), Some(opencode_session_id.clone()), port)
            .await
            .map_err(|e| e.to_string())?;

        client
            .prompt_async(&opencode_session_id, prompt.to_string(), agent.map(str::to_string))
            .await
            .map_err(|e| format!("Failed to send prompt: {}", e))?;

        Ok(ProviderSessionResult {
            port,
            opencode_session_id: Some(opencode_session_id),
        })
    }

    pub async fn resume(
        &self,
        task_id: &str,
        session: &AgentSessionRow,
        worktree_path: &Path,
        prompt: Option<&str>,
        agent: Option<&str>,
        _permission_mode: Option<&str>,
        app: &AppHandle,
    ) -> Result<ProviderSessionResult, String> {
        match prompt {
            Some(action_prompt) => {
                let port = match self.server_mgr.get_server_port(task_id).await {
                    Some(p) => p,
                    None => self.server_mgr
                        .spawn_server(task_id, worktree_path)
                        .await
                        .map_err(|e| e.to_string())?,
                };

                let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));

                let opencode_session_id = match &session.opencode_session_id {
                    Some(sid) => sid.clone(),
                    None => client
                        .create_session(format!("Task {}", task_id))
                        .await
                        .map_err(|e| format!("Failed to create session: {}", e))?,
                };

                client
                    .prompt_async(&opencode_session_id, action_prompt.to_string(), agent.map(str::to_string))
                    .await
                    .map_err(|e| format!("Failed to send prompt: {}", e))?;

                match self.sse_mgr
                    .start_bridge(app.clone(), task_id.to_string(), Some(opencode_session_id.clone()), port)
                    .await
                {
                    Ok(_) => {}
                    Err(e) if e.to_string().contains("already running") => {}
                    Err(e) => return Err(e.to_string()),
                }

                Ok(ProviderSessionResult {
                    port,
                    opencode_session_id: Some(opencode_session_id),
                })
            }
            None => {
                let port = self.server_mgr
                    .spawn_server(task_id, worktree_path)
                    .await
                    .map_err(|e| e.to_string())?;

                self.sse_mgr
                    .start_bridge(app.clone(), task_id.to_string(), None, port)
                    .await
                    .map_err(|e| e.to_string())?;

                Ok(ProviderSessionResult {
                    port,
                    opencode_session_id: None,
                })
            }
        }
    }

    pub async fn abort(
        &self,
        task_id: &str,
        session: &AgentSessionRow,
    ) -> Result<(), String> {
        if let Some(port) = self.server_mgr.get_server_port(task_id).await {
            if let Some(ref opencode_session_id) = session.opencode_session_id {
                let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
                let _ = client.abort_session(opencode_session_id).await;
            }
        }

        self.sse_mgr.stop_bridge(task_id).await;
        let _ = self.server_mgr.stop_server(task_id).await;

        Ok(())
    }

    pub async fn cleanup(&self, task_id: &str) -> Result<(), String> {
        self.sse_mgr.stop_bridge(task_id).await;
        let _ = self.server_mgr.stop_server(task_id).await;
        Ok(())
    }

    pub fn provider_name(&self) -> &'static str {
        "opencode"
    }

    pub fn provider_session_id(&self, session: &AgentSessionRow) -> Option<String> {
        session.opencode_session_id.clone()
    }

    pub fn list_commands(&self, _project_path: Option<&str>) -> Vec<crate::opencode_client::CommandInfo> {
        vec![]
    }

    pub fn list_agents(&self, _project_path: Option<&str>) -> Vec<crate::opencode_client::AgentInfo> {
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::AgentSessionRow;

    fn make_session(opencode_session_id: Option<&str>) -> AgentSessionRow {
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
            provider: "opencode".to_string(),
            claude_session_id: None,
        }
    }

    #[test]
    fn test_provider_name() {
        let provider = OpenCodeProvider::new(
            crate::server_manager::ServerManager::new(),
            crate::sse_bridge::SseBridgeManager::new(),
        );
        assert_eq!(provider.provider_name(), "opencode");
    }

    #[test]
    fn test_provider_session_id_with_opencode_session() {
        let provider = OpenCodeProvider::new(
            crate::server_manager::ServerManager::new(),
            crate::sse_bridge::SseBridgeManager::new(),
        );
        let session = make_session(Some("oc-xyz789"));
        assert_eq!(
            provider.provider_session_id(&session),
            Some("oc-xyz789".to_string())
        );
    }

    #[test]
    fn test_provider_session_id_without_opencode_session() {
        let provider = OpenCodeProvider::new(
            crate::server_manager::ServerManager::new(),
            crate::sse_bridge::SseBridgeManager::new(),
        );
        let session = make_session(None);
        assert_eq!(provider.provider_session_id(&session), None);
    }
}
