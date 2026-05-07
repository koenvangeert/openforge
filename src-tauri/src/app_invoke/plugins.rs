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

fn plugin_platform(
    state: &AppState,
    require_app_data_dir: bool,
) -> Result<crate::plugin_platform::PluginPlatform<'_>, (StatusCode, String)> {
    let app_data_dir = if require_app_data_dir {
        Some(app_data_dir(state)?)
    } else {
        None
    };

    Ok(crate::plugin_platform::PluginPlatform::new(
        state.db.as_ref(),
        app_data_dir,
        state.plugin_host.as_ref(),
    ))
}

fn plugin_platform_error_status(message: &str) -> StatusCode {
    if message.starts_with("Unknown plugin:") {
        StatusCode::NOT_FOUND
    } else if message.contains("backend not configured")
        || message.contains("backend entry")
        || message.contains("install root")
    {
        StatusCode::BAD_REQUEST
    } else if message.contains("plugin host state is not available") {
        StatusCode::SERVICE_UNAVAILABLE
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

fn map_plugin_platform_error(message: String) -> (StatusCode, String) {
    (plugin_platform_error_status(&message), message)
}

pub(super) async fn handle_app_plugin_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    let value = match request.command.as_str() {
        "install_plugin" => {
            let plugin = payload_field::<AppInstallPluginRequest>(&request.payload, "plugin")?
                .into_plugin_row();
            plugin_platform(state, false)?
                .install_plugin(&plugin)
                .map_err(map_plugin_platform_error)?;
            serde_json::Value::Null
        }
        "install_plugin_from_local" => {
            let source_path =
                std::path::PathBuf::from(payload_string(&request.payload, "sourcePath")?);
            let plugin = plugin_platform(state, true)?
                .install_local_plugin_bundle(&source_path)
                .map_err(map_plugin_platform_error)?;
            json_value(plugin)?
        }
        "install_plugin_from_npm" => {
            let package_name = payload_string(&request.payload, "packageName")?;
            let plugin = plugin_platform(state, true)?
                .install_npm_plugin_bundle(&package_name)
                .await
                .map_err(map_plugin_platform_error)?;
            json_value(plugin)?
        }
        "uninstall_plugin" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            plugin_platform(state, true)?
                .uninstall_plugin(&plugin_id)
                .map_err(map_plugin_platform_error)?;
            serde_json::Value::Null
        }
        "get_plugin" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            json_value(
                plugin_platform(state, false)?
                    .plugin(&plugin_id)
                    .map_err(map_plugin_platform_error)?,
            )?
        }
        "list_plugins" => json_value(
            plugin_platform(state, false)?
                .plugins()
                .map_err(map_plugin_platform_error)?,
        )?,
        "set_plugin_enabled" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let enabled = payload_bool(&request.payload, "enabled")?;
            plugin_platform(state, false)?
                .set_plugin_enabled(&project_id, &plugin_id, enabled)
                .map_err(map_plugin_platform_error)?;
            serde_json::Value::Null
        }
        "get_enabled_plugins" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            json_value(
                plugin_platform(state, false)?
                    .enabled_plugins(&project_id)
                    .map_err(map_plugin_platform_error)?,
            )?
        }
        "get_plugin_storage" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let key = payload_string(&request.payload, "key")?;
            json_value(
                plugin_platform(state, false)?
                    .plugin_storage(&plugin_id, &key)
                    .map_err(map_plugin_platform_error)?,
            )?
        }
        "set_plugin_storage" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let key = payload_string(&request.payload, "key")?;
            let value = payload_string(&request.payload, "value")?;
            plugin_platform(state, false)?
                .set_plugin_storage(&plugin_id, &key, &value)
                .map_err(map_plugin_platform_error)?;
            serde_json::Value::Null
        }
        "resolve_plugin_asset_root" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            json_value(
                plugin_platform(state, false)?
                    .resolve_plugin_asset_root(&plugin_id)
                    .map_err(map_plugin_platform_error)?,
            )?
        }
        "plugin_invoke" => {
            let plugin_id = payload_string(&request.payload, "pluginId")?;
            let command = payload_string(&request.payload, "command")?;
            let payload = request
                .payload
                .get("payload")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            plugin_platform(state, false)?
                .invoke_backend(&plugin_id, &command, payload)
                .await
                .map_err(map_plugin_platform_error)?
        }
        "stop_plugin_sidecar" => {
            plugin_platform(state, false)?
                .stop_sidecar()
                .await
                .map_err(map_plugin_platform_error)?;
            serde_json::Value::Null
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}
