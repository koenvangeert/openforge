use crate::github_client::GitHubClient;
use crate::{db, github_poller, github_runtime};
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
    github_runtime::get_pull_requests(&db)
}

#[tauri::command]
pub async fn get_pr_comments(
    db: State<'_, Arc<Mutex<db::Database>>>,
    pr_id: i64,
) -> Result<Vec<db::PrCommentRow>, String> {
    github_runtime::get_pr_comments(&db, pr_id)
}

/// Mark a PR comment as addressed
#[tauri::command]
pub async fn mark_comment_addressed(
    app: tauri::AppHandle,
    db: State<'_, Arc<Mutex<db::Database>>>,

    comment_id: i64,
) -> Result<(), String> {
    github_runtime::mark_comment_addressed(&db, comment_id)?;
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
    github_runtime::merge_pull_request(github_client.inner(), &owner, &repo, pr_number).await
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
