use std::sync::{Arc, Mutex};
use std::collections::HashMap;

use tauri::State;

use crate::{db, github_client::GitHubClient};

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

    let (prs, search_item_count) = github_client
        .search_authored_prs(&username, &token)
        .await
        .map_err(|e| format!("Failed to search authored PRs: {}", e))?;

    let current_ids: Vec<i64> = prs.iter().map(|pr| pr.id).collect();

    type EnrichedPrData = (i64, Option<String>, Option<String>, Option<String>, bool);
    let mut enriched: HashMap<i64, EnrichedPrData> =
        HashMap::with_capacity(prs.len());

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
                let status = crate::github_client::aggregate_ci_status(&check_runs, &combined_status);
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
            (created_at, ci_status, ci_check_runs, review_status, is_queued),
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
        }

        if prs.len() >= search_item_count {
            db_lock
                .delete_stale_authored_prs(&current_ids)
                .map_err(|e| format!("Failed to delete stale authored PRs: {}", e))?;
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
