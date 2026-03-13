use serde::{Deserialize, Serialize};

/// Pull request representation
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PullRequest {
    pub number: i64,
    pub title: String,
    pub state: String,
    pub html_url: String,
    pub user: GitHubUser,
    pub head: GitHubHead,
    pub draft: Option<bool>,
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
pub(crate) struct ReviewComment {
    pub id: i64,
    pub body: String,
    pub user: GitHubUser,
    pub path: String,
    pub line: Option<i32>,
    pub created_at: String,
}

/// Issue comment (general comment) from GitHub API
#[derive(Debug, Deserialize)]
pub(crate) struct IssueComment {
    pub id: i64,
    pub body: String,
    pub user: GitHubUser,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ReviewSubmitRequest {
    pub commit_id: String,
    pub event: String,
    pub body: String,
    pub comments: Vec<ReviewSubmitComment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewSubmitComment {
    pub path: String,
    pub line: i32,
    pub side: String,
    pub body: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AuthenticatedUser {
    pub login: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SearchResponse {
    pub items: Vec<SearchItem>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SearchItem {
    pub id: i64,
    pub number: i64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub draft: Option<bool>,
    pub html_url: String,
    pub user: SearchUser,
    pub repository_url: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SearchUser {
    pub login: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct BlobResponse {
    pub content: String,
}

/// PR review from GitHub API
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PrReview {
    pub id: i64,
    pub user: GitHubUser,
    pub state: String,
    /// Review body text (the top-level summary comment).
    /// Present when a reviewer submits a review with a body message.
    #[serde(default)]
    pub body: Option<String>,
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

/// Required status checks response from GitHub branch protection API
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RequiredStatusChecksResponse {
    /// Deprecated flat list of required check names
    #[serde(default)]
    pub contexts: Vec<String>,
    /// Required checks with context name and optional app_id
    #[serde(default)]
    pub checks: Vec<RequiredCheckEntry>,
}

/// Individual required check entry from branch protection API
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RequiredCheckEntry {
    /// Check context name (matches CheckRun.name or CommitStatusEntry.context)
    pub context: String,
}

impl RequiredStatusChecksResponse {
    /// Extract deduplicated context names from both `checks` and `contexts` fields
    pub fn into_context_names(self) -> Vec<String> {
        let mut names: Vec<String> = self.checks.into_iter().map(|c| c.context).collect();
        for ctx in self.contexts {
            if !names.contains(&ctx) {
                names.push(ctx);
            }
        }
        names
    }
}

/// Required pull request reviews response from GitHub branch protection API
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RequiredPullRequestReviewsResponse {
    /// Number of approving reviews required
    #[serde(default)]
    pub required_approving_review_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_required_status_checks_response_into_context_names_deduplicates() {
        let resp = RequiredStatusChecksResponse {
            contexts: vec!["ci/build".to_string(), "ci/test".to_string()],
            checks: vec![
                RequiredCheckEntry {
                    context: "ci/build".to_string(),
                },
                RequiredCheckEntry {
                    context: "ci/lint".to_string(),
                },
            ],
        };

        let names = resp.into_context_names();
        assert_eq!(names.len(), 3);
        assert!(names.contains(&"ci/build".to_string()));
        assert!(names.contains(&"ci/lint".to_string()));
        assert!(names.contains(&"ci/test".to_string()));
    }

    #[test]
    fn test_required_status_checks_response_checks_field_only() {
        let resp = RequiredStatusChecksResponse {
            contexts: vec![],
            checks: vec![
                RequiredCheckEntry {
                    context: "ci/build".to_string(),
                },
                RequiredCheckEntry {
                    context: "ci/test".to_string(),
                },
            ],
        };

        let names = resp.into_context_names();
        assert_eq!(names.len(), 2);
        assert_eq!(names[0], "ci/build");
        assert_eq!(names[1], "ci/test");
    }

    #[test]
    fn test_required_status_checks_response_contexts_field_only() {
        let resp = RequiredStatusChecksResponse {
            contexts: vec!["ci/build".to_string(), "ci/test".to_string()],
            checks: vec![],
        };

        let names = resp.into_context_names();
        assert_eq!(names.len(), 2);
        assert_eq!(names[0], "ci/build");
        assert_eq!(names[1], "ci/test");
    }

    #[test]
    fn test_required_status_checks_response_empty() {
        let resp = RequiredStatusChecksResponse {
            contexts: vec![],
            checks: vec![],
        };

        let names = resp.into_context_names();
        assert!(names.is_empty());
    }

    #[test]
    fn test_required_status_checks_response_deserialization() {
        let json = r#"{
            "contexts": ["ci/build", "ci/test"],
            "checks": [
                {"context": "ci/build", "app_id": 15368},
                {"context": "ci/lint", "app_id": null}
            ],
            "strict": true
        }"#;
        let resp: RequiredStatusChecksResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.contexts.len(), 2);
        assert_eq!(resp.checks.len(), 2);
        assert_eq!(resp.checks[0].context, "ci/build");
        assert_eq!(resp.checks[1].context, "ci/lint");
    }

    #[test]
    fn test_required_status_checks_response_deserialization_minimal() {
        let json = r#"{}"#;
        let resp: RequiredStatusChecksResponse = serde_json::from_str(json).unwrap();
        assert!(resp.contexts.is_empty());
        assert!(resp.checks.is_empty());
    }

    #[test]
    fn test_required_pr_reviews_response_deserialization() {
        let json = r#"{
            "required_approving_review_count": 2,
            "dismiss_stale_reviews": true,
            "require_code_owner_reviews": false
        }"#;
        let resp: RequiredPullRequestReviewsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.required_approving_review_count, 2);
    }

    #[test]
    fn test_required_pr_reviews_response_deserialization_minimal() {
        let json = r#"{}"#;
        let resp: RequiredPullRequestReviewsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.required_approving_review_count, 0);
    }

    #[test]
    fn test_required_pr_reviews_response_extra_fields() {
        let json = r#"{
            "required_approving_review_count": 1,
            "dismiss_stale_reviews": false,
            "require_code_owner_reviews": true,
            "require_last_push_approval": false,
            "dismissal_restrictions": {}
        }"#;
        let resp: RequiredPullRequestReviewsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.required_approving_review_count, 1);
    }

    #[test]
    fn test_pr_review_deserialization_with_body() {
        let json = r#"{
            "id": 80,
            "user": { "login": "copilot[bot]", "id": 198982749, "type": "Bot" },
            "body": "Copilot Review\n\nI found several issues.",
            "state": "COMMENTED",
            "submitted_at": "2024-01-15T10:30:00Z",
            "commit_id": "abc123"
        }"#;
        let review: PrReview = serde_json::from_str(json).unwrap();
        assert_eq!(review.id, 80);
        assert_eq!(review.user.login, "copilot[bot]");
        assert_eq!(review.state, "COMMENTED");
        assert_eq!(
            review.body,
            Some("Copilot Review\n\nI found several issues.".to_string())
        );
        assert_eq!(
            review.submitted_at,
            Some("2024-01-15T10:30:00Z".to_string())
        );
    }

    #[test]
    fn test_pr_review_deserialization_empty_body() {
        let json = r#"{
            "id": 81,
            "user": { "login": "reviewer" },
            "body": "",
            "state": "APPROVED",
            "submitted_at": "2024-01-15T11:00:00Z"
        }"#;
        let review: PrReview = serde_json::from_str(json).unwrap();
        assert_eq!(review.id, 81);
        assert_eq!(review.body, Some("".to_string()));
        assert_eq!(review.state, "APPROVED");
    }

    #[test]
    fn test_pr_review_deserialization_null_body() {
        let json = r#"{
            "id": 82,
            "user": { "login": "reviewer" },
            "body": null,
            "state": "PENDING"
        }"#;
        let review: PrReview = serde_json::from_str(json).unwrap();
        assert_eq!(review.id, 82);
        assert_eq!(review.body, None);
    }

    #[test]
    fn test_pr_review_deserialization_missing_body() {
        let json = r#"{
            "id": 83,
            "user": { "login": "reviewer" },
            "state": "DISMISSED"
        }"#;
        let review: PrReview = serde_json::from_str(json).unwrap();
        assert_eq!(review.id, 83);
        assert_eq!(review.body, None);
    }

    #[test]
    fn test_copilot_suggested_change_review_comment_deserialization() {
        let json = r#"{
            "id": 1234567890,
            "path": "src/main.rs",
            "line": 15,
            "side": "RIGHT",
            "body": "```suggestion\nlet x = 42;\n```",
            "user": { "login": "copilot[bot]", "id": 198982749, "type": "Bot" },
            "created_at": "2024-01-15T10:30:00Z",
            "in_reply_to_id": null,
            "diff_hunk": "@@ -10,6 +10,8 @@\n context",
            "subject_type": "line",
            "start_line": null,
            "original_line": 15,
            "pull_request_review_id": 987654321
        }"#;
        let comment: PrReviewComment = serde_json::from_str(json).unwrap();
        assert_eq!(comment.id, 1234567890);
        assert_eq!(comment.path, "src/main.rs");
        assert_eq!(comment.line, Some(15));
        assert_eq!(comment.side, Some("RIGHT".to_string()));
        assert!(comment.body.contains("suggestion"));
        assert_eq!(comment.user.login, "copilot[bot]");
        assert!(comment.in_reply_to_id.is_none());
    }

    #[test]
    fn test_copilot_multiline_suggested_change_deserialization() {
        let json = r#"{
            "id": 1234567891,
            "path": "src/lib.rs",
            "line": 20,
            "side": "RIGHT",
            "body": "```suggestion\nfn new_impl() {\n    // fixed\n}\n```",
            "user": { "login": "copilot[bot]" },
            "created_at": "2024-01-15T10:35:00Z",
            "in_reply_to_id": null,
            "start_line": 15,
            "original_start_line": 15,
            "original_line": 20,
            "start_side": "RIGHT",
            "subject_type": "line"
        }"#;
        let comment: PrReviewComment = serde_json::from_str(json).unwrap();
        assert_eq!(comment.id, 1234567891);
        assert_eq!(comment.line, Some(20));
        // start_line captured in extra via serde flatten
        assert_eq!(
            comment.extra.get("start_line").and_then(|v| v.as_i64()),
            Some(15)
        );
    }
}
