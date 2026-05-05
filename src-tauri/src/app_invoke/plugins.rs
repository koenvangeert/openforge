use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppInstallPluginRequest {
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

impl AppInstallPluginRequest {
    fn into_plugin_row(self) -> db::PluginRow {
        let is_builtin = crate::builtin_plugins::is_known(&self.id)
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

fn app_data_dir(state: &AppState) -> Result<std::path::PathBuf, (StatusCode, String)> {
    let Some(app) = state.app.as_ref() else {
        return Err((
            StatusCode::NOT_IMPLEMENTED,
            "app IPC command requires app data path state before Electron sidecar support"
                .to_string(),
        ));
    };

    app.path().app_data_dir().map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to resolve app data directory: {error}"),
        )
    })
}

fn app_resolve_plugin_install_root(plugin: &db::PluginRow) -> Result<std::path::PathBuf, String> {
    if plugin.is_builtin
        && plugin.install_path == crate::builtin_plugins::sentinel_install_path(&plugin.id)
    {
        return crate::builtin_plugins::install_path(&plugin.id);
    }

    Ok(std::path::PathBuf::from(&plugin.install_path))
}

fn app_resolve_backend_entry_path(
    install_root: &std::path::Path,
    backend_entry: &str,
) -> Result<std::path::PathBuf, String> {
    let backend_entry_path = std::path::Path::new(backend_entry);
    if backend_entry_path.is_absolute()
        || backend_entry_path
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

pub(super) async fn handle_app_plugin_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    let value = match request.command.as_str() {
        "install_plugin" => {
            let plugin = payload_field::<AppInstallPluginRequest>(&request.payload, "plugin")?
                .into_plugin_row();
            let db = crate::db::acquire_db(&state.db);
            db.install_plugin(&plugin).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to install plugin: {e}"),
                )
            })?;
            serde_json::Value::Null
        }
        "install_plugin_from_local" => {
            let source_path =
                std::path::PathBuf::from(payload_string(&request.payload, "sourcePath")?);
            let app_data_dir = app_data_dir(state)?;
            let plugin = crate::plugin_installation::install_local_plugin_bundle(
                &source_path,
                &app_data_dir,
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            let db = crate::db::acquire_db(&state.db);
            db.install_plugin(&plugin).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to install local plugin: {e}"),
                )
            })?;
            json_value(plugin)?
        }
        "install_plugin_from_npm" => {
            let package_name = payload_string(&request.payload, "packageName")?;
            let app_data_dir = app_data_dir(state)?;
            let plugin =
                crate::plugin_installation::install_npm_plugin_bundle(&package_name, &app_data_dir)
                    .await
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            let db = crate::db::acquire_db(&state.db);
            db.install_plugin(&plugin).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to install npm plugin: {e}"),
                )
            })?;
            json_value(plugin)?
        }
        "uninstall_plugin" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let plugin = {
                let db = crate::db::acquire_db(&state.db);
                db.get_plugin(&plugin_id).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to read plugin before uninstall: {e}"),
                    )
                })?
            };
            if let Some(plugin) = plugin.as_ref() {
                let app_data_dir = app_data_dir(state)?;
                crate::plugin_installation::uninstall_managed_plugin(plugin, &app_data_dir)
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            }
            let db = crate::db::acquire_db(&state.db);
            db.uninstall_plugin(&plugin_id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to uninstall plugin: {e}"),
                )
            })?;
            serde_json::Value::Null
        }
        "get_plugin" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let db = crate::db::acquire_db(&state.db);
            json_value(db.get_plugin(&plugin_id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get plugin: {e}"),
                )
            })?)?
        }
        "list_plugins" => {
            let db = crate::db::acquire_db(&state.db);
            json_value(db.list_plugins().map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to list plugins: {e}"),
                )
            })?)?
        }
        "set_plugin_enabled" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let enabled = payload_bool(&request.payload, "enabled")?;
            let db = crate::db::acquire_db(&state.db);
            db.set_plugin_enabled(&project_id, &plugin_id, enabled)
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to set plugin enabled: {e}"),
                    )
                })?;
            serde_json::Value::Null
        }
        "get_enabled_plugins" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let db = crate::db::acquire_db(&state.db);
            json_value(db.get_enabled_plugins(&project_id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get enabled plugins: {e}"),
                )
            })?)?
        }
        "get_plugin_storage" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let key = payload_string(&request.payload, "key")?;
            let db = crate::db::acquire_db(&state.db);
            json_value(db.get_plugin_storage(&plugin_id, &key).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get plugin storage: {e}"),
                )
            })?)?
        }
        "set_plugin_storage" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let key = payload_string(&request.payload, "key")?;
            let value = payload_string(&request.payload, "value")?;
            let db = crate::db::acquire_db(&state.db);
            db.set_plugin_storage(&plugin_id, &key, &value)
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to set plugin storage: {e}"),
                    )
                })?;
            serde_json::Value::Null
        }
        "plugin_invoke" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let command = payload_string(&request.payload, "command")?;
            let payload = request
                .payload
                .get("payload")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            let plugin = {
                let db = crate::db::acquire_db(&state.db);
                db.get_plugin(&plugin_id)
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to load plugin metadata: {e}"),
                        )
                    })?
                    .ok_or_else(|| {
                        (
                            StatusCode::NOT_FOUND,
                            format!("Unknown plugin: {plugin_id}"),
                        )
                    })?
            };
            let backend_entry = plugin.backend_entry.clone().ok_or_else(|| {
                (
                    StatusCode::BAD_REQUEST,
                    format!("Plugin backend not configured for {plugin_id}"),
                )
            })?;
            let install_root = app_resolve_plugin_install_root(&plugin)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            let backend_path = app_resolve_backend_entry_path(&install_root, &backend_entry)
                .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
            let plugin_host = state.plugin_host.as_ref().ok_or_else(|| {
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "plugin host state is not available".to_string(),
                )
            })?;
            plugin_host
                .invoke_backend(&plugin_id, &command, &backend_path, payload)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
        }
        "stop_plugin_sidecar" => {
            let plugin_host = state.plugin_host.as_ref().ok_or_else(|| {
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "plugin host state is not available".to_string(),
                )
            })?;
            plugin_host
                .stop_sidecar()
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            serde_json::Value::Null
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}
