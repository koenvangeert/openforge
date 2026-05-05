use super::*;

pub(crate) enum ExistingSseBridge {
    Error,
    TreatAsResumed,
}

pub(crate) async fn start_opencode_sse_bridge_for_app(
    state: &AppState,
    task_id: &str,
    opencode_session_id: Option<String>,
    port: u16,
    existing_bridge: ExistingSseBridge,
) -> Result<(), (StatusCode, String)> {
    let Some(sse_bridge_manager) = state.sse_bridge_manager.as_ref() else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "SSE bridge manager is not available".to_string(),
        ));
    };

    sse_bridge_manager
        .start_bridge_with_app_events(
            state.app.clone(),
            state.db.clone(),
            state.app_event_tx.clone(),
            task_id.to_string(),
            opencode_session_id,
            port,
        )
        .await
        .or_else(|e| match (existing_bridge, e) {
            (ExistingSseBridge::TreatAsResumed, SseBridgeError::AlreadyRunning(task_id)) => {
                info!(
                    "[app_invoke] OpenCode SSE bridge already running for task {}; treating resume as idempotent",
                    task_id
                );
                Ok(())
            }
            (_, e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
        })
}

pub(super) async fn cleanup_task_runtime_for_app(
    state: &AppState,
    task_id: &str,
    remove_branch: bool,
) -> Result<(), (StatusCode, String)> {
    if let Some(pty_manager) = state.pty_manager.as_ref() {
        let _ = pty_manager.kill_pty(task_id).await;
        pty_manager.kill_shells_for_task(task_id).await;
    }
    if let Some(sse_bridge_manager) = state.sse_bridge_manager.as_ref() {
        sse_bridge_manager.stop_bridge(task_id).await;
    }
    if let Some(server_manager) = state.server_manager.as_ref() {
        let _ = server_manager.stop_server(task_id).await;
    }

    let worktree = {
        let db = crate::db::acquire_db(&state.db);
        db.get_worktree_for_task(task_id).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get worktree: {e}"),
            )
        })?
    };

    if let Some(worktree) = worktree {
        let repo_path = std::path::Path::new(&worktree.repo_path);
        let worktree_path = std::path::Path::new(&worktree.worktree_path);
        let remove_result = if remove_branch {
            crate::git_worktree::remove_worktree_with_branch(
                repo_path,
                worktree_path,
                Some(&worktree.branch_name),
            )
            .await
        } else {
            crate::git_worktree::remove_worktree(repo_path, worktree_path).await
        };
        if let Err(e) = remove_result {
            error!(
                "[app_invoke] Failed to remove worktree at {}: {}",
                worktree_path.display(),
                e
            );
        }

        if !remove_branch {
            let db = crate::db::acquire_db(&state.db);
            if let Err(e) = db.delete_worktree_record(task_id) {
                error!(
                    "[app_invoke] Failed to delete worktree record for {}: {}",
                    task_id, e
                );
            }
        }
    }

    Ok(())
}

pub(super) async fn handle_app_resume_startup_sessions_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    if request.command != "resume_startup_sessions" {
        return Ok(None);
    }

    let targets = {
        let db = crate::db::acquire_db(&state.db);
        crate::load_resume_targets(&db).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get resumable task workspaces: {e}"),
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

    for target in targets {
        let workspace_path = std::path::Path::new(&target.workspace_path);
        if !workspace_path.exists() {
            warn!(
                "[startup] Workspace path missing for task {}, skipping: {}",
                target.task_id, target.workspace_path
            );
            continue;
        }

        let latest_session = {
            let db = crate::db::acquire_db(&state.db);
            db.get_latest_session_for_ticket(&target.task_id)
                .ok()
                .flatten()
        };
        let provider_name = latest_session
            .as_ref()
            .map(|session| session.provider.as_str())
            .unwrap_or("claude-code");

        let dummy_session;
        let session_ref: &db::AgentSessionRow = match &latest_session {
            Some(session) => session,
            None => {
                dummy_session = db::AgentSessionRow {
                    id: String::new(),
                    ticket_id: target.task_id.clone(),
                    opencode_session_id: None,
                    stage: "implementing".to_string(),
                    status: "running".to_string(),
                    checkpoint_data: None,
                    error_message: None,
                    created_at: 0,
                    updated_at: 0,
                    provider: provider_name.to_string(),
                    claude_session_id: None,
                    pi_session_id: None,
                };
                &dummy_session
            }
        };

        let result = match provider_name {
            "opencode" => {
                let port = match server_manager
                    .spawn_server(&target.task_id, workspace_path)
                    .await
                {
                    Ok(port) => port,
                    Err(e) => {
                        error!(
                            "[startup] Failed to resume opencode for task {}: {}",
                            target.task_id, e
                        );
                        publish_server_resumed(state, &target.task_id, 0, &target.workspace_path);
                        continue;
                    }
                };
                if let Some(opencode_session_id) = session_ref.opencode_session_id.clone() {
                    if let Err((_, e)) = start_opencode_sse_bridge_for_app(
                        state,
                        &target.task_id,
                        Some(opencode_session_id),
                        port,
                        ExistingSseBridge::TreatAsResumed,
                    )
                    .await
                    {
                        error!(
                            "[startup] Failed to resume OpenCode SSE bridge for task {}: {}",
                            target.task_id, e
                        );
                        let _ = server_manager.stop_server(&target.task_id).await;
                        publish_server_resumed(state, &target.task_id, 0, &target.workspace_path);
                        continue;
                    }
                }
                crate::providers::ProviderSessionResult {
                    port,
                    opencode_session_id: session_ref.opencode_session_id.clone(),
                    pi_session_id: None,
                    pty_instance_id: None,
                }
            }
            "claude-code" => {
                let port = crate::claude_hooks::get_http_server_port();
                let hooks_path = match crate::claude_hooks::generate_hooks_settings(port) {
                    Ok(path) => path,
                    Err(e) => {
                        error!(
                            "[startup] Failed to generate Claude hooks for task {}: {}",
                            target.task_id, e
                        );
                        publish_server_resumed(state, &target.task_id, 0, &target.workspace_path);
                        continue;
                    }
                };
                let resume_id = session_ref.claude_session_id.as_deref();
                if let Err(e) = pty_manager
                    .spawn_claude_pty(
                        &target.task_id,
                        workspace_path,
                        "",
                        resume_id,
                        resume_id.is_none(),
                        &hooks_path,
                        None,
                        80,
                        24,
                        state.app.clone(),
                        state.app_event_tx.clone(),
                    )
                    .await
                {
                    error!(
                        "[startup] Failed to resume claude-code for task {}: {}",
                        target.task_id, e
                    );
                    if let Some(session) = latest_session.as_ref() {
                        let db = crate::db::acquire_db(&state.db);
                        let _ = db.update_agent_session(
                            &session.id,
                            &session.stage,
                            "interrupted",
                            None,
                            Some("App restarted"),
                        );
                    }
                    publish_server_resumed(state, &target.task_id, 0, &target.workspace_path);
                    continue;
                }
                crate::providers::ProviderSessionResult {
                    port: 0,
                    opencode_session_id: None,
                    pi_session_id: None,
                    pty_instance_id: None,
                }
            }
            "pi" => {
                let resume_id = session_ref.pi_session_id.as_deref();
                let pty_instance_id = match pty_manager
                    .spawn_pi_pty(
                        &target.task_id,
                        workspace_path,
                        "",
                        resume_id,
                        resume_id.is_none(),
                        80,
                        24,
                        state.app.clone(),
                        state.app_event_tx.clone(),
                    )
                    .await
                {
                    Ok(instance_id) => instance_id,
                    Err(e) => {
                        error!(
                            "[startup] Failed to resume pi for task {}: {}",
                            target.task_id, e
                        );
                        if let Some(session) = latest_session.as_ref() {
                            let db = crate::db::acquire_db(&state.db);
                            let _ = db.update_agent_session(
                                &session.id,
                                &session.stage,
                                "interrupted",
                                None,
                                Some("App restarted"),
                            );
                        }
                        publish_server_resumed(state, &target.task_id, 0, &target.workspace_path);
                        continue;
                    }
                };
                crate::providers::ProviderSessionResult {
                    port: 0,
                    opencode_session_id: None,
                    pi_session_id: resume_id.map(str::to_string),
                    pty_instance_id: Some(pty_instance_id),
                }
            }
            other => {
                warn!(
                    "[startup] Unknown provider for task {}: {}",
                    target.task_id, other
                );
                continue;
            }
        };

        let resume_persistence = crate::resolve_resume_session_persistence(
            provider_name,
            latest_session.as_ref(),
            result.port,
        )
        .await;
        {
            let db = crate::db::acquire_db(&state.db);
            if provider_name == "pi" {
                if let (Some(session), Some(pi_session_id)) =
                    (latest_session.as_ref(), result.pi_session_id.as_deref())
                {
                    if session.pi_session_id.as_deref() != Some(pi_session_id) {
                        if let Err(e) = db.set_agent_session_pi_id(&session.id, pi_session_id) {
                            warn!(
                                "[startup] Failed to persist resumed Pi session id for {}: {}",
                                target.task_id, e
                            );
                        }
                    }
                }
            }
            crate::restore_resumed_session_state(
                &db,
                latest_session.as_ref(),
                &target,
                provider_name,
                result.port,
                result.pty_instance_id,
                resume_persistence,
            );
        }

        publish_server_resumed(state, &target.task_id, result.port, &target.workspace_path);
        info!(
            "[startup] Resumed {} for task {} (port {})",
            provider_name, target.task_id, result.port
        );
    }

    publish_startup_resume_complete(state);
    Ok(Some(serde_json::Value::Null))
}

pub(super) async fn handle_app_abort_implementation_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    if request.command != "abort_implementation" {
        return Ok(None);
    }

    let task_id = payload_string(&request.payload, "taskId")?;
    let session = {
        let db = crate::db::acquire_db(&state.db);
        db.get_latest_session_for_ticket(&task_id).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get latest session: {e}"),
            )
        })?
    };

    if let Some(session) = session {
        match session.provider.as_str() {
            "opencode" => {
                if let Some(server_manager) = state.server_manager.as_ref() {
                    if let Some(opencode_session_id) = session.opencode_session_id.as_ref() {
                        if let Some(port) = server_manager.get_server_port(&task_id).await {
                            let client =
                                OpenCodeClient::with_base_url(format!("http://127.0.0.1:{port}"));
                            let _ = client.abort_session(opencode_session_id).await;
                        }
                    }
                    if let Some(sse_bridge_manager) = state.sse_bridge_manager.as_ref() {
                        sse_bridge_manager.stop_bridge(&task_id).await;
                    }
                    let _ = server_manager.stop_server(&task_id).await;
                }
            }
            "claude-code" | "pi" => {
                if let Some(pty_manager) = state.pty_manager.as_ref() {
                    pty_manager.kill_shells_for_task(&task_id).await;
                    let _ = pty_manager.kill_pty(&task_id).await;
                }
            }
            _ => {}
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
                let _ = db.update_worktree_status(&task_id, "stopped");
                let _ = db.update_task_workspace_status(&task_id, "stopped");
            }
        }
    }

    publish_task_changed(state, &task_id);
    Ok(Some(serde_json::Value::Null))
}

pub(super) async fn handle_app_start_implementation_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    if request.command != "start_implementation" {
        return Ok(None);
    }

    let task_id = payload_string(&request.payload, "taskId")?;
    let repo_path = payload_string(&request.payload, "repoPath")?;
    let pty_manager = state.pty_manager.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "PTY manager is not available".to_string(),
        )
    })?;

    let (
        task,
        project_id_owned,
        additional_instructions,
        code_cleanup_enabled,
        use_worktrees,
        provider_name,
    ) = {
        let db = crate::db::acquire_db(&state.db);
        let task = db
            .get_task(&task_id)
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get task: {e}"),
                )
            })?
            .ok_or_else(|| (StatusCode::NOT_FOUND, "Task not found".to_string()))?;
        let project_id = task.project_id.clone().unwrap_or_default();
        let instructions = db
            .get_project_config(&project_id, "additional_instructions")
            .ok()
            .flatten();
        let cleanup = db
            .get_config("code_cleanup_tasks_enabled")
            .ok()
            .flatten()
            .map(|value| value == "true")
            .unwrap_or(false);
        let worktrees = db.resolve_use_worktrees(&project_id);
        let provider_name = db.resolve_ai_provider(&project_id);
        (
            task,
            project_id,
            instructions,
            cleanup,
            worktrees,
            provider_name,
        )
    };

    let (working_dir, workspace_kind, branch_name) = if use_worktrees {
        let branch = crate::git_worktree::slugify_branch_name(
            &task_id,
            task.prompt.as_deref().unwrap_or(&task.initial_prompt),
        );
        let home = dirs::home_dir().ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to get home directory".to_string(),
            )
        })?;
        let repo_name = std::path::Path::new(&repo_path)
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| (StatusCode::BAD_REQUEST, "Invalid repo path".to_string()))?;
        let worktree_path = home
            .join(".openforge")
            .join("worktrees")
            .join(repo_name)
            .join(&task_id);

        crate::git_worktree::create_worktree(
            std::path::Path::new(&repo_path),
            &worktree_path,
            &branch,
            "origin/main",
        )
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        {
            let db = crate::db::acquire_db(&state.db);
            db.create_worktree_record(
                &task_id,
                &project_id_owned,
                &repo_path,
                worktree_path.to_str().ok_or_else(|| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Invalid worktree path".to_string(),
                    )
                })?,
                &branch,
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }

        (worktree_path, "git_worktree", Some(branch))
    } else {
        (std::path::PathBuf::from(&repo_path), "project_dir", None)
    };

    let prompt = crate::agent_lifecycle::build_task_prompt(
        &task,
        additional_instructions.as_deref(),
        code_cleanup_enabled,
    );
    let mut deferred_opencode_prompt: Option<(String, u16, Option<String>)> = None;

    let provider_result = match provider_name.as_str() {
        "opencode" => {
            let server_manager = state.server_manager.as_ref().ok_or_else(|| {
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Server manager is not available".to_string(),
                )
            })?;
            let port = server_manager
                .spawn_server(&task_id, &working_dir)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{port}"));
            let opencode_session_id = client
                .create_session(format!("Task {task_id}"))
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to create session: {e}"),
                    )
                })?;
            deferred_opencode_prompt =
                Some((opencode_session_id.clone(), port, task.agent.clone()));
            crate::providers::ProviderSessionResult {
                port,
                opencode_session_id: Some(opencode_session_id),
                pi_session_id: None,
                pty_instance_id: None,
            }
        }
        "claude-code" => {
            let port = crate::claude_hooks::get_http_server_port();
            let hooks_path = crate::claude_hooks::generate_hooks_settings(port)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            pty_manager
                .spawn_claude_pty(
                    &task_id,
                    &working_dir,
                    &prompt,
                    None,
                    false,
                    &hooks_path,
                    task.permission_mode.as_deref(),
                    80,
                    24,
                    state.app.clone(),
                    state.app_event_tx.clone(),
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            crate::providers::ProviderSessionResult {
                port: 0,
                opencode_session_id: None,
                pi_session_id: None,
                pty_instance_id: None,
            }
        }
        "pi" => {
            let pty_instance_id = pty_manager
                .spawn_pi_pty(
                    &task_id,
                    &working_dir,
                    &prompt,
                    None,
                    false,
                    80,
                    24,
                    state.app.clone(),
                    state.app_event_tx.clone(),
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            crate::providers::ProviderSessionResult {
                port: 0,
                opencode_session_id: None,
                pi_session_id: None,
                pty_instance_id: Some(pty_instance_id),
            }
        }
        other => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Unknown provider: {other}"),
            ));
        }
    };

    {
        let db = crate::db::acquire_db(&state.db);
        db.upsert_task_workspace_record(
            &task_id,
            &project_id_owned,
            working_dir.to_str().ok_or_else(|| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Invalid workspace path".to_string(),
                )
            })?,
            &repo_path,
            workspace_kind,
            branch_name.as_deref(),
            &provider_name,
            if provider_name == "claude-code" {
                None
            } else {
                Some(provider_result.port as i64)
            },
            "active",
        )
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to persist task workspace: {e}"),
            )
        })?;
    }

    if use_worktrees && provider_name != "claude-code" {
        let db = crate::db::acquire_db(&state.db);
        db.update_worktree_server(&task_id, provider_result.port as i64, 0)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    let agent_session_id = crate::agent_lifecycle::create_and_record_session(
        &state.db,
        &task_id,
        &provider_result,
        &provider_name,
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    if let Some((opencode_session_id, port, agent)) = deferred_opencode_prompt {
        start_opencode_sse_bridge_for_app(
            state,
            &task_id,
            Some(opencode_session_id.clone()),
            port,
            ExistingSseBridge::Error,
        )
        .await?;
        let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{port}"));
        client
            .prompt_async(&opencode_session_id, prompt, agent, None)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to send prompt: {e}"),
                )
            })?;
    }

    if task.status == "backlog" {
        let db = crate::db::acquire_db(&state.db);
        db.update_task_status(&task_id, "doing").map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to update task status: {e}"),
            )
        })?;
        drop(db);
        publish_task_changed(state, &task_id);
    }

    Ok(Some(crate::agent_lifecycle::build_start_response(
        &task_id,
        &agent_session_id,
        working_dir.to_str().ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Invalid workspace path".to_string(),
            )
        })?,
        provider_result.port,
    )))
}
