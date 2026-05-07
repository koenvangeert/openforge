use super::*;
use crate::opencode_client::OpenCodeClient;
use crate::provider_runtime;
use crate::providers::Provider;

fn string_error(error: String) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error)
}

fn project_runtime_context(
    state: &AppState,
    project_id: &str,
) -> AppResult<provider_runtime::ProjectRuntimeContext> {
    let db = crate::db::acquire_db(&state.db);
    provider_runtime::load_project_runtime_context(&db, project_id).map_err(string_error)
}

fn runtime_error(error: String) -> (StatusCode, String) {
    let status = if error == "Server manager is not available" {
        StatusCode::SERVICE_UNAVAILABLE
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    };
    (status, error)
}

async fn list_opencode_commands(
    state: &AppState,
    project_id: &str,
) -> AppResult<serde_json::Value> {
    let context = project_runtime_context(state, project_id)?;
    json_value(
        provider_runtime::list_runtime_commands(
            state.server_manager.as_ref(),
            project_id,
            &context,
        )
        .await
        .map_err(runtime_error)?,
    )
}

async fn search_opencode_files(
    state: &AppState,
    project_id: &str,
    query: &str,
) -> AppResult<serde_json::Value> {
    let context = project_runtime_context(state, project_id)?;
    json_value(
        provider_runtime::search_runtime_files(
            state.server_manager.as_ref(),
            project_id,
            &context,
            query,
        )
        .await
        .map_err(runtime_error)?,
    )
}

async fn list_opencode_agents(state: &AppState, project_id: &str) -> AppResult<serde_json::Value> {
    let context = project_runtime_context(state, project_id)?;
    json_value(
        provider_runtime::list_runtime_agents(state.server_manager.as_ref(), project_id, &context)
            .await
            .map_err(runtime_error)?,
    )
}

async fn list_opencode_models(state: &AppState, project_id: &str) -> AppResult<serde_json::Value> {
    let context = project_runtime_context(state, project_id)?;
    json_value(
        provider_runtime::list_runtime_models(state.server_manager.as_ref(), project_id, &context)
            .await
            .map_err(runtime_error)?,
    )
}

async fn list_opencode_skills(state: &AppState, project_id: &str) -> AppResult<serde_json::Value> {
    let context = project_runtime_context(state, project_id)?;
    json_value(
        provider_runtime::list_runtime_skills(state.server_manager.as_ref(), project_id, &context)
            .await
            .map_err(runtime_error)?,
    )
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

    let db = crate::db::acquire_db(&state.db);
    provider_runtime::save_skill_content(
        &db,
        &project_id,
        &skill_name,
        &level,
        &source_dir,
        &content,
    )
    .map_err(|error| {
        let status = if error.starts_with("Unsupported skill source directory") {
            StatusCode::BAD_REQUEST
        } else if error == "Project not found" {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        };
        (status, error)
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

    let policy = provider_runtime::app_invoke_abort_session_policy(&session.provider);
    match Provider::from_name(
        &session.provider,
        pty_manager.clone(),
        server_manager.clone(),
        sse_bridge_manager.clone(),
    ) {
        Ok(provider) => {
            let _ = provider.abort(&session.ticket_id, &session).await;
        }
        Err(error) if !policy.ignore_unknown_provider => return Err(string_error(error)),
        Err(_) => {}
    }

    {
        let db = crate::db::acquire_db(&state.db);
        let _ = db.update_agent_session(
            &session.id,
            "implementing",
            policy.session_status,
            None,
            Some("Aborted by user"),
        );
        if policy.update_worktree_status {
            let _ = db.update_worktree_status(&session.ticket_id, "stopped");
        }
        if policy.update_task_workspace_status {
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
    if let Some(pty_manager) = state.pty_manager.as_ref() {
        if let Some(output) = pty_manager.get_pty_buffer(&task_id).await {
            return json_value(output);
        }
    }

    let context = {
        let db = crate::db::acquire_db(&state.db);
        provider_runtime::session_output_context(&db, &task_id).map_err(|error| {
            let status = if error.starts_with("No session found") {
                StatusCode::NOT_FOUND
            } else if error == "Session has no OpenCode session ID" {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            (status, error)
        })?
    };

    let Some(server_manager) = state.server_manager.as_ref() else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "Server manager is not available".to_string(),
        ));
    };

    let (port, spawned_server) = provider_runtime::session_output_server_port(
        server_manager,
        &task_id,
        context.workspace_path.as_deref(),
    )
    .await
    .map_err(|error| {
        let status = if error == "No workspace found for this task" {
            StatusCode::NOT_FOUND
        } else if error == "OpenCode server is not managed by OpenForge" {
            StatusCode::SERVICE_UNAVAILABLE
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        };
        (status, error)
    })?;

    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{port}"));
    let messages = client
        .get_session_messages(&context.opencode_session_id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch session messages: {e}"),
            )
        })?;

    let output = provider_runtime::assistant_text_from_messages(&messages);

    let _ = spawned_server;
    json_value(output)
}

fn get_worktree_for_task(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<serde_json::Value> {
    let task_id = payload_string(&request.payload, "taskId")?;
    let db = crate::db::acquire_db(&state.db);
    json_value(provider_runtime::get_worktree_for_task(&db, &task_id).map_err(string_error)?)
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
