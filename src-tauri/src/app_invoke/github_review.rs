use super::{json_value, payload_field, payload_i64, payload_string, AppResult};
use crate::{app_events::publish_app_event, http_server::AppInvokeRequest, http_server::AppState};
use axum::http::StatusCode;
use serde::Serialize;
use tauri::Emitter;

fn runtime_error(error: String) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error)
}

fn publish_comment_addressed(state: &AppState) {
    let payload = serde_json::Value::Null;
    if let Some(app) = &state.app {
        let _ = app.emit("comment-addressed", payload.clone());
    }
    publish_app_event(&state.app_event_tx, "comment-addressed", &payload);
}

fn to_app_value<T: Serialize>(value: T) -> AppResult<serde_json::Value> {
    json_value(value)
}

pub(super) async fn handle_app_github_review_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    let value = match request.command.as_str() {
        "get_pull_requests" => to_app_value(
            crate::github_runtime::get_pull_requests(&state.db).map_err(runtime_error)?,
        )?,
        "get_pr_comments" => {
            let pr_id = payload_i64(&request.payload, "prId")?;
            to_app_value(
                crate::github_runtime::get_pr_comments(&state.db, pr_id).map_err(runtime_error)?,
            )?
        }
        "mark_comment_addressed" => {
            let comment_id = payload_i64(&request.payload, "commentId")?;
            crate::github_runtime::mark_comment_addressed(&state.db, comment_id)
                .map_err(runtime_error)?;
            publish_comment_addressed(state);
            return Ok(Some(serde_json::Value::Null));
        }
        "get_review_prs" => {
            to_app_value(crate::github_runtime::get_review_prs(&state.db).map_err(runtime_error)?)?
        }
        "mark_review_pr_viewed" => {
            let pr_id = payload_i64(&request.payload, "prId")?;
            let head_sha = payload_string(&request.payload, "headSha")?;
            crate::github_runtime::mark_review_pr_viewed(&state.db, pr_id, &head_sha)
                .map_err(runtime_error)?;
            serde_json::Value::Null
        }
        "get_authored_prs" => to_app_value(
            crate::github_runtime::get_authored_prs(&state.db).map_err(runtime_error)?,
        )?,
        "force_github_sync" => to_app_value(
            crate::github_poller::poll_github_once_for_sidecar(
                state.db.clone(),
                &state.github_client,
                state.app_event_tx.clone(),
            )
            .await,
        )?,
        "merge_pull_request" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let pr_number = payload_i64(&request.payload, "prNumber")?;
            crate::github_runtime::merge_pull_request(
                &state.github_client,
                &owner,
                &repo,
                pr_number,
            )
            .await
            .map_err(runtime_error)?;
            serde_json::Value::Null
        }
        "get_github_username" => to_app_value(
            crate::github_runtime::github_username(&state.db, &state.github_client)
                .await
                .map_err(runtime_error)?,
        )?,
        "fetch_review_prs" => to_app_value(
            crate::github_runtime::fetch_review_prs(&state.db, &state.github_client)
                .await
                .map_err(runtime_error)?,
        )?,
        "get_pr_file_diffs" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let pr_number = payload_i64(&request.payload, "prNumber")?;
            to_app_value(
                crate::github_runtime::get_pr_file_diffs(
                    &state.github_client,
                    &owner,
                    &repo,
                    pr_number,
                )
                .await
                .map_err(runtime_error)?,
            )?
        }
        "get_file_content" | "get_file_content_base64" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let sha = payload_string(&request.payload, "sha")?;
            if request.command == "get_file_content" {
                to_app_value(
                    crate::github_runtime::get_file_content(
                        &state.github_client,
                        &owner,
                        &repo,
                        &sha,
                    )
                    .await
                    .map_err(runtime_error)?,
                )?
            } else {
                to_app_value(
                    crate::github_runtime::get_file_content_base64(
                        &state.github_client,
                        &owner,
                        &repo,
                        &sha,
                    )
                    .await
                    .map_err(runtime_error)?,
                )?
            }
        }
        "get_file_at_ref" | "get_file_at_ref_base64" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let path = payload_string(&request.payload, "path")?;
            let ref_sha = payload_string(&request.payload, "refSha")?;
            if request.command == "get_file_at_ref" {
                to_app_value(
                    crate::github_runtime::get_file_at_ref(
                        &state.github_client,
                        &owner,
                        &repo,
                        &path,
                        &ref_sha,
                    )
                    .await
                    .map_err(runtime_error)?,
                )?
            } else {
                to_app_value(
                    crate::github_runtime::get_file_at_ref_base64(
                        &state.github_client,
                        &owner,
                        &repo,
                        &path,
                        &ref_sha,
                    )
                    .await
                    .map_err(runtime_error)?,
                )?
            }
        }
        "get_review_comments" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let pr_number = payload_i64(&request.payload, "prNumber")?;
            to_app_value(
                crate::github_runtime::get_review_comments(
                    &state.github_client,
                    &owner,
                    &repo,
                    pr_number,
                )
                .await
                .map_err(runtime_error)?,
            )?
        }
        "get_pr_overview_comments" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let pr_number = payload_i64(&request.payload, "prNumber")?;
            to_app_value(
                crate::github_runtime::get_pr_overview_comments(
                    &state.github_client,
                    &owner,
                    &repo,
                    pr_number,
                )
                .await
                .map_err(runtime_error)?,
            )?
        }
        "submit_pr_review" => {
            let owner = payload_string(&request.payload, "owner")?;
            let repo = payload_string(&request.payload, "repo")?;
            let pr_number = payload_i64(&request.payload, "prNumber")?;
            let event = payload_string(&request.payload, "event")?;
            let body = payload_string(&request.payload, "body")?;
            let commit_id = payload_string(&request.payload, "commitId")?;
            let comments = if request.payload.get("comments").is_some() {
                payload_field::<Vec<crate::github_client::ReviewSubmitComment>>(
                    &request.payload,
                    "comments",
                )?
            } else {
                Vec::new()
            };
            crate::github_runtime::submit_pr_review(
                &state.github_client,
                &owner,
                &repo,
                pr_number,
                &event,
                &body,
                comments,
                &commit_id,
            )
            .await
            .map_err(runtime_error)?;
            serde_json::Value::Null
        }
        "fetch_authored_prs" => to_app_value(
            crate::github_runtime::fetch_authored_prs(&state.db, &state.github_client)
                .await
                .map_err(runtime_error)?,
        )?,
        _ => return Ok(None),
    };

    Ok(Some(value))
}
