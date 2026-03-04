use std::sync::{Mutex, Arc};
use tauri::State;
use crate::{db, opencode_client::OpenCodeClient, server_manager::ServerManager, sse_bridge::SseBridgeManager, pty_manager::PtyManager};

#[tauri::command]
pub async fn get_session_status(
    db: State<'_, Arc<Mutex<db::Database>>>,
    session_id: String,
) -> Result<db::AgentSessionRow, String> {
    let db_lock = db.lock().unwrap();
    db_lock
        .get_agent_session(&session_id)
        .map_err(|e| format!("Failed to get session status: {}", e))?
        .ok_or_else(|| format!("Session {} not found", session_id))
}

#[tauri::command]
pub async fn abort_session(
    db: State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: State<'_, ServerManager>,
    sse_mgr: State<'_, SseBridgeManager>,
    pty_mgr: State<'_, PtyManager>,
    _app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    // 1. Look up the session to get task_id and provider
    let session = {
        let db_lock = db.lock().unwrap();
        db_lock
            .get_agent_session(&session_id)
            .map_err(|e| format!("Failed to get session: {}", e))?
            .ok_or_else(|| format!("Session {} not found", session_id))?
    };
    let task_id = &session.ticket_id;

    // 2. Create provider from session's provider field
    let provider = crate::providers::Provider::from_name(
        &session.provider,
        pty_mgr.inner().clone(),
        server_mgr.inner().clone(),
        sse_mgr.inner().clone(),
    ).map_err(|e| format!("Unknown provider: {}", e))?;

    // 3. Abort via provider (handles PTY kill for Claude, HTTP abort + SSE/server stop for OpenCode)
    let _ = provider.abort(task_id, &session).await;

    // 4. Update session status (orchestration-level concern)
    // Claude uses "interrupted", OpenCode uses "failed"
    let abort_status = if session.provider == "claude-code" { "interrupted" } else { "failed" };
    {
        let db_lock = db.lock().unwrap();
        let _ = db_lock.update_agent_session(&session.id, "implementing", abort_status, None, Some("Aborted by user"));
    }

    // 5. Update worktree status for OpenCode
    if session.provider != "claude-code" {
        let db = db.lock().unwrap();
        let _ = db.update_worktree_status(task_id, "stopped");
    }

    Ok(())
}

/// Get agent logs for a session
#[tauri::command]
pub async fn get_agent_logs(
    db: State<'_, Arc<Mutex<db::Database>>>,
    session_id: String,
) -> Result<Vec<db::AgentLogRow>, String> {
    let db_lock = db.lock().unwrap();
    db_lock.get_agent_logs(&session_id)
        .map_err(|e| format!("Failed to get agent logs: {}", e))
}

#[tauri::command]
pub async fn get_latest_session(
    db: State<'_, Arc<Mutex<db::Database>>>,
    task_id: String,
) -> Result<Option<db::AgentSessionRow>, String> {
    let db_lock = db.lock().unwrap();
    db_lock
        .get_latest_session_for_ticket(&task_id)
        .map_err(|e| format!("Failed to get latest session: {}", e))
}

#[tauri::command]
pub async fn get_latest_sessions(
    db: State<'_, Arc<Mutex<db::Database>>>,
    task_ids: Vec<String>,
) -> Result<Vec<db::AgentSessionRow>, String> {
    let db_lock = db.lock().unwrap();
    db_lock
        .get_latest_sessions_for_tickets(&task_ids)
        .map_err(|e| format!("Failed to get sessions: {}", e))
}

#[tauri::command]
pub async fn get_session_output(
    db: State<'_, Arc<Mutex<db::Database>>>,

    server_mgr: State<'_, ServerManager>,
    task_id: String,
) -> Result<String, String> {
    let (opencode_session_id, worktree_path) = {
        let db_lock = db.lock().unwrap();
        let session = db_lock
            .get_latest_session_for_ticket(&task_id)
            .map_err(|e| format!("Failed to get session: {}", e))?
            .ok_or_else(|| format!("No session found for task {}", task_id))?;
        let oc_id = session
            .opencode_session_id
            .ok_or_else(|| "Session has no OpenCode session ID".to_string())?;
        let wt = db_lock
            .get_worktree_for_task(&task_id)
            .map_err(|e| format!("Failed to get worktree: {}", e))?
            .map(|w| w.worktree_path);
        (oc_id, wt)
    };

    let existing_port = server_mgr.get_server_port(&task_id).await;
    let spawned_server = existing_port.is_none();

    let port = match existing_port {
        Some(port) => port,
        None => {
            let wt_path = worktree_path
                .ok_or_else(|| "No worktree found for this task".to_string())?;
            server_mgr
                .spawn_server(&task_id, std::path::Path::new(&wt_path))
                .await
                .map_err(|e| format!("Failed to start OpenCode server: {}", e))?
        }
    };

    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    let messages = client
        .get_session_messages(&opencode_session_id)
        .await
        .map_err(|e| format!("Failed to fetch session messages: {}", e))?;

    let mut output = String::new();
    for msg in &messages {
        let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");
        if role != "assistant" {
            continue;
        }
        if let Some(parts) = msg.get("parts").and_then(|p| p.as_array()) {
            for part in parts {
                let part_type = part.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if part_type == "text" {
                    if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                        output.push_str(text);
                    }
                }
            }
        }
    }

    // Stop server if we spawned it just for this query
    if spawned_server {
        let _ = server_mgr.stop_server(&task_id).await;
    }

    Ok(output)
}
