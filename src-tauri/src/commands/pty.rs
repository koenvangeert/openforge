use tauri::State;
use crate::pty_manager::PtyManager;

#[tauri::command]
pub async fn pty_spawn(
    pty_mgr: State<'_, PtyManager>,
    app: tauri::AppHandle,
    task_id: String,
    server_port: u16,
    opencode_session_id: String,
    cols: u16,
    rows: u16,
) -> Result<u64, String> {
    pty_mgr
        .spawn_pty(&task_id, server_port, &opencode_session_id, cols, rows, app)
        .await
        .map_err(|e| format!("Failed to spawn PTY: {}", e))
}


#[tauri::command]
pub async fn pty_write(
    pty_mgr: State<'_, PtyManager>,
    task_id: String,
    data: String,
) -> Result<(), String> {
    pty_mgr
        .write_pty(&task_id, data.as_bytes())
        .await
        .map_err(|e| format!("Failed to write to PTY: {}", e))
}

#[tauri::command]
pub async fn pty_resize(
    pty_mgr: State<'_, PtyManager>,
    task_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty_mgr
        .resize_pty(&task_id, cols, rows)
        .await
        .map_err(|e| format!("Failed to resize PTY: {}", e))
}

#[tauri::command]
pub async fn pty_kill(
    pty_mgr: State<'_, PtyManager>,
    task_id: String,
) -> Result<(), String> {
    pty_mgr
        .kill_pty(&task_id)
        .await
        .map_err(|e| format!("Failed to kill PTY: {}", e))
}

#[tauri::command]
pub async fn get_pty_buffer(
    task_id: String,
    pty_mgr: State<'_, PtyManager>,
) -> Result<Option<String>, String> {
    Ok(pty_mgr.get_pty_buffer(&task_id).await)
}
