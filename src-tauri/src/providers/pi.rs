use std::path::Path;

use tauri::AppHandle;

use super::ProviderSessionResult;
use crate::db::AgentSessionRow;
use crate::pty_manager::PtyManager;

pub struct PiProvider {
    pub pty_mgr: PtyManager,
}

impl PiProvider {
    pub fn new(pty_mgr: PtyManager) -> Self {
        Self { pty_mgr }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn start(
        &self,
        task_id: &str,
        worktree_path: &Path,
        prompt: &str,
        _agent: Option<&str>,
        _permission_mode: Option<&str>,
        _model: Option<&crate::opencode_client::PromptModel>,
        app: &AppHandle,
    ) -> Result<ProviderSessionResult, String> {
        self.pty_mgr
            .spawn_pi_pty(
                task_id,
                worktree_path,
                prompt,
                None,
                false,
                80,
                24,
                app.clone(),
            )
            .await
            .map_err(|e| e.to_string())?;

        Ok(ProviderSessionResult {
            port: 0,
            opencode_session_id: None,
            pi_session_id: None,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn resume(
        &self,
        task_id: &str,
        session: &AgentSessionRow,
        worktree_path: &Path,
        prompt: Option<&str>,
        _agent: Option<&str>,
        _permission_mode: Option<&str>,
        _model: Option<&crate::opencode_client::PromptModel>,
        app: &AppHandle,
    ) -> Result<ProviderSessionResult, String> {
        let resume_session_id = session.pi_session_id.as_deref();
        let actual_prompt = prompt.unwrap_or("");
        let continue_session = resume_session_id.is_none();

        self.pty_mgr
            .spawn_pi_pty(
                task_id,
                worktree_path,
                actual_prompt,
                resume_session_id,
                continue_session,
                80,
                24,
                app.clone(),
            )
            .await
            .map_err(|e| e.to_string())?;

        Ok(ProviderSessionResult {
            port: 0,
            opencode_session_id: None,
            pi_session_id: resume_session_id.map(str::to_string),
        })
    }

    pub async fn abort(&self, task_id: &str, _session: &AgentSessionRow) -> Result<(), String> {
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
        "pi"
    }

    pub fn provider_session_id(&self, session: &AgentSessionRow) -> Option<String> {
        session.pi_session_id.clone()
    }

    pub fn list_commands(
        &self,
        project_path: Option<&str>,
    ) -> Vec<crate::opencode_client::CommandInfo> {
        use crate::command_discovery::{
            builtin_pi_commands, scan_prompt_templates_directory, scan_skills_directory,
        };
        use std::collections::HashMap;

        let mut commands_map = HashMap::<String, crate::opencode_client::CommandInfo>::new();

        for cmd in builtin_pi_commands() {
            commands_map.insert(cmd.name.clone(), cmd);
        }

        // User-level prompt templates and skills.
        if let Some(home) = dirs::home_dir() {
            for cmd in
                scan_prompt_templates_directory(&home.join(".pi").join("agent").join("prompts"))
            {
                commands_map.insert(cmd.name.clone(), cmd);
            }

            for (dir, source) in &[
                (home.join(".pi").join("agent").join("skills"), ".pi"),
                (home.join(".agents").join("skills"), ".agents"),
            ] {
                for skill in scan_skills_directory(dir, "user", source) {
                    commands_map
                        .entry(format!("skill:{}", skill.name))
                        .or_insert(crate::opencode_client::CommandInfo {
                            name: format!("skill:{}", skill.name),
                            description: skill.description,
                            source: Some("skill".to_string()),
                            agent: skill.agent,
                            extra: serde_json::Map::new(),
                        });
                }
            }
        }

        // Project-level prompt templates and skills.
        if let Some(proj_path) = project_path {
            let proj = std::path::Path::new(proj_path);
            for cmd in scan_prompt_templates_directory(&proj.join(".pi").join("prompts")) {
                commands_map.insert(cmd.name.clone(), cmd);
            }

            for (dir, source) in &[
                (proj.join(".pi").join("skills"), ".pi"),
                (proj.join(".agents").join("skills"), ".agents"),
            ] {
                for skill in scan_skills_directory(dir, "project", source) {
                    commands_map.insert(
                        format!("skill:{}", skill.name),
                        crate::opencode_client::CommandInfo {
                            name: format!("skill:{}", skill.name),
                            description: skill.description,
                            source: Some("skill".to_string()),
                            agent: skill.agent,
                            extra: serde_json::Map::new(),
                        },
                    );
                }
            }
        }

        let mut commands: Vec<_> = commands_map.into_values().collect();
        commands.sort_by(|a, b| a.name.cmp(&b.name));
        commands
    }

    pub fn list_agents(
        &self,
        _project_path: Option<&str>,
    ) -> Vec<crate::opencode_client::AgentInfo> {
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_session(pi_session_id: Option<&str>) -> AgentSessionRow {
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
            provider: "pi".to_string(),
            claude_session_id: None,
            pi_session_id: pi_session_id.map(str::to_string),
        }
    }

    #[test]
    fn provider_session_id_returns_stored_value() {
        let provider = PiProvider::new(PtyManager::new());
        let session = make_session(Some("session-123"));

        assert_eq!(
            provider.provider_session_id(&session),
            Some("session-123".to_string())
        );
    }

    #[test]
    fn provider_session_id_returns_none_when_absent() {
        let provider = PiProvider::new(PtyManager::new());
        let session = make_session(None);

        assert_eq!(provider.provider_session_id(&session), None);
    }

    #[test]
    fn list_commands_includes_builtin_pi_commands() {
        let provider = PiProvider::new(PtyManager::new());

        let commands = provider.list_commands(None);

        assert!(commands.iter().any(|cmd| {
            cmd.name == "model"
                && cmd.description.as_deref() == Some("Switch models")
                && cmd.source.as_deref() == Some("builtin")
        }));
        assert!(commands.iter().any(|cmd| cmd.name == "reload"));
    }

    #[test]
    fn list_commands_discovers_project_prompt_templates_and_skills() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path();
        let prompts = project.join(".pi").join("prompts");
        let skill = project.join(".pi").join("skills").join("release-notes");
        std::fs::create_dir_all(&prompts).unwrap();
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(
            prompts.join("review.md"),
            "---\ndescription: Review current changes\n---\nReview the code.",
        )
        .unwrap();
        std::fs::write(
            skill.join("SKILL.md"),
            "---\nname: release-notes\ndescription: Draft release notes\n---\n# Release notes",
        )
        .unwrap();

        let provider = PiProvider::new(PtyManager::new());
        let commands = provider.list_commands(project.to_str());

        assert!(commands.iter().any(|cmd| {
            cmd.name == "review"
                && cmd.description.as_deref() == Some("Review current changes")
                && cmd.source.as_deref() == Some("prompt")
        }));
        assert!(commands.iter().any(|cmd| {
            cmd.name == "skill:release-notes"
                && cmd.description.as_deref() == Some("Draft release notes")
                && cmd.source.as_deref() == Some("skill")
        }));
    }
}
