use std::sync::{Mutex, Arc};
use tauri::State;
use crate::{db, opencode_client::OpenCodeClient, server_manager::ServerManager, sse_bridge::SseBridgeManager, git_worktree, review_prompt};

#[tauri::command]
pub async fn start_agent_review(
    db: State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: State<'_, ServerManager>,
    sse_mgr: State<'_, SseBridgeManager>,
    app: tauri::AppHandle,
    repo_owner: String,
    repo_name: String,
    pr_number: i64,
    head_ref: String,
    base_ref: String,
    pr_title: String,
    pr_body: Option<String>,
    review_pr_id: i64,
) -> Result<serde_json::Value, String> {
    // Step 1: Find project
    let project = {
        let db = db.lock().unwrap();
        db.find_project_by_github_repo(&format!("{}/{}", repo_owner, repo_name))
            .map_err(|e| format!("Failed to find project: {}", e))?
    };

    let project = project.ok_or_else(|| {
        format!(
            "No project found for repository {}/{}. Configure github_default_repo in project settings.",
            repo_owner, repo_name
        )
    })?;

    // Step 2: Compute worktree path
    let worktree_path = git_worktree::review_worktree_path(
        std::path::Path::new(&project.path),
        pr_number,
    )
    .map_err(|e| e.to_string())?;

    // Step 3: Create/reuse worktree
    git_worktree::create_review_worktree(
        std::path::Path::new(&project.path),
        &worktree_path,
        &head_ref,
    )
    .await
    .map_err(|e| e.to_string())?;

    // Step 4: Synthetic key
    let synthetic_key = format!("pr-review-{}", review_pr_id);

    // Step 5: Start server
    let port = server_mgr
        .spawn_server(&synthetic_key, &worktree_path)
        .await
        .map_err(|e| e.to_string())?;

    // Step 6: Create OpenCode session
    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    let opencode_session_id = client
        .create_session(format!("PR Review #{}", pr_number))
        .await
        .map_err(|e| format!("Failed to create session: {}", e))?;

    // Step 7: Start SSE bridge
    sse_mgr
        .start_bridge(app.clone(), synthetic_key.clone(), Some(opencode_session_id.clone()), port)
        .await
        .map_err(|e| e.to_string())?;

    // Step 8: Build prompt
    let prompt = review_prompt::build_review_prompt(
        &base_ref,
        &head_ref,
        &pr_title,
        pr_body.as_deref(),
    );

    // Step 9: Send prompt
    client
        .prompt_async(&opencode_session_id, prompt, None)
        .await
        .map_err(|e| format!("Failed to send prompt: {}", e))?;

    // Step 10: Delete existing comments (for re-review)
    {
        let db = db.lock().unwrap();
        db.delete_agent_review_comments_for_pr(review_pr_id)
            .map_err(|e| format!("Failed to delete existing comments: {}", e))?;
    }

    // Step 11: Return
    Ok(serde_json::json!({
        "review_session_key": synthetic_key,
        "port": port
    }))
}

#[tauri::command]
pub async fn get_agent_review_comments(
    db: State<'_, Arc<Mutex<db::Database>>>,
    review_pr_id: i64,
) -> Result<Vec<db::AgentReviewCommentRow>, String> {
    let db = db.lock().unwrap();
    db.get_agent_review_comments_for_pr(review_pr_id)
        .map_err(|e| format!("Failed to get agent review comments: {}", e))
}

#[tauri::command]
pub async fn update_agent_review_comment_status(
    db: State<'_, Arc<Mutex<db::Database>>>,
    comment_id: i64,
    status: String,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.update_agent_review_comment_status(comment_id, &status)
        .map_err(|e| format!("Failed to update comment status: {}", e))
}

#[tauri::command]
pub async fn dismiss_all_agent_review_comments(
    db: State<'_, Arc<Mutex<db::Database>>>,
    review_pr_id: i64,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.delete_agent_review_comments_for_pr(review_pr_id)
        .map_err(|e| format!("Failed to dismiss all comments: {}", e))
}

#[tauri::command]
pub async fn abort_agent_review(
    server_mgr: State<'_, ServerManager>,
    sse_mgr: State<'_, SseBridgeManager>,
    review_session_key: String,
) -> Result<(), String> {
    sse_mgr.stop_bridge(&review_session_key).await;
    server_mgr
        .stop_server(&review_session_key)
        .await
        .map_err(|e| e.to_string())
}
