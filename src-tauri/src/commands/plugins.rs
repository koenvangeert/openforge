use crate::db;
use std::sync::{Arc, Mutex};
use tauri::State;

#[tauri::command]
pub async fn install_plugin(
    db: State<'_, Arc<Mutex<db::Database>>>,
    id: String,
    name: String,
    version: String,
    api_version: i64,
    description: String,
    permissions: String,
    contributes: String,
    frontend_entry: String,
    backend_entry: Option<String>,
    install_path: String,
    installed_at: i64,
    is_builtin: bool,
) -> Result<(), String> {
    let db = crate::db::acquire_db(&db);
    db.install_plugin(&db::PluginRow {
        id,
        name,
        version,
        api_version,
        description,
        permissions,
        contributes,
        frontend_entry,
        backend_entry,
        install_path,
        installed_at,
        is_builtin,
    })
    .map_err(|e| format!("Failed to install plugin: {}", e))
}

#[tauri::command]
pub async fn uninstall_plugin(
    db: State<'_, Arc<Mutex<db::Database>>>,
    plugin_id: String,
) -> Result<(), String> {
    let db = crate::db::acquire_db(&db);
    db.uninstall_plugin(&plugin_id)
        .map_err(|e| format!("Failed to uninstall plugin: {}", e))
}

#[tauri::command]
pub async fn get_plugin(
    db: State<'_, Arc<Mutex<db::Database>>>,
    plugin_id: String,
) -> Result<Option<db::PluginRow>, String> {
    let db = crate::db::acquire_db(&db);
    db.get_plugin(&plugin_id)
        .map_err(|e| format!("Failed to get plugin: {}", e))
}

#[tauri::command]
pub async fn list_plugins(
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<db::PluginRow>, String> {
    let db = crate::db::acquire_db(&db);
    db.list_plugins()
        .map_err(|e| format!("Failed to list plugins: {}", e))
}

#[tauri::command]
pub async fn set_plugin_enabled(
    db: State<'_, Arc<Mutex<db::Database>>>,
    project_id: String,
    plugin_id: String,
    enabled: bool,
) -> Result<(), String> {
    let db = crate::db::acquire_db(&db);
    db.set_plugin_enabled(&project_id, &plugin_id, enabled)
        .map_err(|e| format!("Failed to set plugin enabled: {}", e))
}

#[tauri::command]
pub async fn get_enabled_plugins(
    db: State<'_, Arc<Mutex<db::Database>>>,
    project_id: String,
) -> Result<Vec<db::PluginRow>, String> {
    let db = crate::db::acquire_db(&db);
    db.get_enabled_plugins(&project_id)
        .map_err(|e| format!("Failed to get enabled plugins: {}", e))
}

#[tauri::command]
pub async fn get_plugin_storage(
    db: State<'_, Arc<Mutex<db::Database>>>,
    plugin_id: String,
    key: String,
) -> Result<Option<String>, String> {
    let db = crate::db::acquire_db(&db);
    db.get_plugin_storage(&plugin_id, &key)
        .map_err(|e| format!("Failed to get plugin storage: {}", e))
}

#[tauri::command]
pub async fn set_plugin_storage(
    db: State<'_, Arc<Mutex<db::Database>>>,
    plugin_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let db = crate::db::acquire_db(&db);
    db.set_plugin_storage(&plugin_id, &key, &value)
        .map_err(|e| format!("Failed to set plugin storage: {}", e))
}

#[tauri::command]
pub async fn plugin_invoke(
    plugin_id: String,
    command: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let (id, _request) = crate::plugin_rpc::format_request(&plugin_id, &command, payload);
    let timeout = crate::plugin_rpc::DEFAULT_TIMEOUT;
    let message =
        crate::plugin_rpc::rpc_error_from_code(-32601, "plugin backend transport not connected");
    let raw_response = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": -32601,
            "message": message,
        }
    })
    .to_string();

    match crate::plugin_rpc::parse_response(&raw_response) {
        Ok(crate::plugin_rpc::RpcResult::Success(value)) => Ok(value),
        Ok(crate::plugin_rpc::RpcResult::Error(_code, _message)) => Err(format!(
            "Plugin backend not yet connected: {} (timeout {:?})",
            plugin_id, timeout
        )),
        Err(error) => Err(error.0),
    }
}
