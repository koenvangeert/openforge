use std::sync::{Arc, Mutex};

use tauri::State;

use crate::{db, github_client::GitHubClient, github_runtime};

#[tauri::command]
pub async fn fetch_authored_prs(
    db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
) -> Result<Vec<db::AuthoredPrRow>, String> {
    github_runtime::fetch_authored_prs(&db, github_client.inner()).await
}

#[tauri::command]
pub async fn get_authored_prs(
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<db::AuthoredPrRow>, String> {
    github_runtime::get_authored_prs(&db)
}
