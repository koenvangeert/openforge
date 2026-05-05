use std::sync::{Arc, Mutex};

use crate::backend_runtime::State;

use crate::{db, github_client::GitHubClient, github_runtime};

pub async fn fetch_authored_prs(
    db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
) -> Result<Vec<db::AuthoredPrRow>, String> {
    github_runtime::fetch_authored_prs(&db, github_client.inner()).await
}

pub async fn get_authored_prs(
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<db::AuthoredPrRow>, String> {
    github_runtime::get_authored_prs(&db)
}
