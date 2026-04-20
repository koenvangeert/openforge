use crate::github_client::GitHubClient;
use crate::{db, github_poller};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

#[tauri::command]
pub async fn force_github_sync(
    app: tauri::AppHandle,
    github_client: State<'_, GitHubClient>,
) -> Result<github_poller::PollResult, String> {
    let result = github_poller::poll_github_once(&app, github_client.inner()).await;
    Ok(result)
}

fn validate_url_scheme(url: &str) -> Result<(), String> {
    let lower = url.to_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        let rest = if lower.starts_with("https://") {
            &url[8..]
        } else {
            &url[7..]
        };
        if rest.is_empty() {
            return Err("Invalid URL format".to_string());
        }
        Ok(())
    } else if url.contains("://") || lower.starts_with("javascript:") || lower.starts_with("data:")
    {
        Err("Invalid URL: only http and https URLs are allowed".to_string())
    } else {
        Err("Invalid URL format".to_string())
    }
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    validate_url_scheme(&url)?;

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
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<db::PrRow>, String> {
    let db_lock = crate::db::acquire_db(&db);
    db_lock
        .get_all_pull_requests()
        .map_err(|e| format!("Failed to get pull requests: {}", e))
}

#[tauri::command]
pub async fn get_pr_comments(
    db: State<'_, Arc<Mutex<db::Database>>>,
    pr_id: i64,
) -> Result<Vec<db::PrCommentRow>, String> {
    let db_lock = crate::db::acquire_db(&db);
    db_lock
        .get_comments_for_pr(pr_id)
        .map_err(|e| format!("Failed to get PR comments: {}", e))
}

/// Mark a PR comment as addressed
#[tauri::command]
pub async fn mark_comment_addressed(
    app: tauri::AppHandle,
    db: State<'_, Arc<Mutex<db::Database>>>,

    comment_id: i64,
) -> Result<(), String> {
    let db_lock = crate::db::acquire_db(&db);
    db_lock
        .mark_comment_addressed(comment_id)
        .map_err(|e| format!("Failed to mark comment addressed: {}", e))?;
    let _ = app.emit("comment-addressed", ());
    Ok(())
}

#[tauri::command]
pub async fn merge_pull_request(
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    pr_number: i64,
) -> Result<(), String> {
    let token = crate::secure_store::get_secret("github_token")
        .map_err(|e| format!("Failed to get config: {}", e))?
        .ok_or("github_token not configured".to_string())?;

    let response = github_client
        .merge_pr(&owner, &repo, pr_number, &token)
        .await
        .map_err(|e| format!("Failed to merge pull request: {}", e))?;

    if !response.merged {
        return Err(format!(
            "Failed to merge pull request: {}",
            response.message
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::Manager;

    #[test]
    fn test_valid_http_url() {
        assert!(validate_url_scheme("http://example.com").is_ok());
    }

    #[test]
    fn test_valid_https_url() {
        assert!(validate_url_scheme("https://github.com/owner/repo").is_ok());
    }

    #[test]
    fn test_valid_https_with_path_and_query() {
        assert!(validate_url_scheme("https://example.com/path?q=1#anchor").is_ok());
    }

    #[test]
    fn test_invalid_file_scheme() {
        let err = validate_url_scheme("file:///etc/passwd").unwrap_err();
        assert_eq!(err, "Invalid URL: only http and https URLs are allowed");
    }

    #[test]
    fn test_invalid_javascript_scheme() {
        let err = validate_url_scheme("javascript:alert(1)").unwrap_err();
        assert_eq!(err, "Invalid URL: only http and https URLs are allowed");
    }

    #[test]
    fn test_invalid_data_scheme() {
        let err = validate_url_scheme("data:text/html,<script>alert(1)</script>").unwrap_err();
        assert_eq!(err, "Invalid URL: only http and https URLs are allowed");
    }

    #[test]
    fn test_invalid_ftp_scheme() {
        let err = validate_url_scheme("ftp://example.com/file").unwrap_err();
        assert_eq!(err, "Invalid URL: only http and https URLs are allowed");
    }

    #[test]
    fn test_invalid_no_scheme() {
        let err = validate_url_scheme("example.com").unwrap_err();
        assert_eq!(err, "Invalid URL format");
    }

    #[test]
    fn test_invalid_empty_string() {
        let err = validate_url_scheme("").unwrap_err();
        assert_eq!(err, "Invalid URL format");
    }

    #[test]
    fn test_invalid_empty_http_host() {
        let err = validate_url_scheme("http://").unwrap_err();
        assert_eq!(err, "Invalid URL format");
    }

    #[test]
    fn test_case_insensitive_scheme() {
        assert!(validate_url_scheme("HTTP://example.com").is_ok());
        assert!(validate_url_scheme("HTTPS://example.com").is_ok());
    }

    #[test]
    fn test_force_sync_uses_managed_github_client() {
        let managed_client = GitHubClient::new();
        let app = mock_builder()
            .manage(managed_client.clone())
            .build(mock_context(noop_assets()))
            .expect("mock app should build");

        let state_client = app.state::<GitHubClient>();
        let state_instance = state_client.inner();

        assert!(state_instance.shares_cache_with(&managed_client));
    }
}
