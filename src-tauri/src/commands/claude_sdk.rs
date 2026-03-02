use tauri::State;
use crate::claude_sdk_manager::ClaudeSdkManager;

#[tauri::command]
pub async fn send_claude_input(
    sdk_mgr: State<'_, ClaudeSdkManager>,
    task_id: String,
    text: String,
) -> Result<(), String> {
    sdk_mgr
        .send_input(&task_id, &text)
        .await
        .map_err(|e| format!("Failed to send Claude input: {}", e))
}

#[tauri::command]
pub async fn interrupt_claude_session(
    sdk_mgr: State<'_, ClaudeSdkManager>,
    task_id: String,
) -> Result<(), String> {
    sdk_mgr
        .interrupt_session(&task_id)
        .await
        .map_err(|e| format!("Failed to interrupt Claude session: {}", e))
}

#[tauri::command]
pub async fn resume_claude_sdk_session(
    sdk_mgr: State<'_, ClaudeSdkManager>,
    app: tauri::AppHandle,
    task_id: String,
    session_id: String,
    cwd: String,
) -> Result<(), String> {
    sdk_mgr
        .resume_session(app, &task_id, &session_id, &cwd)
        .await
        .map_err(|e| format!("Failed to resume Claude session: {}", e))
}

#[tauri::command]
pub async fn respond_tool_approval(
    sdk_mgr: State<'_, ClaudeSdkManager>,
    task_id: String,
    request_id: String,
    behavior: String,
    message: Option<String>,
) -> Result<(), String> {
    sdk_mgr
        .respond_tool_approval(&task_id, &request_id, &behavior, message.as_deref())
        .await
        .map_err(|e| format!("Failed to respond to tool approval: {}", e))
}
