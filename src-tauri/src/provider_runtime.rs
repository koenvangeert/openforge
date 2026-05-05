use crate::command_discovery::{
    find_skill_source_dir, is_supported_skill_source_dir, scan_skill_directories_for_root,
    search_project_files, skill_source_dir, GENERIC_SKILLS_SOURCE_DIR,
};
use crate::db;
use crate::opencode_client::{
    AgentInfo, CommandInfo, OpenCodeClient, ProviderModelInfo, SkillInfo,
};
use crate::providers::{claude_code::ClaudeCodeProvider, pi::PiProvider};
use crate::server_manager::{discovery_server_task_id, ServerManager};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProjectRuntimeContext {
    pub(crate) provider: String,
    pub(crate) project_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AbortSessionPolicy {
    pub(crate) session_status: &'static str,
    pub(crate) update_worktree_status: bool,
    pub(crate) update_task_workspace_status: bool,
    pub(crate) ignore_unknown_provider: bool,
}

pub(crate) struct SessionOutputContext {
    pub(crate) opencode_session_id: String,
    pub(crate) workspace_path: Option<String>,
}

pub(crate) fn load_project_runtime_context(
    db: &db::Database,
    project_id: &str,
) -> Result<ProjectRuntimeContext, String> {
    let provider = db.resolve_ai_provider(project_id);
    let project_path = db
        .get_project(project_id)
        .map_err(|e| format!("Failed to get project: {e}"))?
        .map(|project| project.path);

    Ok(ProjectRuntimeContext {
        provider,
        project_path,
    })
}

pub(crate) async fn ensure_project_discovery_server(
    server_manager: Option<&ServerManager>,
    project_id: &str,
    context: &ProjectRuntimeContext,
) -> Result<Option<u16>, String> {
    if context.provider != "opencode" {
        return Ok(None);
    }

    let server_manager =
        server_manager.ok_or_else(|| "Server manager is not available".to_string())?;
    let discovery_task_id = discovery_server_task_id(project_id);
    if let Some(port) = server_manager.get_server_port(&discovery_task_id).await {
        return Ok(Some(port));
    }

    let Some(project_path) = context.project_path.as_deref() else {
        return Ok(None);
    };

    server_manager
        .spawn_server(&discovery_task_id, Path::new(project_path))
        .await
        .map(Some)
        .map_err(|e| format!("Failed to start discovery server: {e}"))
}

pub(crate) fn provider_commands(
    provider: &str,
    project_path: Option<&str>,
) -> Option<Vec<CommandInfo>> {
    match provider {
        "pi" => {
            Some(PiProvider::new(crate::pty_manager::PtyManager::new()).list_commands(project_path))
        }
        "claude-code" => Some(
            ClaudeCodeProvider::new(crate::pty_manager::PtyManager::new())
                .list_commands(project_path),
        ),
        _ => None,
    }
}

pub(crate) fn provider_agents(
    provider: &str,
    project_path: Option<&str>,
) -> Option<Vec<AgentInfo>> {
    match provider {
        "pi" => {
            Some(PiProvider::new(crate::pty_manager::PtyManager::new()).list_agents(project_path))
        }
        "claude-code" => Some(
            ClaudeCodeProvider::new(crate::pty_manager::PtyManager::new())
                .list_agents(project_path),
        ),
        _ => None,
    }
}

pub(crate) async fn list_runtime_commands(
    server_manager: Option<&ServerManager>,
    project_id: &str,
    context: &ProjectRuntimeContext,
) -> Result<Vec<CommandInfo>, String> {
    if let Some(commands) = provider_commands(&context.provider, context.project_path.as_deref()) {
        return Ok(commands);
    }

    let Some(port) = ensure_project_discovery_server(server_manager, project_id, context).await?
    else {
        return Ok(Vec::new());
    };

    OpenCodeClient::with_base_url(format!("http://127.0.0.1:{port}"))
        .list_commands()
        .await
        .map_err(|e| format!("Failed to list commands: {e}"))
}

pub(crate) async fn search_runtime_files(
    server_manager: Option<&ServerManager>,
    project_id: &str,
    context: &ProjectRuntimeContext,
    query: &str,
) -> Result<Vec<String>, String> {
    if matches!(context.provider.as_str(), "claude-code" | "pi") {
        return Ok(context
            .project_path
            .as_deref()
            .map(|path| search_project_files(path, query, 10))
            .unwrap_or_default());
    }

    let Some(port) = ensure_project_discovery_server(server_manager, project_id, context).await?
    else {
        return Ok(Vec::new());
    };

    OpenCodeClient::with_base_url(format!("http://127.0.0.1:{port}"))
        .find_files(query, true, 10)
        .await
        .map_err(|e| format!("Failed to search files: {e}"))
}

pub(crate) async fn list_runtime_agents(
    server_manager: Option<&ServerManager>,
    project_id: &str,
    context: &ProjectRuntimeContext,
) -> Result<Vec<AgentInfo>, String> {
    if let Some(agents) = provider_agents(&context.provider, context.project_path.as_deref()) {
        return Ok(agents);
    }

    let Some(port) = ensure_project_discovery_server(server_manager, project_id, context).await?
    else {
        return Ok(Vec::new());
    };

    OpenCodeClient::with_base_url(format!("http://127.0.0.1:{port}"))
        .list_agents()
        .await
        .map_err(|e| format!("Failed to list agents: {e}"))
}

pub(crate) async fn list_runtime_models(
    server_manager: Option<&ServerManager>,
    project_id: &str,
    context: &ProjectRuntimeContext,
) -> Result<Vec<ProviderModelInfo>, String> {
    let Some(port) = ensure_project_discovery_server(server_manager, project_id, context).await?
    else {
        return Ok(Vec::new());
    };

    OpenCodeClient::with_base_url(format!("http://127.0.0.1:{port}"))
        .list_providers()
        .await
        .map_err(|e| format!("Failed to list models: {e}"))
}

fn skill_info_from_api_command(command: CommandInfo, project_path: Option<&str>) -> SkillInfo {
    let template = command
        .extra
        .get("template")
        .and_then(|value| value.as_str())
        .map(str::to_string);

    let (level, source_dir) = if let Some(project_path) = project_path {
        let project_path = Path::new(project_path);
        if let Some(source_dir) = find_skill_source_dir(project_path, &command.name) {
            ("project".to_string(), source_dir.to_string())
        } else if let Some(source_dir) = dirs::home_dir()
            .as_deref()
            .and_then(|home| find_skill_source_dir(home, &command.name))
        {
            ("user".to_string(), source_dir.to_string())
        } else {
            ("user".to_string(), GENERIC_SKILLS_SOURCE_DIR.to_string())
        }
    } else {
        ("user".to_string(), GENERIC_SKILLS_SOURCE_DIR.to_string())
    };

    SkillInfo {
        name: command.name,
        description: command.description,
        agent: command.agent,
        template,
        level,
        source_dir,
    }
}

pub(crate) async fn list_runtime_skills(
    server_manager: Option<&ServerManager>,
    project_id: &str,
    context: &ProjectRuntimeContext,
) -> Result<Vec<SkillInfo>, String> {
    let mut skills_map = HashMap::<String, SkillInfo>::new();

    if let Some(port) = ensure_project_discovery_server(server_manager, project_id, context).await?
    {
        let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{port}"));
        if let Ok(commands) = client.list_commands().await {
            for command in commands {
                if command.source.as_deref() != Some("skill") {
                    continue;
                }
                let skill = skill_info_from_api_command(command, context.project_path.as_deref());
                skills_map.insert(skill.name.clone(), skill);
            }
        }
    }

    if let Some(project_path) = context.project_path.as_deref() {
        for skill in scan_skill_directories_for_root(Path::new(project_path), "project") {
            skills_map.entry(skill.name.clone()).or_insert(skill);
        }
    }

    if let Some(home) = dirs::home_dir() {
        for skill in scan_skill_directories_for_root(&home, "user") {
            skills_map.entry(skill.name.clone()).or_insert(skill);
        }
    }

    let mut skills: Vec<_> = skills_map.into_values().collect();
    skills.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(skills)
}

pub(crate) fn save_skill_content(
    db: &db::Database,
    project_id: &str,
    skill_name: &str,
    level: &str,
    source_dir: &str,
    content: &str,
) -> Result<(), String> {
    if !is_supported_skill_source_dir(source_dir) {
        return Err(format!("Unsupported skill source directory: {source_dir}"));
    }

    let skill_root = if level == "project" {
        PathBuf::from(
            db.get_project(project_id)
                .map_err(|e| format!("Failed to get project: {e}"))?
                .map(|project| project.path)
                .ok_or_else(|| "Project not found".to_string())?,
        )
    } else {
        dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?
    };

    let skill_dir = skill_source_dir(&skill_root, source_dir).join(skill_name);
    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create skill directory: {e}"))?;
    std::fs::write(skill_dir.join("SKILL.md"), content)
        .map_err(|e| format!("Failed to write skill file: {e}"))?;

    Ok(())
}

pub(crate) fn legacy_worktree_from_task_workspace(
    workspace: db::TaskWorkspaceRow,
) -> db::WorktreeRow {
    db::WorktreeRow {
        id: workspace.id,
        task_id: workspace.task_id,
        project_id: workspace.project_id,
        repo_path: workspace.repo_path,
        worktree_path: workspace.workspace_path,
        branch_name: workspace.branch_name.unwrap_or_default(),
        opencode_port: workspace.opencode_port,
        opencode_pid: None,
        status: workspace.status,
        created_at: workspace.created_at,
        updated_at: workspace.updated_at,
    }
}

pub(crate) fn task_workspace_from_legacy(
    workspace: db::WorktreeRow,
    provider_name: String,
) -> db::TaskWorkspaceRow {
    db::TaskWorkspaceRow {
        id: workspace.id,
        task_id: workspace.task_id,
        project_id: workspace.project_id,
        workspace_path: workspace.worktree_path,
        repo_path: workspace.repo_path,
        kind: "git_worktree".to_string(),
        branch_name: Some(workspace.branch_name),
        provider_name,
        opencode_port: workspace.opencode_port,
        status: workspace.status,
        created_at: workspace.created_at,
        updated_at: workspace.updated_at,
    }
}

pub(crate) fn get_worktree_for_task(
    db: &db::Database,
    task_id: &str,
) -> Result<Option<db::WorktreeRow>, String> {
    if let Some(worktree) = db
        .get_worktree_for_task(task_id)
        .map_err(|e| format!("Failed to get worktree for task: {e}"))?
    {
        return Ok(Some(worktree));
    }

    let workspace = db
        .get_task_workspace_for_task(task_id)
        .map_err(|e| format!("Failed to get task workspace for task: {e}"))?;
    Ok(workspace.map(legacy_worktree_from_task_workspace))
}

pub(crate) fn get_task_workspace(
    db: &db::Database,
    task_id: &str,
) -> Result<Option<db::TaskWorkspaceRow>, String> {
    if let Some(workspace) = db
        .get_task_workspace_for_task(task_id)
        .map_err(|e| format!("Failed to get task workspace for task: {e}"))?
    {
        return Ok(Some(workspace));
    }

    let provider_name = db
        .get_latest_session_for_ticket(task_id)
        .map_err(|e| format!("Failed to get latest session for task workspace fallback: {e}"))?
        .map(|session| session.provider)
        .unwrap_or_else(|| "unknown".to_string());

    let worktree = db
        .get_worktree_for_task(task_id)
        .map_err(|e| format!("Failed to get worktree for task workspace fallback: {e}"))?;
    Ok(worktree.map(|workspace| task_workspace_from_legacy(workspace, provider_name)))
}

pub(crate) fn app_invoke_abort_session_policy(provider: &str) -> AbortSessionPolicy {
    AbortSessionPolicy {
        session_status: if matches!(provider, "claude-code" | "pi") {
            "interrupted"
        } else {
            "failed"
        },
        update_worktree_status: provider != "claude-code",
        update_task_workspace_status: provider != "claude-code",
        ignore_unknown_provider: true,
    }
}

#[cfg(test)]
pub(crate) fn tauri_abort_session_policy(provider: &str) -> AbortSessionPolicy {
    AbortSessionPolicy {
        session_status: if provider == "claude-code" {
            "interrupted"
        } else {
            "failed"
        },
        update_worktree_status: provider != "claude-code",
        update_task_workspace_status: false,
        ignore_unknown_provider: false,
    }
}

pub(crate) fn session_output_context(
    db: &db::Database,
    task_id: &str,
) -> Result<SessionOutputContext, String> {
    let session = db
        .get_latest_session_for_ticket(task_id)
        .map_err(|e| format!("Failed to get session: {e}"))?
        .ok_or_else(|| format!("No session found for task {task_id}"))?;
    let opencode_session_id = session
        .opencode_session_id
        .ok_or_else(|| "Session has no OpenCode session ID".to_string())?;
    let workspace_path = db
        .get_task_workspace_for_task(task_id)
        .map_err(|e| format!("Failed to get task workspace: {e}"))?
        .map(|workspace| workspace.workspace_path)
        .or_else(|| {
            db.get_worktree_for_task(task_id)
                .ok()
                .flatten()
                .map(|workspace| workspace.worktree_path)
        });

    Ok(SessionOutputContext {
        opencode_session_id,
        workspace_path,
    })
}

pub(crate) async fn session_output_server_port(
    server_manager: &ServerManager,
    task_id: &str,
    workspace_path: Option<&str>,
) -> Result<(u16, bool), String> {
    let existing_port = server_manager.get_server_port(task_id).await;
    let spawned_server = existing_port.is_none();
    let port = match existing_port {
        Some(port) => port,
        None => {
            let workspace_path =
                workspace_path.ok_or_else(|| "No workspace found for this task".to_string())?;
            server_manager
                .spawn_server(task_id, Path::new(workspace_path))
                .await
                .map_err(|e| format!("Failed to start OpenCode server: {e}"))?
        }
    };

    Ok((port, spawned_server))
}

pub(crate) fn assistant_text_from_messages(messages: &[serde_json::Value]) -> String {
    let mut output = String::new();
    for message in messages {
        let role = message
            .get("role")
            .and_then(|role| role.as_str())
            .unwrap_or("");
        if role != "assistant" {
            continue;
        }

        let Some(parts) = message.get("parts").and_then(|parts| parts.as_array()) else {
            continue;
        };
        for part in parts {
            let part_type = part
                .get("type")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            if part_type == "text" {
                if let Some(text) = part.get("text").and_then(|value| value.as_str()) {
                    output.push_str(text);
                }
            }
        }
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn task_workspace(branch_name: Option<&str>) -> db::TaskWorkspaceRow {
        db::TaskWorkspaceRow {
            id: 1,
            task_id: "T-1".to_string(),
            project_id: "P-1".to_string(),
            workspace_path: "/tmp/workspace".to_string(),
            repo_path: "/tmp/repo".to_string(),
            kind: "git_worktree".to_string(),
            branch_name: branch_name.map(str::to_string),
            provider_name: "opencode".to_string(),
            opencode_port: Some(1234),
            status: "running".to_string(),
            created_at: 11,
            updated_at: 22,
        }
    }

    fn legacy_worktree() -> db::WorktreeRow {
        db::WorktreeRow {
            id: 1,
            task_id: "T-1".to_string(),
            project_id: "P-1".to_string(),
            repo_path: "/tmp/repo".to_string(),
            worktree_path: "/tmp/workspace".to_string(),
            branch_name: "branch-a".to_string(),
            opencode_port: Some(1234),
            opencode_pid: Some(999),
            status: "running".to_string(),
            created_at: 11,
            updated_at: 22,
        }
    }

    #[test]
    fn extracts_only_assistant_text_parts_in_order() {
        let messages = vec![
            json!({"role":"user","parts":[{"type":"text","text":"ignore"}]}),
            json!({"role":"assistant","parts":[
                {"type":"text","text":"hello "},
                {"type":"tool","text":"ignore"},
                {"type":"text","text":"world"}
            ]}),
            json!({"role":"assistant","parts":[{"type":"text","text":"!"}]}),
        ];

        assert_eq!(assistant_text_from_messages(&messages), "hello world!");
    }

    #[test]
    fn app_invoke_abort_policy_preserves_pi_interrupted_status_and_workspace_updates() {
        assert_eq!(
            app_invoke_abort_session_policy("pi"),
            AbortSessionPolicy {
                session_status: "interrupted",
                update_worktree_status: true,
                update_task_workspace_status: true,
                ignore_unknown_provider: true,
            }
        );
    }

    #[test]
    fn tauri_abort_policy_preserves_existing_pi_failed_status() {
        assert_eq!(
            tauri_abort_session_policy("pi"),
            AbortSessionPolicy {
                session_status: "failed",
                update_worktree_status: true,
                update_task_workspace_status: false,
                ignore_unknown_provider: false,
            }
        );
    }

    #[test]
    fn task_workspace_to_legacy_worktree_preserves_fields_and_defaults_branch() {
        let worktree = legacy_worktree_from_task_workspace(task_workspace(None));

        assert_eq!(worktree.id, 1);
        assert_eq!(worktree.task_id, "T-1");
        assert_eq!(worktree.project_id, "P-1");
        assert_eq!(worktree.repo_path, "/tmp/repo");
        assert_eq!(worktree.worktree_path, "/tmp/workspace");
        assert_eq!(worktree.branch_name, "");
        assert_eq!(worktree.opencode_port, Some(1234));
        assert_eq!(worktree.opencode_pid, None);
        assert_eq!(worktree.status, "running");
        assert_eq!(worktree.created_at, 11);
        assert_eq!(worktree.updated_at, 22);
    }

    #[test]
    fn legacy_worktree_to_task_workspace_preserves_fields_and_provider() {
        let workspace = task_workspace_from_legacy(legacy_worktree(), "pi".to_string());

        assert_eq!(workspace.id, 1);
        assert_eq!(workspace.task_id, "T-1");
        assert_eq!(workspace.project_id, "P-1");
        assert_eq!(workspace.workspace_path, "/tmp/workspace");
        assert_eq!(workspace.repo_path, "/tmp/repo");
        assert_eq!(workspace.kind, "git_worktree");
        assert_eq!(workspace.branch_name, Some("branch-a".to_string()));
        assert_eq!(workspace.provider_name, "pi");
        assert_eq!(workspace.opencode_port, Some(1234));
        assert_eq!(workspace.status, "running");
        assert_eq!(workspace.created_at, 11);
        assert_eq!(workspace.updated_at, 22);
    }
}
