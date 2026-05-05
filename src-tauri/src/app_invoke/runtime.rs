use super::*;
use crate::command_discovery::{
    find_skill_source_dir, is_supported_skill_source_dir, scan_skill_directories_for_root,
    search_project_files, skill_source_dir, GENERIC_SKILLS_SOURCE_DIR,
};
use crate::opencode_client::OpenCodeClient;
use crate::providers::{claude_code::ClaudeCodeProvider, pi::PiProvider, Provider};
use crate::server_manager::discovery_server_task_id;
use std::path::Path;

fn string_error(error: String) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error)
}

fn legacy_worktree_from_task_workspace(workspace: db::TaskWorkspaceRow) -> db::WorktreeRow {
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

fn load_project_context(state: &AppState, project_id: &str) -> AppResult<(String, Option<String>)> {
    let db = crate::db::acquire_db(&state.db);
    let provider = db.resolve_ai_provider(project_id);
    let project_path = db
        .get_project(project_id)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get project: {e}"),
            )
        })?
        .map(|project| project.path);

    Ok((provider, project_path))
}

async fn ensure_project_discovery_server(
    state: &AppState,
    project_id: &str,
) -> AppResult<Option<u16>> {
    let (provider, project_path) = load_project_context(state, project_id)?;
    if provider != "opencode" {
        return Ok(None);
    }

    let Some(server_manager) = state.server_manager.as_ref() else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "Server manager is not available".to_string(),
        ));
    };

    let discovery_task_id = discovery_server_task_id(project_id);
    if let Some(port) = server_manager.get_server_port(&discovery_task_id).await {
        return Ok(Some(port));
    }

    let Some(project_path) = project_path else {
        return Ok(None);
    };

    let port = server_manager
        .spawn_server(&discovery_task_id, Path::new(&project_path))
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to start discovery server: {e}"),
            )
        })?;

    Ok(Some(port))
}

fn provider_commands(
    provider: &str,
    project_path: Option<&str>,
) -> Option<Vec<crate::opencode_client::CommandInfo>> {
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

fn provider_agents(
    provider: &str,
    project_path: Option<&str>,
) -> Option<Vec<crate::opencode_client::AgentInfo>> {
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

async fn list_opencode_commands(
    state: &AppState,
    project_id: &str,
) -> AppResult<serde_json::Value> {
    let (provider, project_path) = load_project_context(state, project_id)?;
    if let Some(commands) = provider_commands(&provider, project_path.as_deref()) {
        return json_value(commands);
    }

    let Some(port) = ensure_project_discovery_server(state, project_id).await? else {
        return json_value(Vec::<crate::opencode_client::CommandInfo>::new());
    };

    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{port}"));
    json_value(client.list_commands().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to list commands: {e}"),
        )
    })?)
}

async fn search_opencode_files(
    state: &AppState,
    project_id: &str,
    query: &str,
) -> AppResult<serde_json::Value> {
    let (provider, project_path) = load_project_context(state, project_id)?;
    if matches!(provider.as_str(), "claude-code" | "pi") {
        return json_value(
            project_path
                .as_deref()
                .map(|path| search_project_files(path, query, 10))
                .unwrap_or_default(),
        );
    }

    let Some(port) = ensure_project_discovery_server(state, project_id).await? else {
        return json_value(Vec::<String>::new());
    };

    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{port}"));
    json_value(client.find_files(query, true, 10).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to search files: {e}"),
        )
    })?)
}

async fn list_opencode_agents(state: &AppState, project_id: &str) -> AppResult<serde_json::Value> {
    let (provider, project_path) = load_project_context(state, project_id)?;
    if let Some(agents) = provider_agents(&provider, project_path.as_deref()) {
        return json_value(agents);
    }

    let Some(port) = ensure_project_discovery_server(state, project_id).await? else {
        return json_value(Vec::<crate::opencode_client::AgentInfo>::new());
    };

    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{port}"));
    json_value(client.list_agents().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to list agents: {e}"),
        )
    })?)
}

async fn list_opencode_models(state: &AppState, project_id: &str) -> AppResult<serde_json::Value> {
    let Some(port) = ensure_project_discovery_server(state, project_id).await? else {
        return json_value(Vec::<crate::opencode_client::ProviderModelInfo>::new());
    };

    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{port}"));
    json_value(client.list_providers().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to list models: {e}"),
        )
    })?)
}

async fn list_opencode_skills(state: &AppState, project_id: &str) -> AppResult<serde_json::Value> {
    let (_, project_path) = load_project_context(state, project_id)?;
    let mut skills_map =
        std::collections::HashMap::<String, crate::opencode_client::SkillInfo>::new();

    if let Some(port) = ensure_project_discovery_server(state, project_id).await? {
        let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{port}"));
        if let Ok(commands) = client.list_commands().await {
            for command in commands {
                if command.source.as_deref() != Some("skill") {
                    continue;
                }
                let template = command
                    .extra
                    .get("template")
                    .and_then(|value| value.as_str())
                    .map(str::to_string);
                let (level, source_dir) = if let Some(ref project_path) = project_path {
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

                skills_map.insert(
                    command.name.clone(),
                    crate::opencode_client::SkillInfo {
                        name: command.name,
                        description: command.description,
                        agent: command.agent,
                        template,
                        level,
                        source_dir,
                    },
                );
            }
        }
    }

    if let Some(ref project_path) = project_path {
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
    json_value(skills)
}

fn save_skill_content(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<serde_json::Value> {
    let project_id = payload_string(&request.payload, "projectId")?;
    let skill_name = payload_string(&request.payload, "skillName")?;
    let level = payload_string(&request.payload, "level")?;
    let source_dir = payload_string(&request.payload, "sourceDir")?;
    let content = payload_string(&request.payload, "content")?;

    if !is_supported_skill_source_dir(&source_dir) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Unsupported skill source directory: {source_dir}"),
        ));
    }

    let skill_root = if level == "project" {
        let db = crate::db::acquire_db(&state.db);
        let project_path = db
            .get_project(&project_id)
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get project: {e}"),
                )
            })?
            .map(|project| project.path)
            .ok_or_else(|| (StatusCode::NOT_FOUND, "Project not found".to_string()))?;
        std::path::PathBuf::from(project_path)
    } else {
        dirs::home_dir().ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Cannot determine home directory".to_string(),
            )
        })?
    };

    let skill_dir = skill_source_dir(&skill_root, &source_dir).join(&skill_name);
    std::fs::create_dir_all(&skill_dir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create skill directory: {e}"),
        )
    })?;
    std::fs::write(skill_dir.join("SKILL.md"), content).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to write skill file: {e}"),
        )
    })?;

    Ok(serde_json::Value::Null)
}

async fn abort_session(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<serde_json::Value> {
    let session_id = payload_string(&request.payload, "sessionId")?;
    let session = {
        let db = crate::db::acquire_db(&state.db);
        db.get_agent_session(&session_id)
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get session: {e}"),
                )
            })?
            .ok_or_else(|| {
                (
                    StatusCode::NOT_FOUND,
                    format!("Session {session_id} not found"),
                )
            })?
    };

    let Some(pty_manager) = state.pty_manager.as_ref() else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "PTY manager is not available".to_string(),
        ));
    };
    let Some(server_manager) = state.server_manager.as_ref() else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "Server manager is not available".to_string(),
        ));
    };
    let Some(sse_bridge_manager) = state.sse_bridge_manager.as_ref() else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "SSE bridge manager is not available".to_string(),
        ));
    };

    if let Ok(provider) = Provider::from_name(
        &session.provider,
        pty_manager.clone(),
        server_manager.clone(),
        sse_bridge_manager.clone(),
    ) {
        let _ = provider.abort(&session.ticket_id, &session).await;
    }

    let abort_status = if matches!(session.provider.as_str(), "claude-code" | "pi") {
        "interrupted"
    } else {
        "failed"
    };
    {
        let db = crate::db::acquire_db(&state.db);
        let _ = db.update_agent_session(
            &session.id,
            "implementing",
            abort_status,
            None,
            Some("Aborted by user"),
        );
        if session.provider != "claude-code" {
            let _ = db.update_worktree_status(&session.ticket_id, "stopped");
            let _ = db.update_task_workspace_status(&session.ticket_id, "stopped");
        }
    }

    publish_task_changed(state, &session.ticket_id);
    Ok(serde_json::Value::Null)
}

async fn get_session_output(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<serde_json::Value> {
    let task_id = payload_string(&request.payload, "taskId")?;
    let (opencode_session_id, workspace_path) = {
        let db = crate::db::acquire_db(&state.db);
        let session = db
            .get_latest_session_for_ticket(&task_id)
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get session: {e}"),
                )
            })?
            .ok_or_else(|| {
                (
                    StatusCode::NOT_FOUND,
                    format!("No session found for task {task_id}"),
                )
            })?;
        let opencode_session_id = session.opencode_session_id.ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                "Session has no OpenCode session ID".to_string(),
            )
        })?;
        let workspace_path = db
            .get_task_workspace_for_task(&task_id)
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get task workspace: {e}"),
                )
            })?
            .map(|workspace| workspace.workspace_path)
            .or_else(|| {
                db.get_worktree_for_task(&task_id)
                    .ok()
                    .flatten()
                    .map(|workspace| workspace.worktree_path)
            });
        (opencode_session_id, workspace_path)
    };

    let Some(server_manager) = state.server_manager.as_ref() else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "Server manager is not available".to_string(),
        ));
    };

    let existing_port = server_manager.get_server_port(&task_id).await;
    let spawned_server = existing_port.is_none();
    let port = match existing_port {
        Some(port) => port,
        None => {
            let workspace_path = workspace_path.ok_or_else(|| {
                (
                    StatusCode::NOT_FOUND,
                    "No workspace found for this task".to_string(),
                )
            })?;
            server_manager
                .spawn_server(&task_id, Path::new(&workspace_path))
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to start OpenCode server: {e}"),
                    )
                })?
        }
    };

    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{port}"));
    let messages = client
        .get_session_messages(&opencode_session_id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch session messages: {e}"),
            )
        })?;

    let mut output = String::new();
    for message in &messages {
        let role = message
            .get("role")
            .and_then(|role| role.as_str())
            .unwrap_or("");
        if role != "assistant" {
            continue;
        }
        if let Some(parts) = message.get("parts").and_then(|parts| parts.as_array()) {
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
    }

    if spawned_server {
        let _ = server_manager.stop_server(&task_id).await;
    }

    json_value(output)
}

fn get_worktree_for_task(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<serde_json::Value> {
    let task_id = payload_string(&request.payload, "taskId")?;
    let db = crate::db::acquire_db(&state.db);
    if let Some(worktree) = db.get_worktree_for_task(&task_id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get worktree for task: {e}"),
        )
    })? {
        return json_value(Some(worktree));
    }

    let workspace = db.get_task_workspace_for_task(&task_id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get task workspace for task: {e}"),
        )
    })?;
    json_value(workspace.map(legacy_worktree_from_task_workspace))
}

pub(super) async fn handle_app_runtime_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    let value = match request.command.as_str() {
        "check_opencode_installed" => json_value(
            crate::runtime_checks::check_opencode_installed()
                .await
                .map_err(string_error)?,
        )?,
        "check_pi_installed" => json_value(
            crate::runtime_checks::check_pi_installed()
                .await
                .map_err(string_error)?,
        )?,
        "check_claude_installed" => json_value(
            crate::runtime_checks::check_claude_installed()
                .await
                .map_err(string_error)?,
        )?,
        "get_agents" => {
            let client = OpenCodeClient::with_base_url("http://127.0.0.1:4096".to_string());
            json_value(client.list_agents().await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get agents: {e}"),
                )
            })?)?
        }
        "get_worktree_for_task" => get_worktree_for_task(state, request)?,
        "abort_session" => abort_session(state, request).await?,
        "get_session_output" => get_session_output(state, request).await?,
        "list_opencode_commands" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            list_opencode_commands(state, &project_id).await?
        }
        "list_opencode_skills" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            list_opencode_skills(state, &project_id).await?
        }
        "save_skill_content" => save_skill_content(state, request)?,
        "search_opencode_files" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let query = payload_string(&request.payload, "query")?;
            search_opencode_files(state, &project_id, &query).await?
        }
        "list_opencode_agents" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            list_opencode_agents(state, &project_id).await?
        }
        "list_opencode_models" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            list_opencode_models(state, &project_id).await?
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}
