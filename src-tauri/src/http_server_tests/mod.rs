use super::*;
use crate::whisper_manager::WhisperModelSize;
use axum::body::{to_bytes, Body};
use axum::http::Request;
use std::sync::{Arc, Mutex};
use tower::util::ServiceExt;

async fn response_body_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("read response body");
    serde_json::from_slice(&bytes).expect("parse response JSON")
}

fn test_state(name: &str) -> (AppState, std::path::PathBuf) {
    let (db, path) = crate::db::test_helpers::make_test_db(name);
    let (app_event_tx, _) = tokio::sync::broadcast::channel(16);
    (
        AppState {
            app: None,
            db: Arc::new(Mutex::new(db)),
            backend_token: Some("test-token".to_string()),
            pty_manager: Some(PtyManager::new()),
            github_client: GitHubClient::new(),
            plugin_host: Some(PluginHost::new(crate::backend_runtime::AppHandle::new())),
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

mod handlers;
mod hook_lifecycle;
mod models;
mod project_resolution;
mod shutdown;
mod transport;
