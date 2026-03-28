use crate::{db, jira_client::JiraClient};
use log::error;
use std::sync::{Arc, Mutex};
use tauri::State;

#[tauri::command]
pub async fn refresh_jira_info(
    db: State<'_, Arc<Mutex<db::Database>>>,

    jira_client: State<'_, JiraClient>,
) -> Result<usize, String> {
    let jira_api_token = crate::secure_store::get_secret("jira_api_token")
        .map_err(|e| e.to_string())?
        .ok_or("jira_api_token not configured".to_string())?;
    let (jira_base_url, jira_username) = {
        let db_lock = crate::db::acquire_db(&db);
        let base = db_lock
            .get_config("jira_base_url")
            .map_err(|e| format!("{}", e))?
            .ok_or("jira_base_url not configured")?;
        let user = db_lock
            .get_config("jira_username")
            .map_err(|e| format!("{}", e))?
            .ok_or("jira_username not configured")?;
        (base, user)
    };

    let jira_keys: Vec<String> = {
        let db_lock = crate::db::acquire_db(&db);
        db_lock
            .get_tasks_with_jira_links()
            .map_err(|e| format!("Failed to get linked tasks: {}", e))?
            .into_iter()
            .filter_map(|t| t.jira_key)
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect()
    };

    if jira_keys.is_empty() {
        return Ok(0);
    }

    let jql = format!("key IN ({}) ORDER BY updated DESC", jira_keys.join(","));
    let issues = jira_client
        .search_issues(&jira_base_url, &jira_username, &jira_api_token, &jql)
        .await
        .map_err(|e| format!("Failed to fetch JIRA issues: {}", e))?;

    let mut updated = 0;
    for issue in issues {
        let jira_title = issue.fields.summary.clone();
        let jira_status = issue
            .fields
            .status
            .as_ref()
            .map(|s| s.name.clone())
            .unwrap_or_default();
        let assignee = issue
            .fields
            .assignee
            .as_ref()
            .map(|u| u.display_name.clone())
            .unwrap_or_default();
        let jira_description = issue
            .rendered_fields
            .as_ref()
            .and_then(|rf| rf.description.clone())
            .unwrap_or_default();
        let db_lock = crate::db::acquire_db(&db);
        match db_lock.update_task_jira_info(
            &issue.key,
            &jira_title,
            &jira_status,
            &assignee,
            &jira_description,
        ) {
            Ok(count) => updated += count,
            Err(e) => error!("Failed to update JIRA info for {}: {}", issue.key, e),
        }
        drop(db_lock);
    }
    Ok(updated)
}
