use std::sync::{Mutex, Arc};
use tauri::State;
use serde::Serialize;
use crate::{db, github_client::GitHubClient};

#[derive(Debug, Clone, Serialize)]
pub struct FrontendReviewComment {
    pub id: i64,
    pub pr_number: i64,
    pub repo_owner: String,
    pub repo_name: String,
    pub path: String,
    pub line: Option<i32>,
    pub side: Option<String>,
    pub body: String,
    pub author: String,
    pub created_at: String,
    pub in_reply_to_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FrontendPrOverviewComment {
    pub id: i64,
    pub body: String,
    pub author: String,
    pub avatar_url: Option<String>,
    pub comment_type: String,
    pub file_path: Option<String>,
    pub line_number: Option<i32>,
    pub created_at: String,
}

#[tauri::command]
pub async fn get_github_username(
    db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
) -> Result<String, String> {
    let cached_username = {
        let db_lock = crate::db::acquire_db(&db);
        db_lock.get_config("github_username")
            .map_err(|e| format!("Failed to get config: {}", e))?
    };

    if let Some(username) = cached_username {
        return Ok(username);
    }

    let token = crate::secure_store::get_secret("github_token")
        .map_err(|e| format!("Failed to get config: {}", e))?
        .ok_or("github_token not configured".to_string())?;

    let username = github_client
        .get_authenticated_user(&token)
        .await
        .map_err(|e| format!("Failed to get authenticated user: {}", e))?;

    {
        let db_lock = crate::db::acquire_db(&db);
        db_lock.set_config("github_username", &username)
            .map_err(|e| format!("Failed to cache username: {}", e))?;
    }

    Ok(username)
}

#[tauri::command]
pub async fn fetch_review_prs(
    db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
) -> Result<Vec<db::ReviewPrRow>, String> {
    let cached_username = {
        let db_lock = crate::db::acquire_db(&db);
        db_lock.get_config("github_username")
            .map_err(|e| format!("Failed to get config: {}", e))?
    };

    let username = if let Some(u) = cached_username {
        u
    } else {
        let token_temp = crate::secure_store::get_secret("github_token")
            .map_err(|e| format!("Failed to get config: {}", e))?
            .ok_or("github_token not configured".to_string())?;
        let u = github_client
            .get_authenticated_user(&token_temp)
            .await
            .map_err(|e| format!("Failed to get authenticated user: {}", e))?;
        {
            let db_lock = crate::db::acquire_db(&db);
            db_lock.set_config("github_username", &u)
                .map_err(|e| format!("Failed to cache username: {}", e))?;
        }
        u
    };

    let token = crate::secure_store::get_secret("github_token")
        .map_err(|e| format!("Failed to get config: {}", e))?
        .ok_or("github_token not configured".to_string())?;

    let (prs, search_item_count) = github_client
        .search_review_requested_prs(&username, &token)
        .await
        .map_err(|e| format!("Failed to search review PRs: {}", e))?;

    let current_ids: Vec<i64> = prs.iter().map(|pr| pr.id).collect();

    {
        let db_lock = crate::db::acquire_db(&db);
        for pr in &prs {
            let created_at = chrono::DateTime::parse_from_rfc3339(&pr.created_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);
            let updated_at = chrono::DateTime::parse_from_rfc3339(&pr.updated_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);

            db_lock.upsert_review_pr(
                pr.id,
                pr.number,
                &pr.title,
                pr.body.as_deref(),
                &pr.state,
                pr.draft,
                &pr.html_url,
                &pr.user_login,
                pr.user_avatar_url.as_deref(),
                &pr.repo_owner,
                &pr.repo_name,
                &pr.head_ref,
                &pr.base_ref,
                &pr.head_sha,
                pr.additions,
                pr.deletions,
                pr.changed_files,
                created_at,
                updated_at,
            ).map_err(|e| format!("Failed to upsert review PR: {}", e))?;
        }

        // Only delete stale PRs when the fetch was complete (no partial failures)
        if prs.len() >= search_item_count {
            db_lock.delete_stale_review_prs(&current_ids)
                .map_err(|e| format!("Failed to delete stale review PRs: {}", e))?;
        }
    }

    let db_lock = crate::db::acquire_db(&db);
    db_lock.get_all_review_prs()
        .map_err(|e| format!("Failed to get review PRs: {}", e))
}

#[tauri::command]
pub async fn get_review_prs(
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<db::ReviewPrRow>, String> {
    let db_lock = crate::db::acquire_db(&db);
    db_lock.get_all_review_prs()
        .map_err(|e| format!("Failed to get review PRs: {}", e))
}

#[tauri::command]
pub async fn get_pr_file_diffs(
    _db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    pr_number: i64,
) -> Result<Vec<crate::github_client::PrFileDiff>, String> {
    let token = crate::secure_store::get_secret("github_token")
        .map_err(|e| format!("Failed to get config: {}", e))?
        .ok_or("github_token not configured".to_string())?;

    github_client
        .get_pr_files(&owner, &repo, pr_number, &token)
        .await
        .map_err(|e| format!("Failed to get PR files: {}", e))
}

#[tauri::command]
pub async fn get_file_content(
    _db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    sha: String,
) -> Result<String, String> {
    let token = crate::secure_store::get_secret("github_token")
        .map_err(|e| format!("Failed to get config: {}", e))?
        .ok_or("github_token not configured".to_string())?;

    github_client
        .get_blob_content(&owner, &repo, &sha, &token)
        .await
        .map_err(|e| format!("Failed to get blob content: {}", e))
}

#[tauri::command]
pub async fn get_file_at_ref(
    _db: State<'_, Arc<Mutex<db::Database>>>,
    _github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    path: String,
    ref_sha: String,
) -> Result<String, String> {
    let token = crate::secure_store::get_secret("github_token")
        .map_err(|e| format!("Failed to get config: {}", e))?
        .ok_or("github_token not configured".to_string())?;

    let url = format!(
        "https://api.github.com/repos/{}/{}/contents/{}?ref={}",
        owner, repo, path, ref_sha
    );

    let response = reqwest::Client::new()
        .get(&url)
        .header("Authorization", format!("token {}", token))
        .header("User-Agent", "openforge")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await
            .unwrap_or_else(|_| "Unable to read response body".to_string());
        return Err(format!("API error (status {}): {}", status, body));
    }

    let json: serde_json::Value = response.json().await
        .map_err(|e| format!("Parse error: {}", e))?;

    let content_b64 = json.get("content")
        .and_then(|c| c.as_str())
        .ok_or("No content field in response")?;

    let decoded = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        content_b64.replace('\n', "")
    ).map_err(|e| format!("Base64 decode error: {}", e))?;

    String::from_utf8(decoded)
        .map_err(|e| format!("UTF-8 decode error: {}", e))
}

#[tauri::command]
pub async fn get_review_comments(
    _db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    pr_number: i64,
) -> Result<Vec<FrontendReviewComment>, String> {
    let token = crate::secure_store::get_secret("github_token")
        .map_err(|e| format!("Failed to get config: {}", e))?
        .ok_or("github_token not configured".to_string())?;

    let comments = github_client
        .get_pr_review_comments(&owner, &repo, pr_number, &token)
        .await
        .map_err(|e| format!("Failed to get review comments: {}", e))?;

    let mapped: Vec<FrontendReviewComment> = comments
        .into_iter()
        .map(|c| {
            let line = c.line.or_else(|| {
                c.extra.get("original_line").and_then(|v| v.as_i64()).map(|v| v as i32)
            });
            FrontendReviewComment {
                id: c.id,
                pr_number,
                repo_owner: owner.clone(),
                repo_name: repo.clone(),
                path: c.path,
                line,
                side: c.side,
                body: c.body,
                author: c.user.login,
                created_at: c.created_at,
                in_reply_to_id: c.in_reply_to_id,
            }
        })
        .collect();

    Ok(mapped)
}

#[tauri::command]
pub async fn get_pr_overview_comments(
    _db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    pr_number: i64,
) -> Result<Vec<FrontendPrOverviewComment>, String> {
    let token = crate::secure_store::get_secret("github_token")
        .map_err(|e| format!("Failed to get config: {}", e))?
        .ok_or("github_token not configured".to_string())?;

    let comments = github_client
        .get_pr_comments(&owner, &repo, pr_number, &token, None)
        .await
        .map_err(|e| format!("Failed to get PR overview comments: {}", e))?;

    let mapped: Vec<FrontendPrOverviewComment> = comments
        .into_iter()
        .map(|c| FrontendPrOverviewComment {
            id: c.id,
            body: c.body,
            author: c.user.login,
            avatar_url: c.user.extra.get("avatar_url").and_then(|v| v.as_str()).map(String::from),
            comment_type: c.comment_type,
            file_path: c.path,
            line_number: c.line,
            created_at: c.created_at,
        })
        .collect();

    Ok(mapped)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn submit_pr_review(
    _db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    pr_number: i64,
    event: String,
    body: String,
    comments: Vec<crate::github_client::ReviewSubmitComment>,
    commit_id: String,
) -> Result<(), String> {
    let token = crate::secure_store::get_secret("github_token")
        .map_err(|e| format!("Failed to get config: {}", e))?
        .ok_or("github_token not configured".to_string())?;

    github_client
        .submit_review(&owner, &repo, pr_number, &event, &body, comments, &commit_id, &token)
        .await
        .map_err(|e| format!("Failed to submit review: {}", e))
}


#[tauri::command]
pub async fn mark_review_pr_viewed(
    db: State<'_, Arc<Mutex<db::Database>>>,
    pr_id: i64,
    head_sha: String,
) -> Result<(), String> {
    let db = crate::db::acquire_db(&db);
    db.mark_review_pr_viewed(pr_id, &head_sha)
        .map_err(|e| format!("Failed to mark review PR viewed: {}", e))
}