use std::sync::Mutex;
use tauri::{Emitter, State};
use crate::{db, github_poller};

#[tauri::command]
pub async fn force_github_sync(
    app: tauri::AppHandle,
) -> Result<github_poller::PollResult, String> {
    let github_client = crate::github_client::GitHubClient::new();
    let result = github_poller::poll_github_once(&app, &github_client).await;
    Ok(result)
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "linux")]
    let cmd = "xdg-open";
    #[cfg(target_os = "windows")]
    let cmd = "start";

    std::process::Command::new(cmd)
        .arg(&url)
        .spawn()
        .map_err(|e| format!("Failed to open URL: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_pull_requests(
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<db::PrRow>, String> {
    let db_lock = db.lock().unwrap();
    db_lock
        .get_all_pull_requests()
        .map_err(|e| format!("Failed to get pull requests: {}", e))
}

#[tauri::command]
pub async fn get_pr_comments(
    db: State<'_, Mutex<db::Database>>,
    pr_id: i64,
) -> Result<Vec<db::PrCommentRow>, String> {
    let db_lock = db.lock().unwrap();
    db_lock
        .get_comments_for_pr(pr_id)
        .map_err(|e| format!("Failed to get PR comments: {}", e))
}

/// Mark a PR comment as addressed
#[tauri::command]
pub async fn mark_comment_addressed(
    app: tauri::AppHandle,
    db: State<'_, Mutex<db::Database>>,
    comment_id: i64,
) -> Result<(), String> {
    let db_lock = db.lock().unwrap();
    db_lock
        .mark_comment_addressed(comment_id)
        .map_err(|e| format!("Failed to mark comment addressed: {}", e))?;
    let _ = app.emit("comment-addressed", ());
    Ok(())
}
