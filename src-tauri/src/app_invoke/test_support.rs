use crate::{
    backend_runtime::AppHandle,
    github_client::GitHubClient,
    http_server::{electron_sidecar_app_handle, AppInvokeRequest, AppState, SidecarReadinessState},
    plugin_host::PluginHost,
    pty_manager::PtyManager,
    whisper_manager::{WhisperManager, WhisperModelSize},
};
use axum::http::StatusCode;
use std::sync::{Arc, Mutex};

pub(crate) fn test_state(name: &str) -> (AppState, std::path::PathBuf) {
    let (db, path) = crate::db::test_helpers::make_test_db(name);
    let (app_event_tx, _) = tokio::sync::broadcast::channel(16);
    (
        AppState {
            app: None,
            db: Arc::new(Mutex::new(db)),
            backend_token: Some("test-token".to_string()),
            pty_manager: Some(PtyManager::new()),
            github_client: GitHubClient::new(),
            plugin_host: Some(PluginHost::new(AppHandle::new())),
            app_event_tx: Some(app_event_tx),
            app_event_bus: None,
            whisper: Some(Arc::new(WhisperManager::with_active_model(
                WhisperModelSize::Small,
            ))),
            sidecar_readiness: SidecarReadinessState::new(),
        },
        path,
    )
}

pub(crate) fn test_state_with_backend_app(
    name: &str,
) -> (AppState, std::path::PathBuf, tempfile::TempDir) {
    let (mut state, db_path) = test_state(name);
    let app_dir = tempfile::tempdir().expect("app data dir should create");
    let app =
        electron_sidecar_app_handle(app_dir.path().to_path_buf(), app_dir.path().to_path_buf());
    state.plugin_host = Some(PluginHost::with_app_event_sender(
        app.clone(),
        state.app_event_tx.clone(),
    ));
    state.app = Some(app);
    (state, db_path, app_dir)
}

pub(crate) async fn invoke(
    state: &AppState,
    command: &str,
    payload: serde_json::Value,
) -> Result<serde_json::Value, (StatusCode, String)> {
    let request = AppInvokeRequest {
        command: command.to_string(),
        payload,
    };
    super::handle_command(state, &request).await
}

pub(crate) async fn invoke_ok(
    state: &AppState,
    command: &str,
    payload: serde_json::Value,
) -> serde_json::Value {
    invoke(state, command, payload)
        .await
        .unwrap_or_else(|err| panic!("{command} should succeed, got {err:?}"))
}
