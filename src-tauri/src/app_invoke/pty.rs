use super::pty_payload::{
    PtyResizePayload, PtySpawnPayload, PtySpawnShellPayload, PtyTaskPayload, PtyWritePayload,
};
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
            let payload = PtySpawnPayload::decode(&request.command, &request.payload)?;
            let instance_id = pty_manager
                .spawn_pty(
                    &payload.task_id,
                    payload.server_port,
                    &payload.opencode_session_id,
                    payload.cols,
                    payload.rows,
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
            let payload = PtySpawnShellPayload::decode(&request.command, &request.payload)?;
            let instance_id = pty_manager
                .spawn_shell_pty(
                    &payload.task_id,
                    std::path::Path::new(&payload.cwd),
                    payload.cols,
                    payload.rows,
                    payload.terminal_index,
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
            let payload = PtyWritePayload::decode(&request.command, &request.payload)?;
            pty_manager
                .write_pty(&payload.task_id, payload.data.as_bytes())
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
            let payload = PtyResizePayload::decode(&request.command, &request.payload)?;
            pty_manager
                .resize_pty(&payload.task_id, payload.cols, payload.rows)
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
            let payload = PtyTaskPayload::decode(&request.command, &request.payload)?;
            pty_manager.kill_pty(&payload.task_id).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to kill PTY: {e}"),
                )
            })?;
            serde_json::Value::Null
        }
        "pty_kill_shells_for_task" => {
            let payload = PtyTaskPayload::decode(&request.command, &request.payload)?;
            pty_manager.kill_shells_for_task(&payload.task_id).await;
            serde_json::Value::Null
        }
        "get_pty_buffer" => {
            let payload = PtyTaskPayload::decode(&request.command, &request.payload)?;
            json_value(pty_manager.get_pty_buffer(&payload.task_id).await)?
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}
