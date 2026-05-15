use super::*;

fn builtin_plugin_payload(plugin_id: &str, name: &str, is_builtin: bool) -> serde_json::Value {
    json!({
        "plugin": {
            "id": plugin_id,
            "name": name,
            "version": "1.0.0",
            "apiVersion": 1,
            "description": "Builtin plugin",
            "permissions": "[]",
            "contributes": "{}",
            "frontendEntry": "./dist/frontend.js",
            "backendEntry": null,
            "installPath": format!("builtin:{plugin_id}"),
            "sourceKind": "builtin",
            "sourceSpec": plugin_id,
            "packageMetadata": "{}",
            "installedAt": 123,
            "isBuiltin": is_builtin
        }
    })
}

fn external_plugin_payload() -> serde_json::Value {
    json!({
        "plugin": {
            "id": "com.example.external-row",
            "name": "External Row",
            "version": "1.0.0",
            "apiVersion": 1,
            "description": "External plugin row",
            "permissions": "[]",
            "contributes": "{}",
            "frontendEntry": "index.js",
            "backendEntry": null,
            "installPath": "/tmp/external-row",
            "sourceKind": "legacy",
            "sourceSpec": "",
            "packageMetadata": "{}",
            "installedAt": 123,
            "isBuiltin": false
        }
    })
}

fn write_local_plugin_package(source_path: &std::path::Path, plugin_id: &str) {
    std::fs::create_dir_all(source_path.join("dist")).expect("dist dir");
    std::fs::write(source_path.join("dist/index.js"), "export const x = 1;")
        .expect("frontend entry");
    std::fs::write(
        source_path.join("package.json"),
        format!(
            r#"{{
                "name": "@example/local-sidecar",
                "version": "1.0.0",
                "openforge": {{
                    "id": "{plugin_id}",
                    "apiVersion": 1,
                    "displayName": "Local Sidecar Plugin",
                    "description": "A local plugin",
                    "frontend": "dist/index.js"
                }}
            }}"#
        ),
    )
    .expect("package.json");
}

#[tokio::test]
async fn register_builtin_plugin_rejects_external_plugin_rows() {
    let (state, path, _app_dir) =
        test_state_with_backend_app("app_invoke_builtin_rejects_external_row");

    let err = invoke(&state, "register_builtin_plugin", external_plugin_payload())
        .await
        .expect_err("external rows must not use the trusted builtin registration path");

    assert_eq!(err.0, StatusCode::BAD_REQUEST);
    assert!(err.1.contains("built-in plugin"));
    assert!(invoke_ok(
        &state,
        "get_plugin",
        json!({ "pluginId": "com.example.external-row" }),
    )
    .await
    .is_null());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn register_builtin_plugin_recomputes_builtin_identity() {
    let (state, path, _app_dir) =
        test_state_with_backend_app("app_invoke_builtin_recomputes_identity");

    invoke_ok(
        &state,
        "register_builtin_plugin",
        builtin_plugin_payload("com.openforge.file-viewer", "File Viewer", false),
    )
    .await;

    let installed = invoke_ok(
        &state,
        "get_plugin",
        json!({ "pluginId": "com.openforge.file-viewer" }),
    )
    .await;
    assert_eq!(installed["id"], "com.openforge.file-viewer");
    assert_eq!(installed["is_builtin"], true);
    assert_eq!(installed["source_kind"], "builtin");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn handles_db_backed_commands() {
    let (state, path, _app_dir) = test_state_with_backend_app("app_invoke_plugin_db_backed");
    let project_id = {
        let db = state.db.lock().expect("db lock");
        db.create_project("Open Forge", "/tmp/openforge")
            .expect("create project")
            .id
    };

    invoke_ok(
        &state,
        "register_builtin_plugin",
        builtin_plugin_payload("com.openforge.github-sync", "GitHub Sync", true),
    )
    .await;
    let list = invoke_ok(&state, "list_plugins", serde_json::Value::Null).await;
    assert_eq!(list[0]["id"], "com.openforge.github-sync");
    assert_eq!(list[0]["api_version"], 1);

    invoke_ok(
        &state,
        "set_plugin_enabled",
        json!({ "projectId": project_id, "pluginId": "com.openforge.github-sync", "enabled": true }),
    )
    .await;
    assert_eq!(
        invoke_ok(
            &state,
            "get_enabled_plugins",
            json!({ "projectId": project_id })
        )
        .await[0]["id"],
        "com.openforge.github-sync"
    );

    invoke_ok(
        &state,
        "set_plugin_storage",
        json!({ "pluginId": "com.openforge.github-sync", "scope": "project", "scopeId": project_id, "key": "settings", "value": { "token": "secret" } }),
    )
    .await;
    assert_eq!(
        invoke_ok(
            &state,
            "get_plugin_storage",
            json!({ "pluginId": "com.openforge.github-sync", "scope": "project", "scopeId": project_id, "key": "settings" }),
        )
        .await,
        json!({ "token": "secret" })
    );
    assert!(invoke_ok(
        &state,
        "get_plugin_storage",
        json!({ "pluginId": "com.openforge.github-sync", "scope": "task", "scopeId": "T-1", "key": "settings" }),
    )
    .await
    .is_null());
    invoke_ok(
        &state,
        "delete_plugin_storage",
        json!({ "pluginId": "com.openforge.github-sync", "scope": "project", "scopeId": project_id, "key": "settings" }),
    )
    .await;
    assert!(invoke_ok(
        &state,
        "get_plugin_storage",
        json!({ "pluginId": "com.openforge.github-sync", "scope": "project", "scopeId": project_id, "key": "settings" }),
    )
    .await
    .is_null());

    invoke_ok(
        &state,
        "uninstall_plugin",
        json!({ "pluginId": "com.openforge.github-sync" }),
    )
    .await;
    assert!(invoke_ok(
        &state,
        "get_plugin",
        json!({ "pluginId": "com.openforge.github-sync" }),
    )
    .await
    .is_null());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn resolves_plugin_asset_roots_through_rust_plugin_platform() {
    let (state, path, _app_dir) = test_state_with_backend_app("app_invoke_plugin_asset_roots");
    let source = tempfile::tempdir().expect("source plugin dir");
    write_local_plugin_package(source.path(), "com.example.assets");

    invoke_ok(
        &state,
        "install_plugin_from_local",
        json!({ "sourcePath": source.path() }),
    )
    .await;
    let external = invoke_ok(
        &state,
        "resolve_plugin_asset_root",
        json!({ "pluginId": "com.example.assets" }),
    )
    .await;
    assert_eq!(external["plugin_id"], "com.example.assets");
    assert_eq!(
        external["asset_root"].as_str().expect("asset root string"),
        source.path().canonicalize().unwrap().to_string_lossy()
    );
    assert_eq!(external["is_builtin"], false);

    invoke_ok(
        &state,
        "register_builtin_plugin",
        builtin_plugin_payload("com.openforge.file-viewer", "File Viewer", true),
    )
    .await;
    let builtin = invoke_ok(
        &state,
        "resolve_plugin_asset_root",
        json!({ "pluginId": "com.openforge.file-viewer" }),
    )
    .await;
    assert_eq!(builtin["plugin_id"], "com.openforge.file-viewer");
    assert!(builtin["asset_root"]
        .as_str()
        .expect("builtin asset root should be a string")
        .ends_with("plugins/file-viewer"));
    assert_eq!(builtin["is_builtin"], true);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn installs_local_plugin_with_backend_app_path_state() {
    let (state, path, _app_dir) =
        test_state_with_backend_app("app_invoke_local_plugin_backend_paths");
    let source = tempfile::tempdir().expect("source plugin dir");
    write_local_plugin_package(source.path(), "com.example.local-sidecar");

    let installed = invoke_ok(
        &state,
        "install_plugin_from_local",
        json!({ "sourcePath": source.path() }),
    )
    .await;

    assert_eq!(installed["id"], "com.example.local-sidecar");
    assert_eq!(installed["source_kind"], "local");
    assert_eq!(
        installed["install_path"]
            .as_str()
            .expect("install_path should be a string"),
        source.path().canonicalize().unwrap().to_string_lossy()
    );
    let _ = std::fs::remove_file(path);
}
