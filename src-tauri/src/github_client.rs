//! GitHub REST API Client
//!
//! Type-safe Rust client for interacting with GitHub REST API v3.
//! Provides functions for fetching PR details, fetching PR comments (both review
//! and general comments), posting comments, and checking PR status.
//!
//! ## API Endpoints
//! - GET /repos/{owner}/{repo}/pulls/{number} — Get PR details
//! - GET /repos/{owner}/{repo}/pulls/{number}/comments — Get review (inline) comments
//! - GET /repos/{owner}/{repo}/issues/{number}/comments — Get general comments
//! - POST /repos/{owner}/{repo}/issues/{number}/comments — Post a comment
//!
//! ## Authentication
//! Uses Personal Access Token (PAT) in Authorization header
//! Authorization header format: `token {personal_access_token}`
//!
//! ## User-Agent Requirement
//! GitHub API requires a User-Agent header. This client uses: `ai-command-center`

use futures::future::join_all;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::error::Error as StdError;
use std::fmt;
use std::sync::{Arc, Mutex};
use base64::{Engine as _, engine::general_purpose};

/// Cached HTTP response with ETag for conditional requests
struct CachedResponse {
    etag: String,
    body: String,
}

/// GitHub API client
#[derive(Clone)]
pub struct GitHubClient {
    client: Client,
    etag_cache: Arc<Mutex<HashMap<String, CachedResponse>>>,
}

impl GitHubClient {
    /// Create a new GitHub client
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            etag_cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Make a GET request with ETag conditional request support.
    ///
    /// Sends `If-None-Match` header when a cached ETag exists for the URL.
    /// On 304 Not Modified, returns the cached deserialized response.
    /// On 200, caches the response body + ETag and returns the parsed result.
    async fn get_with_etag<T: DeserializeOwned>(
        &self,
        url: &str,
        token: &str,
    ) -> Result<T, GitHubError> {
        let cached_etag = {
            self.etag_cache
                .lock()
                .unwrap()
                .get(url)
                .map(|c| c.etag.clone())
        };

        let mut req = self
            .client
            .get(url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center");

        if let Some(ref etag) = cached_etag {
            req = req.header("If-None-Match", etag);
        }

        let response = req
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            if let Some(cached) = self.etag_cache.lock().unwrap().get(url) {
                let result: T = serde_json::from_str(&cached.body)
                    .map_err(|e| GitHubError::ParseError(e.to_string()))?;
                return Ok(result);
            }
            // Cache miss despite 304 — fall through to error
            return Err(GitHubError::ParseError(
                "Received 304 but no cached response found".to_string(),
            ));
        }

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(GitHubError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        let etag = response
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .map(String::from);

        let body = response
            .text()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if let Some(etag_value) = etag {
            self.etag_cache.lock().unwrap().insert(
                url.to_string(),
                CachedResponse {
                    etag: etag_value,
                    body: body.clone(),
                },
            );
        }

        let result: T =
            serde_json::from_str(&body).map_err(|e| GitHubError::ParseError(e.to_string()))?;

        Ok(result)
    }

    /// Get pull request details
    ///
    /// # Arguments
    /// * `owner` - Repository owner (e.g., "facebook")
    /// * `repo` - Repository name (e.g., "react")
    /// * `pr_number` - Pull request number
    /// * `token` - GitHub Personal Access Token
    ///
    /// # Returns
    /// PullRequest with full details on success
    ///
    /// # Example
    /// ```no_run
    /// # use github_client::GitHubClient;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let client = GitHubClient::new();
    /// let pr = client.get_pr_details(
    ///     "facebook",
    ///     "react",
    ///     12345,
    ///     "ghp_token_here"
    /// ).await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_pr_details(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
    ) -> Result<PullRequest, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}",
            owner, repo, pr_number
        );

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center")
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(GitHubError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        let pr: PullRequest = response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;

        Ok(pr)
    }

    /// Get all PR comments (both review comments and general comments)
    ///
    /// Fetches both inline review comments (from /pulls/{number}/comments)
    /// and general issue comments (from /issues/{number}/comments), merging
    /// them into a single vector with a `comment_type` field to distinguish.
    ///
    /// # Arguments
    /// * `owner` - Repository owner
    /// * `repo` - Repository name
    /// * `pr_number` - Pull request number
    /// * `token` - GitHub Personal Access Token
    /// * `since` - Optional timestamp to filter comments (ISO 8601 format)
    ///
    /// # Returns
    /// Vector of PrComment with both review and general comments
    ///
    /// # Example
    /// ```no_run
    /// # use github_client::GitHubClient;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let client = GitHubClient::new();
    /// let comments = client.get_pr_comments(
    ///     "facebook",
    ///     "react",
    ///     12345,
    ///     "ghp_token_here",
    ///     None
    /// ).await?;
    /// for comment in comments {
    ///     println!("{}: {}", comment.comment_type, comment.body);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_pr_comments(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
        since: Option<&str>,
    ) -> Result<Vec<PrComment>, GitHubError> {
        let mut review_comments_url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/comments",
            owner, repo, pr_number
        );
        if let Some(ts) = since {
            review_comments_url.push_str(&format!("?since={}", ts));
        }

        let review_cached_etag = {
            self.etag_cache
                .lock()
                .unwrap()
                .get(&review_comments_url)
                .map(|c| c.etag.clone())
        };

        let mut review_req = self
            .client
            .get(&review_comments_url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center");
        if let Some(ref etag) = review_cached_etag {
            review_req = review_req.header("If-None-Match", etag);
        }

        let review_response = review_req
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        let mut review_comments: Vec<ReviewComment> =
            if review_response.status() == reqwest::StatusCode::NOT_MODIFIED {
                if let Some(cached) = self
                    .etag_cache
                    .lock()
                    .unwrap()
                    .get(&review_comments_url)
                {
                    serde_json::from_str(&cached.body)
                        .map_err(|e| GitHubError::ParseError(e.to_string()))?
                } else {
                    vec![]
                }
            } else {
                if !review_response.status().is_success() {
                    let status = review_response.status();
                    let body = review_response
                        .text()
                        .await
                        .unwrap_or_else(|_| "Unable to read response body".to_string());
                    return Err(GitHubError::ApiError {
                        status: status.as_u16(),
                        message: body,
                    });
                }
                let review_etag = review_response
                    .headers()
                    .get("etag")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);
                let body = review_response
                    .text()
                    .await
                    .map_err(|e| GitHubError::NetworkError(e.to_string()))?;
                if let Some(etag_value) = review_etag {
                    self.etag_cache.lock().unwrap().insert(
                        review_comments_url.clone(),
                        CachedResponse {
                            etag: etag_value,
                            body: body.clone(),
                        },
                    );
                }
                serde_json::from_str(&body)
                    .map_err(|e| GitHubError::ParseError(e.to_string()))?
            };

        let mut issue_comments_url = format!(
            "https://api.github.com/repos/{}/{}/issues/{}/comments",
            owner, repo, pr_number
        );
        if let Some(ts) = since {
            issue_comments_url.push_str(&format!("?since={}", ts));
        }

        let issue_cached_etag = {
            self.etag_cache
                .lock()
                .unwrap()
                .get(&issue_comments_url)
                .map(|c| c.etag.clone())
        };

        let mut issue_req = self
            .client
            .get(&issue_comments_url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center");
        if let Some(ref etag) = issue_cached_etag {
            issue_req = issue_req.header("If-None-Match", etag);
        }

        let issue_response = issue_req
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        let mut issue_comments: Vec<IssueComment> =
            if issue_response.status() == reqwest::StatusCode::NOT_MODIFIED {
                if let Some(cached) = self
                    .etag_cache
                    .lock()
                    .unwrap()
                    .get(&issue_comments_url)
                {
                    serde_json::from_str(&cached.body)
                        .map_err(|e| GitHubError::ParseError(e.to_string()))?
                } else {
                    vec![]
                }
            } else {
                if !issue_response.status().is_success() {
                    let status = issue_response.status();
                    let body = issue_response
                        .text()
                        .await
                        .unwrap_or_else(|_| "Unable to read response body".to_string());
                    return Err(GitHubError::ApiError {
                        status: status.as_u16(),
                        message: body,
                    });
                }
                let issue_etag = issue_response
                    .headers()
                    .get("etag")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);
                let body = issue_response
                    .text()
                    .await
                    .map_err(|e| GitHubError::NetworkError(e.to_string()))?;
                if let Some(etag_value) = issue_etag {
                    self.etag_cache.lock().unwrap().insert(
                        issue_comments_url.clone(),
                        CachedResponse {
                            etag: etag_value,
                            body: body.clone(),
                        },
                    );
                }
                serde_json::from_str(&body)
                    .map_err(|e| GitHubError::ParseError(e.to_string()))?
            };

        let mut all_comments = Vec::new();

        for comment in review_comments.drain(..) {
            all_comments.push(PrComment {
                id: comment.id,
                body: comment.body,
                user: comment.user,
                path: Some(comment.path),
                line: comment.line,
                comment_type: "review_comment".to_string(),
                created_at: comment.created_at,
            });
        }

        for comment in issue_comments.drain(..) {
            all_comments.push(PrComment {
                id: comment.id,
                body: comment.body,
                user: comment.user,
                path: None,
                line: None,
                comment_type: "issue_comment".to_string(),
                created_at: comment.created_at,
            });
        }

        Ok(all_comments)
    }

    /// Post a comment on a pull request
    ///
    /// Posts a general comment (not an inline review comment) to the PR.
    ///
    /// # Arguments
    /// * `owner` - Repository owner
    /// * `repo` - Repository name
    /// * `pr_number` - Pull request number
    /// * `body` - Comment body (Markdown supported)
    /// * `token` - GitHub Personal Access Token
    ///
    /// # Returns
    /// Ok(()) on success
    ///
    /// # Example
    /// ```no_run
    /// # use github_client::GitHubClient;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let client = GitHubClient::new();
    /// client.post_pr_comment(
    ///     "facebook",
    ///     "react",
    ///     12345,
    ///     "LGTM! :+1:",
    ///     "ghp_token_here"
    /// ).await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn post_pr_comment(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        body: &str,
        token: &str,
    ) -> Result<(), GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/issues/{}/comments",
            owner, repo, pr_number
        );

        let request_body = CommentRequest {
            body: body.to_string(),
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(GitHubError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        Ok(())
    }

    /// Get pull request status
    ///
    /// Returns the current state of the PR (e.g., "open", "closed", "merged").
    ///
    /// # Arguments
    /// * `owner` - Repository owner
    /// * `repo` - Repository name
    /// * `pr_number` - Pull request number
    /// * `token` - GitHub Personal Access Token
    ///
    /// # Returns
    /// PR state string on success
    ///
    /// # Example
    /// ```no_run
    /// # use github_client::GitHubClient;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let client = GitHubClient::new();
    /// let status = client.get_pr_status(
    ///     "facebook",
    ///     "react",
    ///     12345,
    ///     "ghp_token_here"
    /// ).await?;
    /// println!("PR status: {}", status);
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_pr_status(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
    ) -> Result<String, GitHubError> {
        let pr = self.get_pr_details(owner, repo, pr_number, token).await?;
        Ok(pr.state)
    }

    /// List all open pull requests for a repository
    pub async fn list_open_prs(
        &self,
        owner: &str,
        repo: &str,
        token: &str,
    ) -> Result<Vec<PullRequest>, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls?state=open&per_page=100",
            owner, repo
        );
        self.get_with_etag::<Vec<PullRequest>>(&url, token).await
    }

    /// Get all check runs for a commit (paginated)
    ///
    /// Fetches all pages of check runs to ensure none are missed.
    ///
    /// # Arguments
    /// * `owner` - Repository owner
    /// * `repo` - Repository name
    /// * `sha` - Commit SHA
    /// * `token` - GitHub Personal Access Token
    ///
    /// # Returns
    /// CheckRunsResponse with complete list of check runs
    pub async fn get_check_runs(
        &self,
        owner: &str,
        repo: &str,
        sha: &str,
        token: &str,
    ) -> Result<CheckRunsResponse, GitHubError> {
        let per_page = 100;
        let first_page_url = format!(
            "https://api.github.com/repos/{}/{}/commits/{}/check-runs?per_page={}&page=1",
            owner, repo, sha, per_page
        );

        let cached_etag = {
            self.etag_cache
                .lock()
                .unwrap()
                .get(&first_page_url)
                .map(|c| c.etag.clone())
        };

        let mut req = self
            .client
            .get(&first_page_url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center");

        if let Some(ref etag) = cached_etag {
            req = req.header("If-None-Match", etag);
        }

        let response = req
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            if let Some(cached) = self.etag_cache.lock().unwrap().get(&first_page_url) {
                let result: CheckRunsResponse = serde_json::from_str(&cached.body)
                    .map_err(|e| GitHubError::ParseError(e.to_string()))?;
                return Ok(result);
            }
        }

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(GitHubError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        let first_etag = response
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .map(String::from);

        let first_page_response: CheckRunsResponse = response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;

        let total_count = first_page_response.total_count;
        let mut all_check_runs: Vec<CheckRun> = first_page_response.check_runs;
        let mut page = 2u32;

        while all_check_runs.len() < total_count && page <= 10 {
            let url = format!(
                "https://api.github.com/repos/{}/{}/commits/{}/check-runs?per_page={}&page={}",
                owner, repo, sha, per_page, page
            );

            let response = self
                .client
                .get(&url)
                .header("Authorization", format!("token {}", token))
                .header("User-Agent", "ai-command-center")
                .send()
                .await
                .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unable to read response body".to_string());
                return Err(GitHubError::ApiError {
                    status: status.as_u16(),
                    message: body,
                });
            }

            let page_response: CheckRunsResponse = response
                .json()
                .await
                .map_err(|e| GitHubError::ParseError(e.to_string()))?;

            all_check_runs.extend(page_response.check_runs);

            if page == 10 && all_check_runs.len() < total_count {
                eprintln!(
                    "[GitHub] Capped check runs pagination at 10 pages ({} of {} fetched)",
                    all_check_runs.len(),
                    total_count
                );
            }

            page += 1;
        }

        let result = CheckRunsResponse {
            total_count: all_check_runs.len(),
            check_runs: all_check_runs,
        };

        if let Some(etag_value) = first_etag {
            let body = serde_json::to_string(&result)
                .map_err(|e| GitHubError::ParseError(e.to_string()))?;
            self.etag_cache.lock().unwrap().insert(
                first_page_url,
                CachedResponse {
                    etag: etag_value,
                    body,
                },
            );
        }

        Ok(result)
    }

    /// Get combined status for a commit (paginated)
    ///
    /// Fetches all pages of commit statuses to ensure none are missed.
    ///
    /// # Arguments
    /// * `owner` - Repository owner
    /// * `repo` - Repository name
    /// * `sha` - Commit SHA
    /// * `token` - GitHub Personal Access Token
    ///
    /// # Returns
    /// CombinedStatusResponse with complete commit status information
    pub async fn get_combined_status(
        &self,
        owner: &str,
        repo: &str,
        sha: &str,
        token: &str,
    ) -> Result<CombinedStatusResponse, GitHubError> {
        let per_page = 100;
        let first_page_url = format!(
            "https://api.github.com/repos/{}/{}/commits/{}/status?per_page={}&page=1",
            owner, repo, sha, per_page
        );

        let cached_etag = {
            self.etag_cache
                .lock()
                .unwrap()
                .get(&first_page_url)
                .map(|c| c.etag.clone())
        };

        let mut req = self
            .client
            .get(&first_page_url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center");

        if let Some(ref etag) = cached_etag {
            req = req.header("If-None-Match", etag);
        }

        let response = req
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            if let Some(cached) = self.etag_cache.lock().unwrap().get(&first_page_url) {
                let result: CombinedStatusResponse = serde_json::from_str(&cached.body)
                    .map_err(|e| GitHubError::ParseError(e.to_string()))?;
                return Ok(result);
            }
        }

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(GitHubError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        let first_etag = response
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .map(String::from);

        let first_page_response: CombinedStatusResponse = response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;

        let result_state = first_page_response.state;
        let result_sha = first_page_response.sha;
        let result_extra = first_page_response.extra;
        let total_count = first_page_response.total_count;
        let mut all_statuses: Vec<CommitStatusEntry> = first_page_response.statuses;
        let mut page = 2u32;

        while (all_statuses.len() < total_count && total_count > 0) && page <= 10 {
            let url = format!(
                "https://api.github.com/repos/{}/{}/commits/{}/status?per_page={}&page={}",
                owner, repo, sha, per_page, page
            );

            let response = self
                .client
                .get(&url)
                .header("Authorization", format!("token {}", token))
                .header("User-Agent", "ai-command-center")
                .send()
                .await
                .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unable to read response body".to_string());
                return Err(GitHubError::ApiError {
                    status: status.as_u16(),
                    message: body,
                });
            }

            let page_response: CombinedStatusResponse = response
                .json()
                .await
                .map_err(|e| GitHubError::ParseError(e.to_string()))?;

            all_statuses.extend(page_response.statuses);

            if page == 10 && all_statuses.len() < total_count {
                eprintln!(
                    "[GitHub] Capped combined status pagination at 10 pages ({} of {} fetched)",
                    all_statuses.len(),
                    total_count
                );
            }

            page += 1;
        }

        let result = CombinedStatusResponse {
            state: result_state,
            statuses: all_statuses,
            sha: result_sha,
            total_count: 0,
            extra: result_extra,
        };

        if let Some(etag_value) = first_etag {
            let body = serde_json::to_string(&result)
                .map_err(|e| GitHubError::ParseError(e.to_string()))?;
            self.etag_cache.lock().unwrap().insert(
                first_page_url,
                CachedResponse {
                    etag: etag_value,
                    body,
                },
            );
        }

        Ok(result)
    }

    /// Get authenticated user's login
    ///
    /// # Arguments
    /// * `token` - GitHub Personal Access Token
    ///
    /// # Returns
    /// User's login (username) on success
    pub async fn get_authenticated_user(&self, token: &str) -> Result<String, GitHubError> {
        let url = "https://api.github.com/user";

        let response = self
            .client
            .get(url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center")
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(GitHubError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        let user: AuthenticatedUser = response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;

        Ok(user.login)
    }

    /// Search for PRs where the user is requested as a reviewer
    ///
    /// # Arguments
    /// * `username` - GitHub username to search for
    /// * `token` - GitHub Personal Access Token
    ///
    /// # Returns
    /// Vector of SearchPrResult with full PR details
    pub async fn search_review_requested_prs(
        &self,
        username: &str,
        token: &str,
    ) -> Result<Vec<SearchPrResult>, GitHubError> {
        let url = format!(
            "https://api.github.com/search/issues?q=review-requested:{}+type:pr+state:open&per_page=100",
            username
        );

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center")
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(GitHubError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        let search_response: SearchResponse = response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;

        let items_with_coords: Vec<(SearchItem, String, String)> = search_response
            .items
            .into_iter()
            .filter_map(|item| {
                let parts: Vec<&str> = item.repository_url.split('/').collect();
                if parts.len() < 2 {
                    return None;
                }
                let owner = parts[parts.len() - 2].to_string();
                let repo = parts[parts.len() - 1].to_string();
                Some((item, owner, repo))
            })
            .collect();

        let detail_futures: Vec<_> = items_with_coords
            .iter()
            .map(|(item, owner, repo)| self.get_pr_details(owner, repo, item.number, token))
            .collect();

        let detail_results = join_all(detail_futures).await;

        let mut results = Vec::new();
        for ((item, owner, repo), pr_result) in
            items_with_coords.into_iter().zip(detail_results)
        {
            match pr_result {
                Ok(pr_details) => {
                    results.push(SearchPrResult {
                        id: item.id,
                        number: item.number,
                        title: item.title,
                        body: item.body,
                        state: item.state,
                        draft: item.draft.unwrap_or(false),
                        html_url: item.html_url,
                        user_login: item.user.login,
                        user_avatar_url: item.user.avatar_url,
                        repo_owner: owner,
                        repo_name: repo,
                        head_ref: pr_details.head.ref_name,
                        base_ref: pr_details.extra.get("base")
                            .and_then(|b| b.get("ref"))
                            .and_then(|r| r.as_str())
                            .unwrap_or("main")
                            .to_string(),
                        head_sha: pr_details.head.sha,
                        additions: pr_details.extra.get("additions")
                            .and_then(|a| a.as_i64())
                            .unwrap_or(0),
                        deletions: pr_details.extra.get("deletions")
                            .and_then(|d| d.as_i64())
                            .unwrap_or(0),
                        changed_files: pr_details.extra.get("changed_files")
                            .and_then(|c| c.as_i64())
                            .unwrap_or(0),
                        created_at: item.created_at,
                        updated_at: item.updated_at,
                    });
                }
                Err(e) => {
                    eprintln!(
                        "[GitHub] Failed to fetch PR details for {}/{} #{}: {}",
                        owner, repo, item.number, e
                    );
                }
            }
        }

        Ok(results)
    }

    /// Get file diffs for a pull request
    ///
    /// # Arguments
    /// * `owner` - Repository owner
    /// * `repo` - Repository name
    /// * `pr_number` - Pull request number
    /// * `token` - GitHub Personal Access Token
    ///
    /// # Returns
    /// Vector of PrFileDiff with file changes
    pub async fn get_pr_files(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
    ) -> Result<Vec<PrFileDiff>, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/files?per_page=100",
            owner, repo, pr_number
        );

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center")
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(GitHubError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        let files: Vec<PrFileDiff> = response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;

        Ok(files)
    }

    /// Get blob content by SHA
    ///
    /// # Arguments
    /// * `owner` - Repository owner
    /// * `repo` - Repository name
    /// * `sha` - Blob SHA
    /// * `token` - GitHub Personal Access Token
    ///
    /// # Returns
    /// Decoded blob content as String
    pub async fn get_blob_content(
        &self,
        owner: &str,
        repo: &str,
        sha: &str,
        token: &str,
    ) -> Result<String, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/git/blobs/{}",
            owner, repo, sha
        );

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center")
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(GitHubError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        let blob: BlobResponse = response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;

        // Decode base64 content
        let decoded = general_purpose::STANDARD
            .decode(&blob.content.replace('\n', ""))
            .map_err(|e| GitHubError::ParseError(format!("Base64 decode error: {}", e)))?;

        let content = String::from_utf8(decoded)
            .map_err(|e| GitHubError::ParseError(format!("UTF-8 decode error: {}", e)))?;

        Ok(content)
    }

    /// Fetch positioned review comments for a PR
    /// Returns inline review comments with path/line/side data
    pub async fn get_pr_review_comments(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
    ) -> Result<Vec<PrReviewComment>, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/comments?per_page=100",
            owner, repo, pr_number
        );

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center")
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(GitHubError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        let comments: Vec<PrReviewComment> = response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;

        Ok(comments)
    }

    /// Submit a PR review with inline comments
    /// event: "APPROVE", "REQUEST_CHANGES", or "COMMENT"
    pub async fn submit_review(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        event: &str,
        body: &str,
        comments: Vec<ReviewSubmitComment>,
        commit_id: &str,
        token: &str,
    ) -> Result<(), GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/reviews",
            owner, repo, pr_number
        );

        let request_body = ReviewSubmitRequest {
            commit_id: commit_id.to_string(),
            event: event.to_string(),
            body: body.to_string(),
            comments,
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "ai-command-center")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(GitHubError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        Ok(())
    }

    /// Get reviews for a pull request
    ///
    /// Fetches all reviews to determine approval/changes-requested state.
    ///
    /// # Arguments
    /// * `owner` - Repository owner
    /// * `repo` - Repository name
    /// * `pr_number` - Pull request number
    /// * `token` - GitHub Personal Access Token
    ///
    /// # Returns
    /// Vector of PrReview with review state per reviewer
    pub async fn get_pr_reviews(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
    ) -> Result<Vec<PrReview>, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/reviews?per_page=100",
            owner, repo, pr_number
        );
        self.get_with_etag::<Vec<PrReview>>(&url, token).await
    }
}

/// Aggregate CI status from check runs and commit status
///
/// Determines the overall CI status by examining both check runs and commit statuses.
/// Returns one of: "none", "pending", "success", or "failure".
///
/// # Arguments
/// * `check_runs` - Check runs response from GitHub API
/// * `commit_status` - Combined status response from GitHub API
///
/// # Returns
/// Aggregated CI status string
pub fn aggregate_ci_status(
    check_runs: &CheckRunsResponse,
    commit_status: &CombinedStatusResponse,
) -> String {
    if check_runs.check_runs.is_empty() && commit_status.statuses.is_empty() {
        return "none".to_string();
    }

    // Only treat actual pipeline failures as "failure"
    for check_run in &check_runs.check_runs {
        if let Some(conclusion) = &check_run.conclusion {
            match conclusion.as_str() {
                "failure" | "timed_out" => {
                    return "failure".to_string();
                }
                _ => {}
            }
        }
    }
    if commit_status.state == "failure" || commit_status.state == "error" {
        return "failure".to_string();
    }

    // Treat action_required as pending (e.g., workflow approval needed)
    // Also treat in-progress checks as pending
    for check_run in &check_runs.check_runs {
        if check_run.status != "completed" {
            return "pending".to_string();
        }
        if let Some(conclusion) = &check_run.conclusion {
            if conclusion == "action_required" {
                return "pending".to_string();
            }
        }
    }

    if commit_status.state == "pending" && !commit_status.statuses.is_empty() {
        return "pending".to_string();
    }

    "success".to_string()
}

/// Aggregate review status from PR reviews and requested reviewers
///
/// Determines the overall review status by examining submitted reviews.
/// Returns one of: "approved", "changes_requested", "review_required", or "none".
pub fn aggregate_review_status(
    reviews: &[PrReview],
    has_requested_reviewers: bool,
) -> String {
    if reviews.is_empty() && !has_requested_reviewers {
        return "none".to_string();
    }

    // Build effective review state per reviewer (latest actionable review wins)
    let mut effective: std::collections::HashMap<&str, &str> = std::collections::HashMap::new();
    for review in reviews {
        match review.state.as_str() {
            "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED" => {
                effective.insert(&review.user.login, &review.state);
            }
            _ => {}
        }
    }

    // Check if any reviewer requested changes (and hasn't since approved)
    for state in effective.values() {
        if *state == "CHANGES_REQUESTED" {
            return "changes_requested".to_string();
        }
    }

    // If there are still pending reviewers, reviews are required
    if has_requested_reviewers {
        return "review_required".to_string();
    }

    // If at least one approval exists and no changes requested
    if effective.values().any(|s| *s == "APPROVED") {
        return "approved".to_string();
    }

    // Reviews exist but none are actionable (all COMMENTED/PENDING)
    if !reviews.is_empty() {
        return "review_required".to_string();
    }

    "none".to_string()
}

impl Default for GitHubClient {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Request/Response Types
// ============================================================================

/// Pull request representation
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PullRequest {
    pub number: i64,
    pub title: String,
    pub state: String,
    pub html_url: String,
    pub user: GitHubUser,
    pub head: GitHubHead,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Search PR result with full details
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SearchPrResult {
    pub id: i64,
    pub number: i64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub draft: bool,
    pub html_url: String,
    pub user_login: String,
    pub user_avatar_url: Option<String>,
    pub repo_owner: String,
    pub repo_name: String,
    pub head_ref: String,
    pub base_ref: String,
    pub head_sha: String,
    pub additions: i64,
    pub deletions: i64,
    pub changed_files: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// PR file diff
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PrFileDiff {
    pub sha: String,
    pub filename: String,
    pub status: String,
    pub additions: i64,
    pub deletions: i64,
    pub changes: i64,
    pub patch: Option<String>,
    pub previous_filename: Option<String>,
    #[serde(default)]
    pub is_truncated: bool,
    #[serde(default)]
    pub patch_line_count: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PrReviewComment {
    pub id: i64,
    pub path: String,
    pub line: Option<i32>,
    pub side: Option<String>,
    pub body: String,
    pub user: GitHubUser,
    pub created_at: String,
    pub in_reply_to_id: Option<i64>,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Unified PR comment (can be review comment or issue comment)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PrComment {
    pub id: i64,
    pub body: String,
    pub user: GitHubUser,
    /// File path (only present for review comments)
    pub path: Option<String>,
    /// Line number (only present for review comments)
    pub line: Option<i32>,
    /// Type of comment: "review_comment" or "issue_comment"
    pub comment_type: String,
    pub created_at: String,
}

/// GitHub user
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GitHubUser {
    pub login: String,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// GitHub head ref (branch info)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GitHubHead {
    /// Branch name (e.g., "feature/PROJ-123-fix-bug")
    #[serde(rename = "ref")]
    pub ref_name: String,
    /// Commit SHA of the head branch
    pub sha: String,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Review comment (inline code comment) from GitHub API
#[derive(Debug, Deserialize)]
struct ReviewComment {
    id: i64,
    body: String,
    user: GitHubUser,
    path: String,
    line: Option<i32>,
    created_at: String,
    #[serde(flatten)]
    extra: serde_json::Value,
}

/// Issue comment (general comment) from GitHub API
#[derive(Debug, Deserialize)]
struct IssueComment {
    id: i64,
    body: String,
    user: GitHubUser,
    created_at: String,
    #[serde(flatten)]
    extra: serde_json::Value,
}

/// Request body for posting a comment
#[derive(Debug, Serialize)]
struct CommentRequest {
    body: String,
}

#[derive(Debug, Serialize)]
struct ReviewSubmitRequest {
    commit_id: String,
    event: String,
    body: String,
    comments: Vec<ReviewSubmitComment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewSubmitComment {
    pub path: String,
    pub line: i32,
    pub side: String,
    pub body: String,
}

#[derive(Debug, Deserialize)]
struct AuthenticatedUser {
    login: String,
    #[serde(flatten)]
    extra: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    items: Vec<SearchItem>,
    #[serde(flatten)]
    extra: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct SearchItem {
    id: i64,
    number: i64,
    title: String,
    body: Option<String>,
    state: String,
    draft: Option<bool>,
    html_url: String,
    user: SearchUser,
    repository_url: String,
    created_at: String,
    updated_at: String,
    #[serde(flatten)]
    extra: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct SearchUser {
    login: String,
    avatar_url: Option<String>,
    #[serde(flatten)]
    extra: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct BlobResponse {
    content: String,
    encoding: String,
    #[serde(flatten)]
    extra: serde_json::Value,
}

/// PR review from GitHub API
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PrReview {
    pub id: i64,
    pub user: GitHubUser,
    pub state: String,
    #[serde(default)]
    pub submitted_at: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Check runs response from GitHub API
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CheckRunsResponse {
    /// Total number of check runs
    pub total_count: usize,
    /// List of check runs
    pub check_runs: Vec<CheckRun>,
}

/// Individual check run from GitHub API
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CheckRun {
    /// Check run ID
    pub id: i64,
    /// Check run name (e.g., "build", "test", "lint")
    pub name: String,
    /// Check run status (e.g., "queued", "in_progress", "completed")
    #[serde(default)]
    pub status: String,
    /// Check run conclusion (e.g., "success", "failure", "skipped", "neutral")
    #[serde(default)]
    pub conclusion: Option<String>,
    /// URL to view the check run
    pub html_url: String,
}

/// Combined status response from GitHub API
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CombinedStatusResponse {
    /// Overall state (e.g., "success", "failure", "pending", "error")
    pub state: String,
    /// List of commit statuses
    pub statuses: Vec<CommitStatusEntry>,
    /// Commit SHA
    #[serde(default)]
    pub sha: String,
    /// Total number of statuses
    #[serde(default)]
    pub total_count: usize,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Individual commit status entry from GitHub API
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CommitStatusEntry {
    /// Status state (e.g., "success", "failure", "pending", "error")
    pub state: String,
    /// Status context (e.g., "continuous-integration/travis-ci")
    pub context: String,
    /// Status description
    #[serde(default)]
    pub description: Option<String>,
    /// URL to view the status
    #[serde(default)]
    pub target_url: Option<String>,
}

// ============================================================================
// Error Types
// ============================================================================

/// GitHub API error types
#[derive(Debug)]
pub enum GitHubError {
    /// Network error (connection failure, timeout, etc.)
    NetworkError(String),
    /// API error (non-2xx status code)
    ApiError { status: u16, message: String },
    /// Parse error (JSON deserialization failure)
    ParseError(String),
}

impl fmt::Display for GitHubError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GitHubError::NetworkError(msg) => write!(f, "Network error: {}", msg),
            GitHubError::ApiError { status, message } => {
                write!(f, "API error (status {}): {}", status, message)
            }
            GitHubError::ParseError(msg) => write!(f, "Parse error: {}", msg),
        }
    }
}

impl StdError for GitHubError {}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_creation() {
        let _client = GitHubClient::new();
    }

    #[test]
    fn test_client_default() {
        let _client = GitHubClient::default();
    }

    #[test]
    fn test_etag_cache_initialized_empty() {
        let client = GitHubClient::new();
        let cache = client.etag_cache.lock().unwrap();
        assert!(cache.is_empty());
    }

    #[test]
    fn test_cached_response_fields() {
        let cached = CachedResponse {
            etag: "\"abc123\"".to_string(),
            body: "[{\"id\":1}]".to_string(),
        };
        assert_eq!(cached.etag, "\"abc123\"");
        assert_eq!(cached.body, "[{\"id\":1}]");
    }

    #[test]
    fn test_comment_request_serialization() {
        let request = CommentRequest {
            body: "Test comment".to_string(),
        };
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("\"body\""));
        assert!(json.contains("\"Test comment\""));
    }

    #[test]
    fn test_error_display() {
        let network_err = GitHubError::NetworkError("Connection timeout".to_string());
        assert_eq!(
            network_err.to_string(),
            "Network error: Connection timeout"
        );

        let api_err = GitHubError::ApiError {
            status: 404,
            message: "Not Found".to_string(),
        };
        assert_eq!(api_err.to_string(), "API error (status 404): Not Found");

        let parse_err = GitHubError::ParseError("Invalid JSON".to_string());
        assert_eq!(parse_err.to_string(), "Parse error: Invalid JSON");
    }

    #[test]
    fn test_pr_comment_serialization() {
        let comment = PrComment {
            id: 123,
            body: "Test comment".to_string(),
            user: GitHubUser {
                login: "testuser".to_string(),
                extra: serde_json::json!({}),
            },
            path: Some("src/main.rs".to_string()),
            line: Some(42),
            comment_type: "review_comment".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&comment).unwrap();
        assert!(json.contains("\"id\":123"));
        assert!(json.contains("\"comment_type\":\"review_comment\""));
        assert!(json.contains("\"path\":\"src/main.rs\""));
        assert!(json.contains("\"line\":42"));
    }

    #[test]
    fn test_pull_request_deserialization() {
        let json = r#"{
            "number": 123,
            "title": "Test PR",
            "state": "open",
            "html_url": "https://github.com/owner/repo/pull/123",
            "user": {
                "login": "testuser"
            },
            "head": {
                "ref": "feature/PROJ-123-fix-bug",
                "sha": "abc123def456"
            },
            "extra_field": "ignored"
        }"#;

        let pr: PullRequest = serde_json::from_str(json).unwrap();
        assert_eq!(pr.number, 123);
        assert_eq!(pr.title, "Test PR");
        assert_eq!(pr.state, "open");
        assert_eq!(pr.user.login, "testuser");
        assert_eq!(pr.head.ref_name, "feature/PROJ-123-fix-bug");
    }

    #[test]
    fn test_pr_file_diff_deserialization() {
        let json = r#"{
            "sha": "abc123",
            "filename": "src/main.rs",
            "status": "modified",
            "additions": 10,
            "deletions": 5,
            "changes": 15,
            "patch": "@@ -1,3 +1,5 @@\n-old\n+new",
            "previous_filename": null
        }"#;
        let diff: PrFileDiff = serde_json::from_str(json).unwrap();
        assert_eq!(diff.sha, "abc123");
        assert_eq!(diff.filename, "src/main.rs");
        assert_eq!(diff.status, "modified");
        assert_eq!(diff.additions, 10);
        assert_eq!(diff.deletions, 5);
        assert_eq!(diff.changes, 15);
        assert!(diff.patch.is_some());
        assert!(diff.previous_filename.is_none());
    }

    #[test]
    fn test_pr_file_diff_with_rename() {
        let json = r#"{
            "sha": "def456",
            "filename": "src/new.rs",
            "status": "renamed",
            "additions": 2,
            "deletions": 1,
            "changes": 3,
            "patch": null,
            "previous_filename": "src/old.rs"
        }"#;
        let diff: PrFileDiff = serde_json::from_str(json).unwrap();
        assert_eq!(diff.filename, "src/new.rs");
        assert_eq!(diff.status, "renamed");
        assert!(diff.patch.is_none());
        assert_eq!(diff.previous_filename, Some("src/old.rs".to_string()));
    }

    #[test]
    fn test_pr_review_comment_deserialization() {
        let json = r#"{
            "id": 456,
            "path": "src/auth.rs",
            "line": 42,
            "side": "RIGHT",
            "body": "This needs a null check",
            "user": { "login": "reviewer" },
            "created_at": "2024-01-15T10:30:00Z",
            "in_reply_to_id": null
        }"#;
        let comment: PrReviewComment = serde_json::from_str(json).unwrap();
        assert_eq!(comment.id, 456);
        assert_eq!(comment.path, "src/auth.rs");
        assert_eq!(comment.line, Some(42));
        assert_eq!(comment.side, Some("RIGHT".to_string()));
        assert_eq!(comment.body, "This needs a null check");
        assert_eq!(comment.user.login, "reviewer");
        assert!(comment.in_reply_to_id.is_none());
    }

    #[test]
    fn test_pr_review_comment_with_reply() {
        let json = r#"{
            "id": 789,
            "path": "src/lib.rs",
            "line": 10,
            "side": "LEFT",
            "body": "I agree with this suggestion",
            "user": { "login": "author" },
            "created_at": "2024-01-15T11:00:00Z",
            "in_reply_to_id": 100
        }"#;
        let comment: PrReviewComment = serde_json::from_str(json).unwrap();
        assert_eq!(comment.id, 789);
        assert_eq!(comment.in_reply_to_id, Some(100));
        assert_eq!(comment.body, "I agree with this suggestion");
    }

    #[test]
    fn test_review_submit_comment_serialization() {
        let comment = ReviewSubmitComment {
            path: "src/main.rs".to_string(),
            line: 10,
            side: "RIGHT".to_string(),
            body: "Fix this".to_string(),
        };
        let json = serde_json::to_string(&comment).unwrap();
        assert!(json.contains("\"path\":\"src/main.rs\""));
        assert!(json.contains("\"line\":10"));
        assert!(json.contains("\"side\":\"RIGHT\""));
        assert!(json.contains("\"body\":\"Fix this\""));
    }

    #[test]
    fn test_review_submit_request_serialization() {
        let request = ReviewSubmitRequest {
            commit_id: "sha123".to_string(),
            event: "APPROVE".to_string(),
            body: "Looks good!".to_string(),
            comments: vec![ReviewSubmitComment {
                path: "src/lib.rs".to_string(),
                line: 5,
                side: "RIGHT".to_string(),
                body: "Nice change".to_string(),
            }],
        };
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("\"commit_id\":\"sha123\""));
        assert!(json.contains("\"event\":\"APPROVE\""));
        assert!(json.contains("\"comments\""));
    }

    #[test]
    fn test_search_item_deserialization() {
        let json = r#"{
            "id": 789,
            "number": 42,
            "title": "Fix bug",
            "body": "Description",
            "state": "open",
            "draft": false,
            "html_url": "https://github.com/owner/repo/pull/42",
            "user": { "login": "author", "avatar_url": "https://example.com/avatar.png" },
            "repository_url": "https://api.github.com/repos/owner/repo",
            "created_at": "2024-01-15T10:00:00Z",
            "updated_at": "2024-01-15T12:00:00Z"
        }"#;
        let item: SearchItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.id, 789);
        assert_eq!(item.number, 42);
        assert_eq!(item.title, "Fix bug");
        assert_eq!(item.draft, Some(false));
        assert_eq!(item.user.login, "author");
        assert_eq!(
            item.user.avatar_url,
            Some("https://example.com/avatar.png".to_string())
        );
    }

    #[test]
    fn test_blob_response_deserialization() {
        let json = r#"{
            "content": "SGVsbG8gV29ybGQ=\n",
            "encoding": "base64",
            "size": 11
        }"#;
        let blob: BlobResponse = serde_json::from_str(json).unwrap();
        assert_eq!(blob.encoding, "base64");
        assert!(!blob.content.is_empty());
    }

    #[test]
    fn test_authenticated_user_deserialization() {
        let json = r#"{ "login": "testuser", "id": 12345, "type": "User" }"#;
        let user: AuthenticatedUser = serde_json::from_str(json).unwrap();
        assert_eq!(user.login, "testuser");
    }

    #[test]
    fn test_github_head_sha_deserialization() {
        let json = r#"{"ref": "feature/T-1", "sha": "abc123def456", "repo": {"id": 1}}"#;
        let head: GitHubHead = serde_json::from_str(json).unwrap();
        assert_eq!(head.sha, "abc123def456");
        assert_eq!(head.ref_name, "feature/T-1");
    }

    #[test]
    fn test_check_runs_deserialization() {
        let json = r#"{"total_count":1,"check_runs":[{"id":1,"name":"build","status":"completed","conclusion":"success","html_url":"https://example.com"}]}"#;
        let resp: CheckRunsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.total_count, 1);
        assert_eq!(resp.check_runs[0].conclusion, Some("success".to_string()));

        let json = r#"{"total_count":1,"check_runs":[{"id":2,"name":"test","status":"in_progress","conclusion":null,"html_url":"https://example.com"}]}"#;
        let resp: CheckRunsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.check_runs[0].status, "in_progress");
        assert_eq!(resp.check_runs[0].conclusion, None);

        let json = r#"{"total_count":0,"check_runs":[]}"#;
        let resp: CheckRunsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.total_count, 0);
        assert!(resp.check_runs.is_empty());
    }

    #[test]
    fn test_combined_status_deserialization() {
        let json = r#"{"state":"success","statuses":[{"state":"success","context":"ci/build","description":"Build passed","target_url":"https://example.com"}],"sha":"abc123","total_count":1}"#;
        let resp: CombinedStatusResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.state, "success");
        assert_eq!(resp.statuses.len(), 1);
        assert_eq!(resp.statuses[0].context, "ci/build");

        let json = r#"{"state":"pending","statuses":[],"sha":"def456","total_count":0}"#;
        let resp: CombinedStatusResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.state, "pending");
        assert!(resp.statuses.is_empty());
    }

    #[test]
    fn test_aggregate_ci_status() {
        fn make_check_runs(runs: Vec<(&str, &str, Option<&str>)>) -> CheckRunsResponse {
            CheckRunsResponse {
                total_count: runs.len(),
                check_runs: runs.into_iter().map(|(name, status, conclusion)| CheckRun {
                    id: 1,
                    name: name.to_string(),
                    status: status.to_string(),
                    conclusion: conclusion.map(|c| c.to_string()),
                    html_url: "https://example.com".to_string(),
                }).collect(),
            }
        }

        fn make_combined(state: &str, statuses: Vec<&str>) -> CombinedStatusResponse {
            CombinedStatusResponse {
                state: state.to_string(),
                statuses: statuses.into_iter().map(|s| CommitStatusEntry {
                    state: s.to_string(),
                    context: "ci".to_string(),
                    description: None,
                    target_url: None,
                }).collect(),
                sha: "abc".to_string(),
                total_count: 0,
                extra: serde_json::Value::Object(serde_json::Map::new()),
            }
        }

        let empty_runs = make_check_runs(vec![]);
        let empty_combined = make_combined("pending", vec![]);

        assert_eq!(aggregate_ci_status(&empty_runs, &empty_combined), "none");

        let success_runs = make_check_runs(vec![("build", "completed", Some("success")), ("test", "completed", Some("success"))]);
        let success_combined = make_combined("success", vec!["success"]);
        assert_eq!(aggregate_ci_status(&success_runs, &success_combined), "success");

        let failure_runs = make_check_runs(vec![("build", "completed", Some("failure")), ("test", "completed", Some("success"))]);
        assert_eq!(aggregate_ci_status(&failure_runs, &empty_combined), "failure");

        let timed_out_runs = make_check_runs(vec![("build", "completed", Some("timed_out"))]);
        assert_eq!(aggregate_ci_status(&timed_out_runs, &empty_combined), "failure");

        // cancelled is no longer treated as failure — it's neutral (pipeline was stopped, not failed)
        let cancelled_runs = make_check_runs(vec![("build", "completed", Some("cancelled"))]);
        assert_eq!(aggregate_ci_status(&cancelled_runs, &empty_combined), "success");

        // action_required is treated as pending (e.g., workflow approval needed)
        let action_required_runs = make_check_runs(vec![("build", "completed", Some("action_required"))]);
        assert_eq!(aggregate_ci_status(&action_required_runs, &empty_combined), "pending");

        let failure_combined = make_combined("failure", vec!["failure"]);
        assert_eq!(aggregate_ci_status(&empty_runs, &failure_combined), "failure");

        let error_combined = make_combined("error", vec!["error"]);
        assert_eq!(aggregate_ci_status(&empty_runs, &error_combined), "failure");

        let pending_runs = make_check_runs(vec![("build", "in_progress", None), ("test", "completed", Some("success"))]);
        assert_eq!(aggregate_ci_status(&pending_runs, &empty_combined), "pending");

        let pending_combined = make_combined("pending", vec!["pending"]);
        assert_eq!(aggregate_ci_status(&empty_runs, &pending_combined), "pending");

        let neutral_runs = make_check_runs(vec![("build", "completed", Some("neutral")), ("lint", "completed", Some("skipped"))]);
        assert_eq!(aggregate_ci_status(&neutral_runs, &empty_combined), "success");

        let null_conclusion_runs = make_check_runs(vec![("build", "completed", None)]);
        assert_eq!(aggregate_ci_status(&null_conclusion_runs, &empty_combined), "success");
    }
}
