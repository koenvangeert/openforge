use futures::future::join_all;
use log::error;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::State;

use crate::{
    db,
    github_client::{
        dedupe_pr_refs, extract_authored_pr_refs_from_user_events, GitHubClient, PrRef,
        SearchPrResult,
    },
};

const AUTHORED_PRS_RECONCILE_INTERVAL_SECS: i64 = 300;

fn should_fallback_to_search(
    existing_rows: usize,
    event_refs: usize,
    uncovered_event_refs: usize,
    last_reconciled_at: Option<i64>,
    now: i64,
) -> bool {
    existing_rows == 0
        || event_refs == 0
        || uncovered_event_refs > 0
        || last_reconciled_at
            .map(|ts| now.saturating_sub(ts) >= AUTHORED_PRS_RECONCILE_INTERVAL_SECS)
            .unwrap_or(true)
}

fn key_for_pr_ref(pr_ref: &PrRef) -> String {
    format!(
        "{}/{}/{}",
        pr_ref.repo_owner, pr_ref.repo_name, pr_ref.number
    )
}

fn key_for_row(row: &db::AuthoredPrRow) -> String {
    format!("{}/{}/{}", row.repo_owner, row.repo_name, row.number)
}

async fn fetch_event_signal_prs(
    github_client: &GitHubClient,
    token: &str,
    event_refs: &[PrRef],
    existing_id_by_ref: &HashMap<String, i64>,
) -> Vec<SearchPrResult> {
    let detail_futures: Vec<_> = event_refs
        .iter()
        .filter_map(|pr_ref| {
            let id = existing_id_by_ref.get(&key_for_pr_ref(pr_ref)).copied()?;
            Some(async move { (pr_ref, id) })
        })
        .collect();

    let signal_refs = join_all(detail_futures).await;

    let fetch_futures: Vec<_> = signal_refs
        .iter()
        .map(|(pr_ref, _)| {
            github_client.get_pr_details(
                &pr_ref.repo_owner,
                &pr_ref.repo_name,
                pr_ref.number,
                token,
            )
        })
        .collect();

    let fetch_results = join_all(fetch_futures).await;

    let mut results = Vec::new();
    for ((pr_ref, existing_id), detail_result) in signal_refs.into_iter().zip(fetch_results) {
        match detail_result {
            Ok(pr_details) => {
                results.push(SearchPrResult {
                    id: existing_id,
                    number: pr_details.number,
                    title: pr_details.title,
                    body: pr_details
                        .extra
                        .get("body")
                        .and_then(|b| b.as_str())
                        .map(ToOwned::to_owned),
                    state: pr_details.state,
                    draft: pr_details.draft.unwrap_or(false),
                    html_url: pr_details.html_url,
                    user_login: pr_details.user.login,
                    user_avatar_url: pr_details
                        .user
                        .extra
                        .get("avatar_url")
                        .and_then(|v| v.as_str())
                        .map(ToOwned::to_owned),
                    repo_owner: pr_ref.repo_owner.clone(),
                    repo_name: pr_ref.repo_name.clone(),
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
                    created_at: pr_details
                        .extra
                        .get("created_at")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    updated_at: pr_details
                        .extra
                        .get("updated_at")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                });
            }
            Err(e) => {
                error!(
                    "[authored_prs] Failed to fetch PR details for {}/{} #{}: {}",
                    pr_ref.repo_owner, pr_ref.repo_name, pr_ref.number, e
                );
            }
        }
    }

    results
}

#[tauri::command]
pub async fn fetch_authored_prs(
    db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
) -> Result<Vec<db::AuthoredPrRow>, String> {
    let cached_username = {
        let db_lock = crate::db::acquire_db(&db);
        db_lock
            .get_config("github_username")
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
            db_lock
                .set_config("github_username", &u)
                .map_err(|e| format!("Failed to cache username: {}", e))?;
        }
        u
    };

    let token = crate::secure_store::get_secret("github_token")
        .map_err(|e| format!("Failed to get config: {}", e))?
        .ok_or("github_token not configured".to_string())?;

    let existing_rows = {
        let db_lock = crate::db::acquire_db(&db);
        db_lock
            .get_all_authored_prs()
            .map_err(|e| format!("Failed to read authored PR cache: {}", e))?
    };

    let last_reconciled_at = {
        let db_lock = crate::db::acquire_db(&db);
        db_lock
            .get_config("authored_prs_last_reconciled_at")
            .map_err(|e| format!("Failed to read authored PR reconcile timestamp: {}", e))?
            .and_then(|value| value.parse::<i64>().ok())
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Failed to read current time: {}", e))?
        .as_secs() as i64;

    let existing_id_by_ref: HashMap<String, i64> = existing_rows
        .iter()
        .map(|row| (key_for_row(row), row.id))
        .collect();

    let user_events = github_client
        .list_user_events(&username, &token)
        .await
        .unwrap_or_else(|e| {
            error!(
                "[authored_prs] Failed to fetch user events for {}: {}",
                username, e
            );
            Vec::new()
        });

    let event_refs = dedupe_pr_refs(extract_authored_pr_refs_from_user_events(
        &user_events,
        &username,
    ));

    let uncovered_event_refs = event_refs
        .iter()
        .filter(|pr_ref| !existing_id_by_ref.contains_key(&key_for_pr_ref(pr_ref)))
        .count();

    let should_run_search = should_fallback_to_search(
        existing_rows.len(),
        event_refs.len(),
        uncovered_event_refs,
        last_reconciled_at,
        now,
    );

    let (prs, all_search_ids, can_delete_stale) = if should_run_search {
        let (search_prs, search_ids) =
            github_client
                .search_authored_prs(&username, &token)
                .await
                .map_err(|e| format!("Failed to search authored PRs: {}", e))?;
        (search_prs, search_ids, true)
    } else {
        let event_signal_prs =
            fetch_event_signal_prs(&github_client, &token, &event_refs, &existing_id_by_ref).await;
        (event_signal_prs, Vec::new(), false)
    };

    type EnrichedPrData = (i64, Option<String>, Option<String>, Option<String>, bool);
    let mut enriched: HashMap<i64, EnrichedPrData> = HashMap::with_capacity(prs.len());

    for pr in &prs {
        let created_at = chrono::DateTime::parse_from_rfc3339(&pr.created_at)
            .map(|dt| dt.timestamp())
            .unwrap_or(0);
        let (check_runs_result, combined_status_result, reviews_result, pr_details_result) = tokio::join!(
            github_client.get_check_runs(&pr.repo_owner, &pr.repo_name, &pr.head_sha, &token),
            github_client.get_combined_status(&pr.repo_owner, &pr.repo_name, &pr.head_sha, &token),
            github_client.get_pr_reviews(&pr.repo_owner, &pr.repo_name, pr.number, &token),
            github_client.get_pr_details(&pr.repo_owner, &pr.repo_name, pr.number, &token)
        );

        let (ci_status, ci_check_runs) = match (check_runs_result, combined_status_result) {
            (Ok(check_runs), Ok(combined_status)) => {
                let status =
                    crate::github_client::aggregate_ci_status(&check_runs, &combined_status);
                let check_runs_json = serde_json::to_string(&check_runs.check_runs)
                    .unwrap_or_else(|_| "[]".to_string());
                (Some(status), Some(check_runs_json))
            }
            _ => (None, None),
        };

        let review_status = reviews_result
            .ok()
            .map(|reviews| crate::github_client::aggregate_review_status(&reviews, false, None));

        let is_queued = pr_details_result
            .ok()
            .and_then(|details| details.extra.get("merge_queue_entry").map(|v| !v.is_null()))
            .unwrap_or(false);

        enriched.insert(
            pr.id,
            (
                created_at,
                ci_status,
                ci_check_runs,
                review_status,
                is_queued,
            ),
        );
    }

    {
        let db_lock = crate::db::acquire_db(&db);
        for pr in &prs {
            let (created_at, ci_status, ci_check_runs, review_status, is_queued) = enriched
                .get(&pr.id)
                .ok_or_else(|| format!("Missing enriched data for PR {}", pr.id))?;

            let updated_at = chrono::DateTime::parse_from_rfc3339(&pr.updated_at)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);

            let task_id = db_lock
                .get_task_id_for_pr(pr.id)
                .map_err(|e| format!("Failed to get task link for PR {}: {}", pr.id, e))?;

            db_lock
                .upsert_authored_pr(
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
                    ci_status.as_deref(),
                    ci_check_runs.as_deref(),
                    review_status.as_deref(),
                    None,
                    *is_queued,
                    task_id.as_deref(),
                    *created_at,
                    updated_at,
                )
                .map_err(|e| format!("Failed to upsert authored PR: {}", e))?;
            db_lock
                .update_authored_pr_mergeability(pr.id, pr.mergeable, pr.mergeable_state.as_deref())
                .map_err(|e| format!("Failed to update authored PR mergeability: {}", e))?;
        }

        if can_delete_stale && (!all_search_ids.is_empty() || prs.is_empty()) {
            db_lock
                .delete_stale_authored_prs(&all_search_ids)
                .map_err(|e| format!("Failed to delete stale authored PRs: {}", e))?;

            db_lock
                .set_config("authored_prs_last_reconciled_at", &now.to_string())
                .map_err(|e| format!("Failed to persist authored PR reconcile timestamp: {}", e))?;
        }
    }

    let db_lock = crate::db::acquire_db(&db);
    db_lock
        .get_all_authored_prs()
        .map_err(|e| format!("Failed to get authored PRs: {}", e))
}

#[tauri::command]
pub async fn get_authored_prs(
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<db::AuthoredPrRow>, String> {
    let db_lock = crate::db::acquire_db(&db);
    db_lock
        .get_all_authored_prs()
        .map_err(|e| format!("Failed to get authored PRs: {}", e))
}

#[cfg(test)]
mod tests {
    use super::should_fallback_to_search;

    #[test]
    fn test_should_fallback_to_search_when_db_is_empty() {
        assert!(should_fallback_to_search(0, 2, 0, Some(100), 120));
    }

    #[test]
    fn test_should_fallback_to_search_when_events_are_empty() {
        assert!(should_fallback_to_search(4, 0, 0, Some(100), 120));
    }

    #[test]
    fn test_should_fallback_to_search_when_events_contain_unseeded_prs() {
        assert!(should_fallback_to_search(4, 3, 1, Some(100), 120));
    }

    #[test]
    fn test_should_not_fallback_when_db_seeded_and_events_available_recently() {
        assert!(!should_fallback_to_search(4, 2, 0, Some(100), 120));
    }

    #[test]
    fn test_should_fallback_to_search_when_reconciliation_is_stale() {
        assert!(should_fallback_to_search(4, 2, 0, Some(100), 401));
    }

    #[test]
    fn test_should_fallback_to_search_when_reconciliation_timestamp_missing() {
        assert!(should_fallback_to_search(4, 2, 0, None, 120));
    }
}
