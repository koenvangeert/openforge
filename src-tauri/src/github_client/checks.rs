use std::collections::HashMap;

use log::warn;

use super::error::GitHubError;
use super::types::*;
use super::GitHubClient;

impl GitHubClient {
    /// Get all check runs for a commit (paginated)
    ///
    /// Fetches all pages of check runs to ensure none are missed.
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

        let (first_etag, first_page_response) =
            match self.conditional_get(&first_page_url, token).await? {
                super::ConditionalResponse::NotModified(Some(cached_body)) => {
                    let result: CheckRunsResponse = serde_json::from_str(&cached_body)
                        .map_err(|e| GitHubError::ParseError(e.to_string()))?;
                    return Ok(result);
                }
                super::ConditionalResponse::NotModified(None) => {
                    return Err(GitHubError::ParseError(
                        "Received 304 but no cached response found".to_string(),
                    ));
                }
                super::ConditionalResponse::Fresh(response) => {
                    if !response.status().is_success() {
                        return Err(Self::api_error_from_response(response).await);
                    }

                    let first_etag = response
                        .headers()
                        .get("etag")
                        .and_then(|v| v.to_str().ok())
                        .map(String::from);

                    let body = response
                        .text()
                        .await
                        .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

                    let first_page_response: CheckRunsResponse = serde_json::from_str(&body)
                        .map_err(|e| GitHubError::ParseError(e.to_string()))?;

                    (first_etag, first_page_response)
                }
            };

        let total_count = first_page_response.total_count;
        let mut all_check_runs: Vec<CheckRun> = first_page_response.check_runs;
        let mut page = 2u32;

        while all_check_runs.len() < total_count && page <= 10 {
            let url = format!(
                "https://api.github.com/repos/{}/{}/commits/{}/check-runs?per_page={}&page={}",
                owner, repo, sha, per_page, page
            );

            let response = self.send_github(self.github_get(&url, token)).await?;

            if !response.status().is_success() {
                return Err(Self::api_error_from_response(response).await);
            }

            let page_response: CheckRunsResponse = response
                .json()
                .await
                .map_err(|e| GitHubError::ParseError(e.to_string()))?;

            all_check_runs.extend(page_response.check_runs);

            if page == 10 && all_check_runs.len() < total_count {
                warn!(
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

        let body =
            serde_json::to_string(&result).map_err(|e| GitHubError::ParseError(e.to_string()))?;
        self.cache_response_body(&first_page_url, first_etag, &body);

        Ok(result)
    }

    /// Get combined status for a commit (paginated)
    ///
    /// Fetches all pages of commit statuses to ensure none are missed.
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

        let (first_etag, first_page_response) =
            match self.conditional_get(&first_page_url, token).await? {
                super::ConditionalResponse::NotModified(Some(cached_body)) => {
                    let result: CombinedStatusResponse = serde_json::from_str(&cached_body)
                        .map_err(|e| GitHubError::ParseError(e.to_string()))?;
                    return Ok(result);
                }
                super::ConditionalResponse::NotModified(None) => {
                    return Err(GitHubError::ParseError(
                        "Received 304 but no cached response found".to_string(),
                    ));
                }
                super::ConditionalResponse::Fresh(response) => {
                    if !response.status().is_success() {
                        return Err(Self::api_error_from_response(response).await);
                    }

                    let first_etag = response
                        .headers()
                        .get("etag")
                        .and_then(|v| v.to_str().ok())
                        .map(String::from);

                    let body = response
                        .text()
                        .await
                        .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

                    let first_page_response: CombinedStatusResponse =
                        serde_json::from_str(&body)
                            .map_err(|e| GitHubError::ParseError(e.to_string()))?;

                    (first_etag, first_page_response)
                }
            };

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

            let response = self.send_github(self.github_get(&url, token)).await?;

            if !response.status().is_success() {
                return Err(Self::api_error_from_response(response).await);
            }

            let page_response: CombinedStatusResponse = response
                .json()
                .await
                .map_err(|e| GitHubError::ParseError(e.to_string()))?;

            all_statuses.extend(page_response.statuses);

            if page == 10 && all_statuses.len() < total_count {
                warn!(
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

        let body =
            serde_json::to_string(&result).map_err(|e| GitHubError::ParseError(e.to_string()))?;
        self.cache_response_body(&first_page_url, first_etag, &body);

        Ok(result)
    }

    /// Get required status checks for a branch from branch protection rules
    ///
    /// Returns an empty list if no branch protection is configured or if the
    /// API call fails (graceful degradation).
    pub async fn get_required_status_checks(
        &self,
        owner: &str,
        repo: &str,
        branch: &str,
        token: &str,
    ) -> Vec<String> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/branches/{}/protection/required_status_checks",
            owner, repo, branch
        );

        let response = match self
            .send_github(self.apply_cached_etag(self.github_get(&url, token), &url))
            .await
        {
            Ok(response) => response,
            Err(e) => {
                warn!(
                    "[GitHub] Failed to fetch required status checks for {}/{} branch {}: {}",
                    owner, repo, branch, e
                );
                return vec![];
            }
        };

        // 404 = no branch protection or no required checks configured
        // 403 = insufficient permissions
        if response.status() == reqwest::StatusCode::NOT_FOUND
            || response.status() == reqwest::StatusCode::FORBIDDEN
        {
            return vec![];
        }

        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            if let Some(cached_body) = self.cached_body_for_url(&url) {
                if let Ok(result) =
                    serde_json::from_str::<RequiredStatusChecksResponse>(&cached_body)
                {
                    return result.into_context_names();
                }
            }
            return vec![];
        }

        if !response.status().is_success() {
            warn!(
                "[GitHub] Unexpected status {} fetching required checks for {}/{} branch {}",
                response.status(),
                owner,
                repo,
                branch
            );
            return vec![];
        }

        let etag = response
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .map(String::from);

        let body = match response.text().await {
            Ok(b) => b,
            Err(_) => return vec![],
        };

        self.cache_response_body(&url, etag, &body);

        match serde_json::from_str::<RequiredStatusChecksResponse>(&body) {
            Ok(result) => result.into_context_names(),
            Err(e) => {
                warn!(
                    "[GitHub] Failed to parse required status checks for {}/{} branch {}: {}",
                    owner, repo, branch, e
                );
                vec![]
            }
        }
    }
}

/// Aggregate CI status from check runs and commit status
///
/// Determines the overall CI status by examining both check runs and commit statuses.
/// Returns one of: "none", "pending", "success", or "failure".
pub fn aggregate_ci_status(
    check_runs: &CheckRunsResponse,
    commit_status: &CombinedStatusResponse,
) -> String {
    if check_runs.check_runs.is_empty() && commit_status.statuses.is_empty() {
        return "none".to_string();
    }

    // Check for any in-progress or pending checks FIRST.
    // If anything is still running, report "pending" even if some checks
    // have already failed. This prevents red flash while CI is still in progress.
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

    // All checks completed — now check for failures
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

    "success".to_string()
}

/// Deduplicate check runs by name, keeping only the latest run for each name.
///
/// When a GitHub Actions workflow is rerun, new check run entries are created
/// but old ones from previous attempts remain in the API response. This function
/// retains only the most recent run per name (highest ID).
pub fn deduplicate_check_runs(response: &CheckRunsResponse) -> CheckRunsResponse {
    let mut latest_by_name: HashMap<&str, &CheckRun> = HashMap::new();

    for run in &response.check_runs {
        let entry = latest_by_name.entry(&run.name).or_insert(run);
        if run.id > entry.id {
            *entry = run;
        }
    }

    let deduped: Vec<CheckRun> = latest_by_name.into_values().cloned().collect();

    CheckRunsResponse {
        total_count: deduped.len(),
        check_runs: deduped,
    }
}

/// Filter check runs and commit statuses to only include required checks
///
/// When branch protection rules specify required status checks, this function
/// filters the full set of check runs and commit statuses to only include those
/// that match the required check context names.
pub fn filter_to_required(
    check_runs: &CheckRunsResponse,
    combined_status: &CombinedStatusResponse,
    required_names: &[String],
) -> (CheckRunsResponse, CombinedStatusResponse) {
    let filtered_runs: Vec<CheckRun> = check_runs
        .check_runs
        .iter()
        .filter(|cr| required_names.iter().any(|name| name == &cr.name))
        .cloned()
        .collect();

    let filtered_statuses: Vec<CommitStatusEntry> = combined_status
        .statuses
        .iter()
        .filter(|s| required_names.iter().any(|name| name == &s.context))
        .cloned()
        .collect();

    // Recompute the combined state based on only the required statuses
    let filtered_state = if filtered_statuses.is_empty() {
        combined_status.state.clone()
    } else if filtered_statuses
        .iter()
        .any(|s| s.state == "failure" || s.state == "error")
    {
        "failure".to_string()
    } else if filtered_statuses.iter().any(|s| s.state == "pending") {
        "pending".to_string()
    } else {
        "success".to_string()
    };

    (
        CheckRunsResponse {
            total_count: filtered_runs.len(),
            check_runs: filtered_runs,
        },
        CombinedStatusResponse {
            state: filtered_state,
            statuses: filtered_statuses,
            sha: combined_status.sha.clone(),
            total_count: 0,
            extra: combined_status.extra.clone(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_check_runs(runs: Vec<(&str, &str, Option<&str>)>) -> CheckRunsResponse {
        CheckRunsResponse {
            total_count: runs.len(),
            check_runs: runs
                .into_iter()
                .map(|(name, status, conclusion)| CheckRun {
                    id: 1,
                    name: name.to_string(),
                    status: status.to_string(),
                    conclusion: conclusion.map(|c| c.to_string()),
                    html_url: "https://example.com".to_string(),
                })
                .collect(),
        }
    }

    fn make_combined(state: &str, statuses: Vec<&str>) -> CombinedStatusResponse {
        CombinedStatusResponse {
            state: state.to_string(),
            statuses: statuses
                .into_iter()
                .map(|s| CommitStatusEntry {
                    state: s.to_string(),
                    context: "ci".to_string(),
                    description: None,
                    target_url: None,
                })
                .collect(),
            sha: "abc".to_string(),
            total_count: 0,
            extra: serde_json::Value::Object(serde_json::Map::new()),
        }
    }

    fn make_combined_with_contexts(
        state: &str,
        statuses: Vec<(&str, &str)>,
    ) -> CombinedStatusResponse {
        CombinedStatusResponse {
            state: state.to_string(),
            statuses: statuses
                .into_iter()
                .map(|(state, context)| CommitStatusEntry {
                    state: state.to_string(),
                    context: context.to_string(),
                    description: None,
                    target_url: None,
                })
                .collect(),
            sha: "abc123".to_string(),
            total_count: 0,
            extra: serde_json::Value::Object(serde_json::Map::new()),
        }
    }

    fn make_check_run(id: i64, name: &str, status: &str, conclusion: Option<&str>) -> CheckRun {
        CheckRun {
            id,
            name: name.to_string(),
            status: status.to_string(),
            conclusion: conclusion.map(|c| c.to_string()),
            html_url: format!("https://github.com/owner/repo/runs/{}", id),
        }
    }

    // ========================================================================
    // aggregate_ci_status tests
    // ========================================================================

    #[test]
    fn test_aggregate_ci_status() {
        let empty_runs = make_check_runs(vec![]);
        let empty_combined = make_combined("pending", vec![]);

        assert_eq!(aggregate_ci_status(&empty_runs, &empty_combined), "none");

        let success_runs = make_check_runs(vec![
            ("build", "completed", Some("success")),
            ("test", "completed", Some("success")),
        ]);
        let success_combined = make_combined("success", vec!["success"]);
        assert_eq!(
            aggregate_ci_status(&success_runs, &success_combined),
            "success"
        );

        let failure_runs = make_check_runs(vec![
            ("build", "completed", Some("failure")),
            ("test", "completed", Some("success")),
        ]);
        assert_eq!(
            aggregate_ci_status(&failure_runs, &empty_combined),
            "failure"
        );

        let timed_out_runs = make_check_runs(vec![("build", "completed", Some("timed_out"))]);
        assert_eq!(
            aggregate_ci_status(&timed_out_runs, &empty_combined),
            "failure"
        );

        let cancelled_runs = make_check_runs(vec![("build", "completed", Some("cancelled"))]);
        assert_eq!(
            aggregate_ci_status(&cancelled_runs, &empty_combined),
            "success"
        );

        let action_required_runs =
            make_check_runs(vec![("build", "completed", Some("action_required"))]);
        assert_eq!(
            aggregate_ci_status(&action_required_runs, &empty_combined),
            "pending"
        );

        let failure_combined = make_combined("failure", vec!["failure"]);
        assert_eq!(
            aggregate_ci_status(&empty_runs, &failure_combined),
            "failure"
        );

        let error_combined = make_combined("error", vec!["error"]);
        assert_eq!(aggregate_ci_status(&empty_runs, &error_combined), "failure");

        let pending_runs = make_check_runs(vec![
            ("build", "in_progress", None),
            ("test", "completed", Some("success")),
        ]);
        assert_eq!(
            aggregate_ci_status(&pending_runs, &empty_combined),
            "pending"
        );

        let pending_combined = make_combined("pending", vec!["pending"]);
        assert_eq!(
            aggregate_ci_status(&empty_runs, &pending_combined),
            "pending"
        );

        let neutral_runs = make_check_runs(vec![
            ("build", "completed", Some("neutral")),
            ("lint", "completed", Some("skipped")),
        ]);
        assert_eq!(
            aggregate_ci_status(&neutral_runs, &empty_combined),
            "success"
        );

        let null_conclusion_runs = make_check_runs(vec![("build", "completed", None)]);
        assert_eq!(
            aggregate_ci_status(&null_conclusion_runs, &empty_combined),
            "success"
        );

        let mixed_failure_pending = make_check_runs(vec![
            ("build", "completed", Some("failure")),
            ("test", "in_progress", None),
        ]);
        assert_eq!(
            aggregate_ci_status(&mixed_failure_pending, &empty_combined),
            "pending"
        );

        let all_done_failure_runs = make_check_runs(vec![("build", "completed", Some("failure"))]);
        let pending_combined_with_statuses = make_combined("pending", vec!["pending"]);
        assert_eq!(
            aggregate_ci_status(&all_done_failure_runs, &pending_combined_with_statuses),
            "pending"
        );
    }

    // ========================================================================
    // filter_to_required tests
    // ========================================================================

    #[test]
    fn test_filter_to_required_filters_by_name() {
        let check_runs = make_check_runs(vec![
            ("build", "completed", Some("success")),
            ("test", "completed", Some("failure")),
            ("lint", "completed", Some("success")),
        ]);
        let combined = make_combined_with_contexts(
            "success",
            vec![("success", "ci/deploy"), ("failure", "ci/security")],
        );
        let required = vec!["build".to_string(), "ci/security".to_string()];

        let (filtered_runs, filtered_combined) =
            filter_to_required(&check_runs, &combined, &required);

        assert_eq!(filtered_runs.check_runs.len(), 1);
        assert_eq!(filtered_runs.check_runs[0].name, "build");
        assert_eq!(filtered_runs.total_count, 1);
        assert_eq!(filtered_combined.statuses.len(), 1);
        assert_eq!(filtered_combined.statuses[0].context, "ci/security");
        assert_eq!(filtered_combined.state, "failure");
    }

    #[test]
    fn test_filter_to_required_empty_required_list() {
        let check_runs = make_check_runs(vec![
            ("build", "completed", Some("success")),
            ("test", "completed", Some("success")),
        ]);
        let combined = make_combined_with_contexts("success", vec![("success", "ci/deploy")]);
        let required: Vec<String> = vec![];

        let (filtered_runs, filtered_combined) =
            filter_to_required(&check_runs, &combined, &required);

        assert!(filtered_runs.check_runs.is_empty());
        assert_eq!(filtered_runs.total_count, 0);
        assert!(filtered_combined.statuses.is_empty());
    }

    #[test]
    fn test_filter_to_required_partial_match() {
        let check_runs = make_check_runs(vec![
            ("build", "completed", Some("success")),
            ("test", "in_progress", None),
        ]);
        let combined = make_combined_with_contexts("pending", vec![]);
        let required = vec!["build".to_string(), "deploy".to_string()];

        let (filtered_runs, filtered_combined) =
            filter_to_required(&check_runs, &combined, &required);

        assert_eq!(filtered_runs.check_runs.len(), 1);
        assert_eq!(filtered_runs.check_runs[0].name, "build");
        assert!(filtered_combined.statuses.is_empty());
    }

    #[test]
    fn test_filter_to_required_recomputes_combined_state() {
        let check_runs = make_check_runs(vec![]);
        let combined = make_combined_with_contexts(
            "failure",
            vec![("success", "required-check"), ("failure", "optional-check")],
        );
        let required = vec!["required-check".to_string()];

        let (_, filtered_combined) = filter_to_required(&check_runs, &combined, &required);

        assert_eq!(filtered_combined.statuses.len(), 1);
        assert_eq!(filtered_combined.state, "success");
    }

    #[test]
    fn test_filter_to_required_preserves_sha() {
        let check_runs = make_check_runs(vec![]);
        let combined = make_combined_with_contexts("success", vec![]);
        let required = vec!["build".to_string()];

        let (_, filtered_combined) = filter_to_required(&check_runs, &combined, &required);

        assert_eq!(filtered_combined.sha, "abc123");
    }

    // ========================================================================
    // deduplicate_check_runs tests
    // ========================================================================

    #[test]
    fn test_deduplicate_check_runs_removes_older_duplicates() {
        let response = CheckRunsResponse {
            total_count: 4,
            check_runs: vec![
                make_check_run(100, "preliminary-checks", "completed", Some("failure")),
                make_check_run(200, "build", "completed", Some("success")),
                make_check_run(300, "preliminary-checks", "completed", Some("success")),
                make_check_run(400, "preliminary-checks", "completed", Some("success")),
            ],
        };

        let deduped = deduplicate_check_runs(&response);
        assert_eq!(deduped.total_count, 2);
        assert_eq!(deduped.check_runs.len(), 2);
        let prelim = deduped
            .check_runs
            .iter()
            .find(|r| r.name == "preliminary-checks")
            .unwrap();
        assert_eq!(prelim.id, 400, "should keep the newest run (highest ID)");
        assert_eq!(prelim.conclusion.as_deref(), Some("success"));
        let build = deduped
            .check_runs
            .iter()
            .find(|r| r.name == "build")
            .unwrap();
        assert_eq!(build.id, 200);
    }

    #[test]
    fn test_deduplicate_check_runs_no_duplicates() {
        let response = CheckRunsResponse {
            total_count: 2,
            check_runs: vec![
                make_check_run(100, "build", "completed", Some("success")),
                make_check_run(200, "test", "completed", Some("success")),
            ],
        };

        let deduped = deduplicate_check_runs(&response);
        assert_eq!(deduped.total_count, 2);
        assert_eq!(deduped.check_runs.len(), 2);
    }

    #[test]
    fn test_deduplicate_check_runs_empty() {
        let response = CheckRunsResponse {
            total_count: 0,
            check_runs: vec![],
        };

        let deduped = deduplicate_check_runs(&response);
        assert_eq!(deduped.total_count, 0);
        assert_eq!(deduped.check_runs.len(), 0);
    }

    #[test]
    fn test_deduplicate_check_runs_keeps_latest_status() {
        let response = CheckRunsResponse {
            total_count: 2,
            check_runs: vec![
                make_check_run(100, "ci", "completed", Some("failure")),
                make_check_run(500, "ci", "in_progress", None),
            ],
        };

        let deduped = deduplicate_check_runs(&response);
        assert_eq!(deduped.total_count, 1);
        let ci = &deduped.check_runs[0];
        assert_eq!(ci.id, 500);
        assert_eq!(ci.status, "in_progress");
        assert_eq!(
            ci.conclusion, None,
            "in-progress run should have no conclusion"
        );
    }
}
