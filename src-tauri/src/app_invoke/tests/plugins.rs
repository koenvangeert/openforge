use super::*;

#[tokio::test]
async fn handles_db_backed_commands() {
    let (state, path, _app_dir) = test_state_with_backend_app("app_invoke_plugin_db_backed");
    let project_id = {
        let db = state.db.lock().expect("db lock");
        db.create_project("Open Forge", "/tmp/openforge")
            .expect("create project")
            .id
    };

    invoke_ok(&state, "install_plugin", json!({"plugin":{"id":"com.example.echo","name":"Echo","version":"1.0.0","apiVersion":1,"description":"Echo plugin","permissions":"[]","contributes":"{}","frontendEntry":"index.js","backendEntry":null,"installPath":"/tmp/plugin","installedAt":123,"isBuiltin":false}})).await;
    let list = invoke_ok(&state, "list_plugins", serde_json::Value::Null).await;
    assert_eq!(list[0]["id"], "com.example.echo");
    assert_eq!(list[0]["api_version"], 1);

    invoke_ok(
        &state,
        "set_plugin_enabled",
        json!({ "projectId": project_id, "pluginId": "com.example.echo", "enabled": true }),
    )
    .await;
    assert_eq!(
        invoke_ok(
            &state,
            "get_enabled_plugins",
            json!({ "projectId": project_id })
        )
        .await[0]["id"],
        "com.example.echo"
    );

    invoke_ok(
        &state,
        "set_plugin_storage",
        json!({ "pluginId": "com.example.echo", "key": "token", "value": "secret" }),
    )
    .await;
    assert_eq!(
        invoke_ok(
            &state,
            "get_plugin_storage",
            json!({ "pluginId": "com.example.echo", "key": "token" }),
        )
        .await,
        "secret"
    );

    invoke_ok(
        &state,
        "uninstall_plugin",
        json!({ "pluginId": "com.example.echo" }),
    )
    .await;
    assert!(invoke_ok(
        &state,
        "get_plugin",
        json!({ "pluginId": "com.example.echo" }),
    )
    .await
    .is_null());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn installs_local_plugin_with_backend_app_path_state() {
    let (state, path, _app_dir) =
        test_state_with_backend_app("app_invoke_local_plugin_backend_paths");
    let source = tempfile::tempdir().expect("source plugin dir");
    std::fs::create_dir_all(source.path().join("dist")).expect("dist dir");
    std::fs::write(source.path().join("dist/index.js"), "export const x = 1;")
        .expect("frontend entry");
    std::fs::write(
        source.path().join("manifest.json"),
        r#"{
                "id": "com.example.local-sidecar",
                "name": "Local Sidecar Plugin",
                "version": "1.0.0",
                "apiVersion": 1,
                "description": "A local plugin",
                "permissions": [],
                "contributes": {},
                "frontend": "dist/index.js",
                "backend": null
            }"#,
    )
    .expect("manifest");

    let installed = invoke_ok(
        &state,
        "install_plugin_from_local",
        json!({ "sourcePath": source.path() }),
    )
    .await;

    assert_eq!(installed["id"], "com.example.local-sidecar");
    let _ = std::fs::remove_file(path);
}
