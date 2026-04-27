use crate::db;
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

fn builtin_install_path(plugin_id: &str) -> String {
    crate::builtin_plugins::sentinel_install_path(plugin_id)
}

fn is_known_builtin_plugin(plugin_id: &str) -> bool {
    crate::builtin_plugins::is_known(plugin_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPluginRequest {
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
    #[serde(rename = "isBuiltin")]
    _is_builtin: bool,
}

impl InstallPluginRequest {
    fn into_plugin_row(self) -> db::PluginRow {
        let is_builtin = is_known_builtin_plugin(&self.id)
            && crate::builtin_plugins::has_sentinel_install_path(&self.id, &self.install_path);

        db::PluginRow {
            id: self.id,
            name: self.name,
            version: self.version,
            api_version: self.api_version,
            description: self.description,
            permissions: self.permissions,
            contributes: self.contributes,
            frontend_entry: self.frontend_entry,
            backend_entry: self.backend_entry,
            install_path: self.install_path,
            installed_at: self.installed_at,
            is_builtin,
        }
    }
}

fn resolve_backend_entry_path(
    install_root: &std::path::Path,
    backend_entry: &str,
) -> Result<PathBuf, String> {
    let backend_entry_path = std::path::Path::new(backend_entry);
    if backend_entry_path.is_absolute() {
        return Err("plugin backend entry must stay within the plugin install root".to_string());
    }

    if backend_entry_path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("plugin backend entry must stay within the plugin install root".to_string());
    }

    let backend_path = install_root.join(backend_entry_path);
    if !backend_path.is_file() {
        return Err(format!(
            "Plugin backend entry does not exist: {}",
            backend_path.display()
        ));
    }

    let canonical_install_root = install_root.canonicalize().map_err(|error| {
        format!(
            "Failed to canonicalize plugin install root {}: {error}",
            install_root.display()
        )
    })?;
    let canonical_backend_path = backend_path.canonicalize().map_err(|error| {
        format!(
            "Failed to canonicalize plugin backend entry {}: {error}",
            backend_path.display()
        )
    })?;

    if !canonical_backend_path.starts_with(&canonical_install_root) {
        return Err("plugin backend entry must stay within the plugin install root".to_string());
    }

    Ok(canonical_backend_path)
}

#[tauri::command]
pub async fn install_plugin(
    db: State<'_, Arc<Mutex<db::Database>>>,
    plugin: InstallPluginRequest,
) -> Result<(), String> {
    let plugin = plugin.into_plugin_row();
    let db = crate::db::acquire_db(&db);
    db.install_plugin(&plugin)
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
    let plugin =
        crate::plugin_installation::install_local_plugin_bundle(&source_path, &app_data_dir)?;
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
    let plugin =
        crate::plugin_installation::install_npm_plugin_bundle(&package_name, &app_data_dir).await?;
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
    let backend_path = resolve_backend_entry_path(&install_root, &backend_entry)?;

    plugin_host
        .invoke_backend(&plugin_id, &command, &backend_path, payload)
        .await
}

fn resolve_plugin_install_root(plugin: &db::PluginRow) -> Result<PathBuf, String> {
    if plugin.is_builtin && plugin.install_path == builtin_install_path(&plugin.id) {
        return crate::builtin_plugins::install_path(&plugin.id);
    }

    Ok(PathBuf::from(&plugin.install_path))
}

#[cfg(test)]
mod tests {
    use super::{
        builtin_install_path, is_known_builtin_plugin, resolve_backend_entry_path,
        InstallPluginRequest,
    };
    use crate::builtin_plugins;
    use std::fs;

    #[test]
    fn builtin_detection_only_accepts_catalog_ids_with_exact_sentinel() {
        let plugin = builtin_plugins::find("com.openforge.github-sync")
            .expect("github sync should be in builtin catalog");

        assert!(is_known_builtin_plugin(plugin.id));
        assert_eq!(
            builtin_install_path(plugin.id),
            plugin.sentinel_install_path()
        );
        assert_eq!(plugin.directory_name, "github-sync");
        assert!(!is_known_builtin_plugin("com.example.custom"));
    }

    #[test]
    fn install_plugin_request_derives_builtin_status_from_catalog_and_path() {
        let plugin = builtin_plugins::find("com.openforge.github-sync")
            .expect("github sync should be in builtin catalog");
        let request = InstallPluginRequest {
            id: plugin.id.to_string(),
            name: "GitHub Sync".to_string(),
            version: "1.0.0".to_string(),
            api_version: 1,
            description: "Sync GitHub pull requests".to_string(),
            permissions: "[]".to_string(),
            contributes: "{}".to_string(),
            frontend_entry: String::new(),
            backend_entry: None,
            install_path: plugin.sentinel_install_path(),
            installed_at: 1000,
            _is_builtin: false,
        };

        let row = request.into_plugin_row();

        assert!(row.is_builtin);
    }

    #[test]
    fn resolve_backend_entry_path_rejects_traversal() {
        let temp = tempfile::tempdir().expect("tempdir should create");
        let install_root = temp.path();
        fs::write(
            install_root.join("backend.js"),
            "export async function run() {}",
        )
        .expect("backend file should write");

        let path = resolve_backend_entry_path(install_root, "backend.js")
            .expect("backend path should resolve");
        assert!(path.ends_with("backend.js"));

        let traversal_err = resolve_backend_entry_path(install_root, "../backend.js")
            .expect_err("traversal path should be rejected");
        assert!(traversal_err.contains("must stay within the plugin install root"));

        let absolute_err = resolve_backend_entry_path(install_root, "/tmp/backend.js")
            .expect_err("absolute path should be rejected");
        assert!(absolute_err.contains("must stay within the plugin install root"));
    }
}
