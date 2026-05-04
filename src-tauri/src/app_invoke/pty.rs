use super::*;

pub(super) async fn handle_app_pty_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    let Some(pty_manager) = state.pty_manager.as_ref() else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "PTY manager is not available".to_string(),
        ));
    };

    let value = match request.command.as_str() {
        "pty_spawn" => {
            let app = state.app.clone();
            let task_id = payload_string(&request.payload, "taskId")?;
            let server_port = payload_u16(&request.payload, "serverPort")?;
            let opencode_session_id = payload_string(&request.payload, "opencodeSessionId")?;
            let cols = payload_u16(&request.payload, "cols")?;
            let rows = payload_u16(&request.payload, "rows")?;
            let instance_id = pty_manager
                .spawn_pty(
                    &task_id,
                    server_port,
                    &opencode_session_id,
                    cols,
                    rows,
                    app,
                    state.app_event_tx.clone(),
                )
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to spawn PTY: {e}"),
                    )
                })?;
            json_value(instance_id)?
        }
        "pty_spawn_shell" => {
            let app = state.app.clone();
            let task_id = payload_string(&request.payload, "taskId")?;
            let cwd = payload_string(&request.payload, "cwd")?;
            let cols = payload_u16(&request.payload, "cols")?;
            let rows = payload_u16(&request.payload, "rows")?;
            let terminal_index = payload_optional_u32(&request.payload, "terminalIndex")?;
            let instance_id = pty_manager
                .spawn_shell_pty(
                    &task_id,
                    std::path::Path::new(&cwd),
                    cols,
                    rows,
                    terminal_index,
                    app,
                    state.app_event_tx.clone(),
                )
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to spawn shell PTY: {e}"),
                    )
                })?;
            json_value(instance_id)?
        }
        "pty_write" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let data = payload_string(&request.payload, "data")?;
            pty_manager
                .write_pty(&task_id, data.as_bytes())
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to write to PTY: {e}"),
                    )
                })?;
            serde_json::Value::Null
        }
        "pty_resize" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let cols = payload_u16(&request.payload, "cols")?;
            let rows = payload_u16(&request.payload, "rows")?;
            pty_manager
                .resize_pty(&task_id, cols, rows)
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to resize PTY: {e}"),
                    )
                })?;
            serde_json::Value::Null
        }
        "pty_kill" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            pty_manager.kill_pty(&task_id).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to kill PTY: {e}"),
                )
            })?;
            serde_json::Value::Null
        }
        "pty_kill_shells_for_task" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            pty_manager.kill_shells_for_task(&task_id).await;
            serde_json::Value::Null
        }
        "get_pty_buffer" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            json_value(pty_manager.get_pty_buffer(&task_id).await)?
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}
