use super::*;

pub(super) async fn handle_app_core_task_project_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    let value = match request.command.as_str() {
        "update_task_status" => {
            let id = payload_string(&request.payload, "id")?;
            let status_text = payload_string(&request.payload, "status")?;
            let status = db::BoardStatus::from_str(&status_text)
                .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
            {
                let db = crate::db::acquire_db(&state.db);
                db.update_task_status(&id, status.as_str()).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to update task status: {e}"),
                    )
                })?;
                if status == db::BoardStatus::Done {
                    let _ = db.update_task_workspace_status(&id, "completed");
                }
            }
            publish_task_changed(state, &id);
            if status == db::BoardStatus::Done {
                cleanup_task_runtime_for_app(state, &id, false).await?;
            }
            serde_json::Value::Null
        }
        "delete_task" => {
            let id = payload_string(&request.payload, "id")?;
            cleanup_task_runtime_for_app(state, &id, true).await?;
            {
                let db = crate::db::acquire_db(&state.db);
                db.delete_task(&id).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to delete task: {e}"),
                    )
                })?;
            }
            publish_task_changed_payload(
                state,
                serde_json::json!({ "action": "deleted", "task_id": id }),
            );
            serde_json::Value::Null
        }
        "clear_done_tasks" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let task_ids = {
                let db = crate::db::acquire_db(&state.db);
                db.get_task_ids_by_status(&project_id, db::BoardStatus::Done.as_str())
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to get done tasks: {e}"),
                        )
                    })?
            };
            let mut deleted = 0u32;
            for id in &task_ids {
                cleanup_task_runtime_for_app(state, id, true).await?;
                let db = crate::db::acquire_db(&state.db);
                db.delete_task(id).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to delete task {id}: {e}"),
                    )
                })?;
                deleted += 1;
            }
            if deleted > 0 {
                publish_task_changed_payload(
                    state,
                    serde_json::json!({ "action": "cleared_done", "count": deleted }),
                );
            }
            json_value(deleted)?
        }
        "delete_project" => {
            let id = payload_string(&request.payload, "id")?;
            let db = crate::db::acquire_db(&state.db);
            db.delete_project(&id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to delete project: {e}"),
                )
            })?;
            serde_json::Value::Null
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}

pub(super) async fn handle_app_unmatched_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<serde_json::Value> {
    let db = crate::db::acquire_db(&state.db);
    let value = match request.command.as_str() {
        "get_config" => {
            let key = payload_string(&request.payload, "key")?;
            let db_value = || {
                db.get_config(&key).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get config: {e}"),
                    )
                })
            };
            if crate::secure_store::is_secret(&key) {
                let secret = crate::secure_store::get_secret(&key).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get secret config: {e}"),
                    )
                })?;
                json_value(match secret {
                    Some(value) => Some(value),
                    None => db_value()?,
                })?
            } else {
                json_value(db_value()?)?
            }
        }
        "set_config" => {
            let key = payload_string(&request.payload, "key")?;
            let value = payload_string(&request.payload, "value")?;
            if crate::secure_store::is_secret(&key) {
                crate::secure_store::set_secret(&key, &value).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to set secret config: {e}"),
                    )
                })?;
                db.set_config(&key, "").map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to clear persisted secret config: {e}"),
                    )
                })?;
            } else {
                db.set_config(&key, &value).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to set config: {e}"),
                    )
                })?;
            }
            serde_json::Value::Null
        }
        "create_project" => {
            let name = payload_string(&request.payload, "name")?;
            let path = payload_string(&request.payload, "path")?;
            json_value(db.create_project(&name, &path).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to create project: {e}"),
                )
            })?)?
        }
        "get_projects" => json_value(db.get_all_projects().map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get projects: {e}"),
            )
        })?)?,
        "update_project" => {
            let id = payload_string(&request.payload, "id")?;
            let name = payload_string(&request.payload, "name")?;
            let path = payload_string(&request.payload, "path")?;
            db.update_project(&id, &name, &path).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to update project: {e}"),
                )
            })?;
            serde_json::Value::Null
        }
        "get_project_config" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let key = payload_string(&request.payload, "key")?;
            json_value(db.get_project_config(&project_id, &key).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get project config: {e}"),
                )
            })?)?
        }
        "set_project_config" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let key = payload_string(&request.payload, "key")?;
            let value = payload_string(&request.payload, "value")?;
            db.set_project_config(&project_id, &key, &value)
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to set project config: {e}"),
                    )
                })?;
            serde_json::Value::Null
        }
        "create_task" => {
            let initial_prompt = payload_string(&request.payload, "initialPrompt")?;
            let status = payload_string(&request.payload, "status")?;
            let project_id = payload_optional_string(&request.payload, "projectId")?;
            let agent = payload_optional_string(&request.payload, "agent")?;
            let permission_mode = payload_optional_string(&request.payload, "permissionMode")?;
            let task = db
                .create_task(
                    &initial_prompt,
                    &status,
                    project_id.as_deref(),
                    None,
                    agent.as_deref(),
                    permission_mode.as_deref(),
                )
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to create task: {e}"),
                    )
                })?;
            json_value(task)?
        }
        "update_task" => {
            let id = payload_string(&request.payload, "id")?;
            let prompt = payload_string(&request.payload, "prompt")?;
            db.update_task(&id, &prompt).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to update task prompt: {e}"),
                )
            })?;
            serde_json::Value::Null
        }
        "update_task_summary" => {
            let id = payload_string(&request.payload, "id")?;
            let summary = payload_string(&request.payload, "summary")?;
            db.update_task_summary(&id, &summary).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to update task summary: {e}"),
                )
            })?;
            serde_json::Value::Null
        }
        "get_tasks" => json_value(db.get_all_tasks().map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get tasks: {e}"),
            )
        })?)?,
        "get_project_attention" => {
            json_value(db.get_project_attention_summaries().map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get project attention: {e}"),
                )
            })?)?
        }
        "get_app_mode" => json_value(if cfg!(debug_assertions) {
            "dev"
        } else {
            "prod"
        })?,
        "get_git_branch" => {
            let output = std::process::Command::new("git")
                .args(["rev-parse", "--abbrev-ref", "HEAD"])
                .output()
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to run git: {e}"),
                    )
                })?;

            if output.status.success() {
                json_value(String::from_utf8_lossy(&output.stdout).trim().to_string())?
            } else {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Not a git repository".to_string(),
                ));
            }
        }
        "get_session_status" => {
            let session_id = payload_string(&request.payload, "sessionId")?;
            let session = db
                .get_agent_session(&session_id)
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get session status: {e}"),
                    )
                })?
                .ok_or_else(|| {
                    (
                        StatusCode::NOT_FOUND,
                        format!("Session {session_id} not found"),
                    )
                })?;
            json_value(session)?
        }
        "get_latest_session" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            json_value(db.get_latest_session_for_ticket(&task_id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get latest session: {e}"),
                )
            })?)?
        }
        "get_latest_sessions" => {
            let task_ids = payload_string_vec(&request.payload, "taskIds")?;
            json_value(db.get_latest_sessions_for_tickets(&task_ids).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get sessions: {e}"),
                )
            })?)?
        }
        "finalize_claude_session" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let success = payload_bool(&request.payload, "success")?;
            if let Some(session) = db.get_latest_session_for_ticket(&task_id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get latest session: {e}"),
                )
            })? {
                if matches!(session.provider.as_str(), "claude-code" | "pi" | "opencode")
                    && session.status == "running"
                {
                    let next_status =
                        if matches!(session.provider.as_str(), "pi" | "opencode") && success {
                            "completed"
                        } else {
                            "interrupted"
                        };
                    let error_message = if next_status == "completed" {
                        None
                    } else {
                        Some("PTY process exited")
                    };
                    db.update_agent_session(
                        &session.id,
                        &session.stage,
                        next_status,
                        None,
                        error_message,
                    )
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to update session: {e}"),
                        )
                    })?;
                    let payload = serde_json::json!({
                        "task_id": task_id,
                        "status": next_status,
                        "provider": session.provider,
                    });
                    publish_app_event_to_runtime(
                        state.app.as_ref(),
                        &state.app_event_tx,
                        "agent-status-changed",
                        &payload,
                    );
                }
            }
            serde_json::Value::Null
        }
        "get_task_detail" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let task = db
                .get_task(&task_id)
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to get task: {e}"),
                    )
                })?
                .ok_or_else(|| (StatusCode::NOT_FOUND, format!("Task {task_id} not found")))?;
            json_value(task)?
        }
        "get_tasks_for_project" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            json_value(db.get_tasks_for_project(&project_id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get tasks for project: {e}"),
                )
            })?)?
        }
        "get_task_workspace" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let workspace = crate::provider_runtime::get_task_workspace(&db, &task_id)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            json_value(workspace)?
        }
        command => {
            return Err((
                StatusCode::NOT_IMPLEMENTED,
                format!("app IPC command is not implemented for Electron sidecar slice: {command}"),
            ));
        }
    };

    drop(db);

    Ok(value)
}
