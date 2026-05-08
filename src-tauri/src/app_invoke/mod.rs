pub(crate) mod payload;

mod core;
mod files_review;
mod github_review;
mod lifecycle;
mod plugins;
mod pty;
mod pty_payload;
mod runtime;
mod whisper;

#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod tests;

use crate::{
    app_events::publish_app_event_to_runtime,
    db,
    http_server::{AppInvokeRequest, AppState},
    whisper_manager::WhisperModelSize,
};
use axum::http::StatusCode;
use lifecycle::cleanup_task_runtime_for_app;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::str::FromStr;

type AppResult<T> = Result<T, (StatusCode, String)>;

fn payload_string(payload: &serde_json::Value, key: &str) -> AppResult<String> {
    payload::string(payload, key).map_err(Into::into)
}

fn payload_optional_string(payload: &serde_json::Value, key: &str) -> AppResult<Option<String>> {
    payload::optional_string(payload, key).map_err(Into::into)
}

fn payload_bool(payload: &serde_json::Value, key: &str) -> AppResult<bool> {
    payload::bool(payload, key).map_err(Into::into)
}

fn payload_field<T: serde::de::DeserializeOwned>(
    payload: &serde_json::Value,
    key: &str,
) -> AppResult<T> {
    payload::field(payload, key).map_err(Into::into)
}

fn payload_i64(payload: &serde_json::Value, key: &str) -> AppResult<i64> {
    payload::i64(payload, key).map_err(Into::into)
}

fn payload_string_vec(payload: &serde_json::Value, key: &str) -> AppResult<Vec<String>> {
    payload::string_vec(payload, key).map_err(Into::into)
}

fn payload_optional_i32(payload: &serde_json::Value, key: &str) -> AppResult<Option<i32>> {
    payload::optional_i32(payload, key).map_err(Into::into)
}

fn payload_optional_usize(payload: &serde_json::Value, key: &str) -> AppResult<Option<usize>> {
    payload::optional_usize(payload, key).map_err(Into::into)
}

fn json_value<T: Serialize>(value: T) -> AppResult<serde_json::Value> {
    serde_json::to_value(value).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to serialize app IPC response: {e}"),
        )
    })
}

fn publish_task_changed(state: &AppState, task_id: &str) {
    publish_task_changed_payload(
        state,
        serde_json::json!({ "action": "updated", "task_id": task_id }),
    );
}

fn publish_task_changed_payload(state: &AppState, payload: serde_json::Value) {
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "task-changed",
        &payload,
    );
}

fn publish_session_resumed(state: &AppState, task_id: &str, workspace_path: &str) {
    let payload = serde_json::json!({
        "task_id": task_id,
        "workspace_path": workspace_path,
    });
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "session-resumed",
        &payload,
    );
}

fn publish_startup_resume_complete(state: &AppState) {
    let payload = serde_json::Value::Null;
    publish_app_event_to_runtime(
        state.app.as_ref(),
        &state.app_event_tx,
        "startup-resume-complete",
        &payload,
    );
}

pub(crate) async fn handle_core_task_project_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    core::handle_app_core_task_project_command(state, request).await
}

pub(crate) async fn handle_resume_startup_sessions_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    lifecycle::handle_app_resume_startup_sessions_command(state, request).await
}

pub(crate) async fn handle_start_implementation_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    lifecycle::handle_app_start_implementation_command(state, request).await
}

pub(crate) async fn handle_abort_implementation_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    lifecycle::handle_app_abort_implementation_command(state, request).await
}

pub(crate) async fn handle_pty_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    pty::handle_app_pty_command(state, request).await
}

pub(crate) async fn handle_plugin_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    plugins::handle_app_plugin_command(state, request).await
}

pub(crate) async fn handle_github_review_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    github_review::handle_app_github_review_command(state, request).await
}

pub(crate) async fn handle_files_review_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    files_review::handle_app_files_review_command(state, request).await
}

pub(crate) async fn handle_runtime_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    runtime::handle_app_runtime_command(state, request).await
}

pub(crate) async fn handle_unmatched_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<serde_json::Value> {
    core::handle_app_unmatched_command(state, request).await
}

pub(crate) async fn handle_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<serde_json::Value> {
    if let Some(value) = handle_whisper_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_core_task_project_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_resume_startup_sessions_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_start_implementation_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_abort_implementation_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_pty_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_github_review_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_plugin_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_files_review_command(state, request).await? {
        return Ok(value);
    }
    if let Some(value) = handle_runtime_command(state, request).await? {
        return Ok(value);
    }

    handle_unmatched_command(state, request).await
}

pub(crate) async fn handle_whisper_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    whisper::handle_app_whisper_command(state, request).await
}
