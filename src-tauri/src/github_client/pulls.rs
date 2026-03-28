use base64::{engine::general_purpose, Engine as _};
use futures::future::join_all;
use log::warn;

use super::error::GitHubError;
use super::types::*;
use super::GitHubClient;

impl GitHubClient {
    pub async fn merge_pr(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
    ) -> Result<MergePrResponse, GitHubError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/merge",
            owner, repo, pr_number
        );

        let request_body = MergePrRequest {
            commit_title: None,
            commit_message: None,
            merge_method: Some("merge".to_string()),
        };

        let response = self
            .client
            .put(&url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "openforge")
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

        response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))
    }

    /// Get pull request details
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
            .header("User-Agent", "openforge")
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
    pub async fn get_pr_comments(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        token: &str,
        since: Option<&str>,
    ) -> Result<Vec<PrComment>, GitHubError> {
        let mut review_comments_url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/comments?per_page=100",
            owner, repo, pr_number
        );
        if let Some(ts) = since {
            review_comments_url.push_str(&format!("&since={}", ts));
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
            .header("User-Agent", "openforge");
        if let Some(ref etag) = review_cached_etag {
            review_req = review_req.header("If-None-Match", etag);
        }

        let review_response = review_req
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        let mut review_comments: Vec<ReviewComment> =
            if review_response.status() == reqwest::StatusCode::NOT_MODIFIED {
                if let Some(cached) = self.etag_cache.lock().unwrap().get(&review_comments_url) {
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
                        super::CachedResponse {
                            etag: etag_value,
                            body: body.clone(),
                        },
                    );
                }
                serde_json::from_str(&body).map_err(|e| GitHubError::ParseError(e.to_string()))?
            };

        let mut issue_comments_url = format!(
            "https://api.github.com/repos/{}/{}/issues/{}/comments?per_page=100",
            owner, repo, pr_number
        );
        if let Some(ts) = since {
            issue_comments_url.push_str(&format!("&since={}", ts));
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
            .header("User-Agent", "openforge");
        if let Some(ref etag) = issue_cached_etag {
            issue_req = issue_req.header("If-None-Match", etag);
        }

        let issue_response = issue_req
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        let mut issue_comments: Vec<IssueComment> =
            if issue_response.status() == reqwest::StatusCode::NOT_MODIFIED {
                if let Some(cached) = self.etag_cache.lock().unwrap().get(&issue_comments_url) {
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
                        super::CachedResponse {
                            etag: etag_value,
                            body: body.clone(),
                        },
                    );
                }
                serde_json::from_str(&body).map_err(|e| GitHubError::ParseError(e.to_string()))?
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

        // Fetch review bodies (top-level summary comments from PR reviews).
        // These are only accessible via /pulls/{number}/reviews and are NOT
        // included in the review comments or issue comments endpoints.
        let reviews = self
            .get_pr_reviews(owner, repo, pr_number, token)
            .await
            .unwrap_or_else(|e| {
                warn!(
                    "[GitHub] Failed to fetch reviews for PR #{}: {}",
                    pr_number, e
                );
                vec![]
            });

        for review in reviews {
            let body = match &review.body {
                Some(b) if !b.is_empty() => b.clone(),
                _ => continue,
            };
            let submitted_at = review.submitted_at.unwrap_or_default();
            if !submitted_at.is_empty() {
                if let Some(ts) = since {
                    if submitted_at.as_str() < ts {
                        continue;
                    }
                }
            }
            all_comments.push(PrComment {
                id: -review.id,
                body,
                user: review.user,
                path: None,
                line: None,
                comment_type: "review_body".to_string(),
                created_at: submitted_at,
            });
        }

        Ok(all_comments)
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

    pub async fn search_review_requested_prs(
        &self,
        username: &str,
        token: &str,
    ) -> Result<(Vec<SearchPrResult>, Vec<i64>), GitHubError> {
        let url = format!(
            "https://api.github.com/search/issues?q=review-requested:{}+type:pr+state:open&per_page=100",
            username
        );

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "openforge")
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

        let all_search_ids: Vec<i64> = search_response.items.iter().map(|item| item.id).collect();
        let is_complete = search_response.total_count <= search_response.items.len();

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
        for ((item, owner, repo), pr_result) in items_with_coords.into_iter().zip(detail_results) {
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
                        base_ref: pr_details
                            .extra
                            .get("base")
                            .and_then(|b| b.get("ref"))
                            .and_then(|r| r.as_str())
                            .unwrap_or("main")
                            .to_string(),
                        head_sha: pr_details.head.sha,
                        additions: pr_details
                            .extra
                            .get("additions")
                            .and_then(|a| a.as_i64())
                            .unwrap_or(0),
                        deletions: pr_details
                            .extra
                            .get("deletions")
                            .and_then(|d| d.as_i64())
                            .unwrap_or(0),
                        changed_files: pr_details
                            .extra
                            .get("changed_files")
                            .and_then(|c| c.as_i64())
                            .unwrap_or(0),
                        mergeable: pr_details.mergeable,
                        mergeable_state: pr_details.mergeable_state,
                        created_at: item.created_at,
                        updated_at: item.updated_at,
                    });
                }
                Err(e) => {
                    warn!(
                        "[GitHub] Failed to fetch PR details for {}/{} #{}: {}",
                        owner, repo, item.number, e
                    );
                }
            }
        }

        let safe_search_ids = if is_complete { all_search_ids } else { vec![] };
        Ok((results, safe_search_ids))
    }

    pub async fn search_authored_prs(
        &self,
        username: &str,
        token: &str,
    ) -> Result<(Vec<SearchPrResult>, Vec<i64>), GitHubError> {
        let url = format!(
            "https://api.github.com/search/issues?q=author:{}+type:pr+state:open&per_page=100",
            username
        );

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "openforge")
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

        let all_search_ids: Vec<i64> = search_response.items.iter().map(|item| item.id).collect();
        let is_complete = search_response.total_count <= search_response.items.len();

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
        for ((item, owner, repo), pr_result) in items_with_coords.into_iter().zip(detail_results) {
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
                        base_ref: pr_details
                            .extra
                            .get("base")
                            .and_then(|b| b.get("ref"))
                            .and_then(|r| r.as_str())
                            .unwrap_or("main")
                            .to_string(),
                        head_sha: pr_details.head.sha,
                        additions: pr_details
                            .extra
                            .get("additions")
                            .and_then(|a| a.as_i64())
                            .unwrap_or(0),
                        deletions: pr_details
                            .extra
                            .get("deletions")
                            .and_then(|d| d.as_i64())
                            .unwrap_or(0),
                        changed_files: pr_details
                            .extra
                            .get("changed_files")
                            .and_then(|c| c.as_i64())
                            .unwrap_or(0),
                        mergeable: pr_details.mergeable,
                        mergeable_state: pr_details.mergeable_state,
                        created_at: item.created_at,
                        updated_at: item.updated_at,
                    });
                }
                Err(e) => {
                    warn!(
                        "[GitHub] Failed to fetch PR details for {}/{} #{}: {}",
                        owner, repo, item.number, e
                    );
                }
            }
        }

        let safe_search_ids = if is_complete { all_search_ids } else { vec![] };
        Ok((results, safe_search_ids))
    }

    /// Get file diffs for a pull request
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
            .header("User-Agent", "openforge")
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
            .header("User-Agent", "openforge")
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
            .decode(blob.content.replace('\n', ""))
            .map_err(|e| GitHubError::ParseError(format!("Base64 decode error: {}", e)))?;

        let content = String::from_utf8(decoded)
            .map_err(|e| GitHubError::ParseError(format!("UTF-8 decode error: {}", e)))?;

        Ok(content)
    }
}
