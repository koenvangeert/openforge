use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

use crate::db::AgentSessionRow;
use crate::pty_manager::PtyManager;
use super::ProviderSessionResult;

pub struct ClaudeCodeProvider {
    pub pty_mgr: PtyManager,
    pub discovery_cache: Arc<Mutex<Option<crate::command_discovery::CachedDiscovery>>>,
}

impl ClaudeCodeProvider {
    pub fn new(pty_mgr: PtyManager) -> Self {
        Self {
            pty_mgr,
            discovery_cache: Arc::new(Mutex::new(None)),
        }
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
        // - Some(prompt) → caller sending new prompt, never use --continue
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

    pub fn list_commands(&self, project_path: Option<&str>) -> Vec<crate::opencode_client::CommandInfo> {
        let mut cache = self.discovery_cache.lock().unwrap();
        if let Some(ref cached) = *cache {
            return cached.commands.clone();
        }

        use std::collections::HashMap;
        use crate::command_discovery::{
            builtin_claude_commands, scan_commands_directory, scan_skills_directory,
            resolve_active_plugins, scan_plugin_commands, scan_plugin_agents,
        };

        let mut commands_map = HashMap::<String, crate::opencode_client::CommandInfo>::new();

        for cmd in builtin_claude_commands() {
            commands_map.insert(cmd.name.clone(), cmd);
        }

        let active_plugins = dirs::home_dir()
            .map(|home| resolve_active_plugins(&home))
            .unwrap_or_default();

        for cmd in scan_plugin_commands(&active_plugins) {
            commands_map.insert(cmd.name.clone(), cmd);
        }

        // User-level commands
        if let Some(home) = dirs::home_dir() {
            for commands_dir in &[
                home.join(".claude").join("commands"),
                home.join(".opencode").join("commands"),
            ] {
                for cmd in scan_commands_directory(commands_dir) {
                    commands_map.insert(cmd.name.clone(), cmd);
                }
            }
        }

        // Project-level commands
        if let Some(proj_path) = project_path {
            let proj = std::path::Path::new(proj_path);
            for commands_dir in &[
                proj.join(".claude").join("commands"),
                proj.join(".opencode").join("commands"),
            ] {
                for cmd in scan_commands_directory(commands_dir) {
                    commands_map.insert(cmd.name.clone(), cmd);
                }
            }
        }

        // User-level skills
        if let Some(home) = dirs::home_dir() {
            for (dir, source) in &[
                (home.join(".agents").join("skills"), ".agents"),
                (home.join(".claude").join("skills"), ".claude"),
                (home.join(".opencode").join("skills"), ".opencode"),
            ] {
                for skill in scan_skills_directory(dir, "user", source) {
                    commands_map.entry(skill.name.clone()).or_insert(crate::opencode_client::CommandInfo {
                        name: skill.name,
                        description: skill.description,
                        source: Some("skill".to_string()),
                        agent: skill.agent,
                        extra: serde_json::Map::new(),
                    });
                }
            }
        }

        // Project-level skills
        if let Some(proj_path) = project_path {
            let proj = std::path::Path::new(proj_path);
            for (dir, source) in &[
                (proj.join(".agents").join("skills"), ".agents"),
                (proj.join(".claude").join("skills"), ".claude"),
                (proj.join(".opencode").join("skills"), ".opencode"),
            ] {
                for skill in scan_skills_directory(dir, "project", source) {
                    commands_map.insert(skill.name.clone(), crate::opencode_client::CommandInfo {
                        name: skill.name,
                        description: skill.description,
                        source: Some("skill".to_string()),
                        agent: skill.agent,
                        extra: serde_json::Map::new(),
                    });
                }
            }
        }

        let mut commands: Vec<_> = commands_map.into_values().collect();
        commands.sort_by(|a, b| a.name.cmp(&b.name));

        let mut agents = scan_plugin_agents(&active_plugins);
        agents.sort_by(|a, b| a.name.cmp(&b.name));

        let result = commands.clone();
        *cache = Some(crate::command_discovery::CachedDiscovery { commands, agents });
        result
    }

    pub fn list_agents(&self, project_path: Option<&str>) -> Vec<crate::opencode_client::AgentInfo> {
        // Populate cache via list_commands (which scans both commands and agents together),
        // then return agents from the now-populated cache.
        let _ = self.list_commands(project_path);
        let cache = self.discovery_cache.lock().unwrap();
        cache.as_ref().map(|c| c.agents.clone()).unwrap_or_default()
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

    #[test]
    fn test_list_commands_cache_populated_on_first_call() {
        let provider = ClaudeCodeProvider::new(PtyManager::new());

        assert!(provider.discovery_cache.lock().unwrap().is_none());

        let first_result = provider.list_commands(None);
        assert!(!first_result.is_empty(), "built-in commands should always be present");

        assert!(provider.discovery_cache.lock().unwrap().is_some());

        let second_result = provider.list_commands(None);
        assert_eq!(first_result.len(), second_result.len());
    }

    #[test]
    fn test_list_agents_shares_cache_with_list_commands() {
        let provider = ClaudeCodeProvider::new(PtyManager::new());

        let _commands = provider.list_commands(None);
        assert!(provider.discovery_cache.lock().unwrap().is_some());

        let agents = provider.list_agents(None);

        let cache = provider.discovery_cache.lock().unwrap();
        let cached = cache.as_ref().unwrap();
        assert_eq!(agents.len(), cached.agents.len());
    }
}
