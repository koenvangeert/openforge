use crate::db;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

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
    app_handle: AppHandle,
    db: State<'_, Arc<Mutex<db::Database>>>,
    plugin_id: String,
) -> Result<(), String> {
    let db = crate::db::acquire_db(&db);
    if let Some(plugin) = db
        .get_plugin(&plugin_id)
        .map_err(|e| format!("Failed to read plugin before uninstall: {}", e))?
    {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
        crate::plugin_installation::uninstall_managed_plugin(&plugin, &app_data_dir)?;
    }
    db.uninstall_plugin(&plugin_id)
        .map_err(|e| format!("Failed to uninstall plugin: {}", e))
}

#[tauri::command]
pub async fn install_plugin_from_local(
    app_handle: AppHandle,
    db: State<'_, Arc<Mutex<db::Database>>>,
    source_path: String,
) -> Result<db::PluginRow, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let source_path = PathBuf::from(source_path);
    let plugin = crate::plugin_installation::install_local_plugin_bundle(&source_path, &app_data_dir)?;
    let db = crate::db::acquire_db(&db);
    db.install_plugin(&plugin)
        .map_err(|e| format!("Failed to install local plugin: {}", e))?;
    Ok(plugin)
}

#[tauri::command]
pub async fn install_plugin_from_npm(
    app_handle: AppHandle,
    db: State<'_, Arc<Mutex<db::Database>>>,
    package_name: String,
) -> Result<db::PluginRow, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let plugin = crate::plugin_installation::install_npm_plugin_bundle(&package_name, &app_data_dir).await?;
    let db = crate::db::acquire_db(&db);
    db.install_plugin(&plugin)
        .map_err(|e| format!("Failed to install npm plugin: {}", e))?;
    Ok(plugin)
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
    plugin_host: State<'_, crate::plugin_host::PluginHost>,
    db: State<'_, Arc<Mutex<db::Database>>>,
    plugin_id: String,
    command: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let plugin = {
        let db = crate::db::acquire_db(&db);
        db.get_plugin(&plugin_id)
            .map_err(|e| format!("Failed to load plugin metadata: {}", e))?
            .ok_or_else(|| format!("Unknown plugin: {}", plugin_id))?
    };
    let backend_entry = plugin
        .backend_entry
        .clone()
        .ok_or_else(|| format!("Plugin backend not configured for {}", plugin_id))?;
    let install_root = resolve_plugin_install_root(&plugin)?;
    let backend_path = install_root.join(&backend_entry);
    if !backend_path.is_file() {
        return Err(format!(
            "Plugin backend entry does not exist: {}",
            backend_path.display()
        ));
    }

    plugin_host
        .invoke_backend(&plugin_id, &command, &backend_path, payload)
        .await
}

fn resolve_plugin_install_root(plugin: &db::PluginRow) -> Result<PathBuf, String> {
    if plugin.is_builtin && plugin.install_path.starts_with("builtin:") {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("plugins")
            .join(match plugin.id.as_str() {
                "com.openforge.file-viewer" => "file-viewer",
                "com.openforge.github-sync" => "github-sync",
                "com.openforge.skills-viewer" => "skills-viewer",
                "com.openforge.terminal" => "terminal",
                _ => return Err(format!("Unknown builtin plugin: {}", plugin.id)),
            }));
    }

    Ok(PathBuf::from(&plugin.install_path))
}
