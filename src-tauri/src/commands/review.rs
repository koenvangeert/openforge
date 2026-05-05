use crate::backend_runtime::State;
use crate::{db, github_client::GitHubClient, github_runtime};
use std::sync::{Arc, Mutex};

pub use crate::github_runtime::{FrontendPrOverviewComment, FrontendReviewComment};

pub async fn get_github_username(
    db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
) -> Result<String, String> {
    github_runtime::github_username(&db, github_client.inner()).await
}

pub async fn fetch_review_prs(
    db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
) -> Result<Vec<db::ReviewPrRow>, String> {
    github_runtime::fetch_review_prs(&db, github_client.inner()).await
}

pub async fn get_review_prs(
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<db::ReviewPrRow>, String> {
    github_runtime::get_review_prs(&db)
}

pub async fn get_pr_file_diffs(
    _db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    pr_number: i64,
) -> Result<Vec<crate::github_client::PrFileDiff>, String> {
    github_runtime::get_pr_file_diffs(github_client.inner(), &owner, &repo, pr_number).await
}

pub async fn get_file_content(
    _db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    sha: String,
) -> Result<String, String> {
    github_runtime::get_file_content(github_client.inner(), &owner, &repo, &sha).await
}

pub async fn get_file_content_base64(
    _db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    sha: String,
) -> Result<String, String> {
    github_runtime::get_file_content_base64(github_client.inner(), &owner, &repo, &sha).await
}

pub async fn get_file_at_ref(
    _db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    path: String,
    ref_sha: String,
) -> Result<String, String> {
    github_runtime::get_file_at_ref(github_client.inner(), &owner, &repo, &path, &ref_sha).await
}

pub async fn get_file_at_ref_base64(
    _db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    path: String,
    ref_sha: String,
) -> Result<String, String> {
    github_runtime::get_file_at_ref_base64(github_client.inner(), &owner, &repo, &path, &ref_sha)
        .await
}

pub async fn get_review_comments(
    _db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    pr_number: i64,
) -> Result<Vec<FrontendReviewComment>, String> {
    github_runtime::get_review_comments(github_client.inner(), &owner, &repo, pr_number).await
}

pub async fn get_pr_overview_comments(
    _db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    pr_number: i64,
) -> Result<Vec<FrontendPrOverviewComment>, String> {
    github_runtime::get_pr_overview_comments(github_client.inner(), &owner, &repo, pr_number).await
}

#[allow(clippy::too_many_arguments)]
pub async fn submit_pr_review(
    _db: State<'_, Arc<Mutex<db::Database>>>,
    github_client: State<'_, GitHubClient>,
    owner: String,
    repo: String,
    pr_number: i64,
    event: String,
    body: String,
    comments: Vec<crate::github_client::ReviewSubmitComment>,
    commit_id: String,
) -> Result<(), String> {
    github_runtime::submit_pr_review(
        github_client.inner(),
        &owner,
        &repo,
        pr_number,
        &event,
        &body,
        comments,
        &commit_id,
    )
    .await
}

pub async fn mark_review_pr_viewed(
    db: State<'_, Arc<Mutex<db::Database>>>,
    pr_id: i64,
    head_sha: String,
) -> Result<(), String> {
    github_runtime::mark_review_pr_viewed(&db, pr_id, &head_sha)
}
