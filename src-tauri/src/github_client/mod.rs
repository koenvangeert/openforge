//! GitHub REST API Client
//!
//! Type-safe Rust client for interacting with GitHub REST API v3.
//! Provides functions for fetching PR details, fetching PR comments (both review
//! and general comments), posting comments, and checking PR status.
//!
//! ## Module Structure
//! - `types` — Request/response type definitions
//! - `error` — Error types
//! - `pulls` — Pull request operations (details, comments, files, search)
//! - `checks` — CI check runs and commit status operations
//! - `reviews` — PR review operations
//!
//! ## Authentication
//! Uses Personal Access Token (PAT) in Authorization header
//! Authorization header format: `token {personal_access_token}`

mod checks;
pub mod error;
mod events;
mod pulls;
mod reviews;
pub mod types;

pub use checks::{aggregate_ci_status, deduplicate_check_runs, filter_to_required};
pub use error::GitHubError;
pub use events::{
    dedupe_pr_refs, extract_authored_pr_refs_from_user_events, parse_repo_event_changes,
};
pub use reviews::aggregate_review_status;
pub use types::*;

use reqwest::{header::HeaderMap, Client, RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Cached HTTP response with ETag for conditional requests
#[derive(Clone)]
struct CachedResponse {
    etag: String,
    body: String,
}

enum ConditionalResponse {
    NotModified(Option<String>),
    Fresh(Response),
}

/// GitHub API client
#[derive(Clone)]
pub struct GitHubClient {
    client: Client,
    etag_cache: Arc<Mutex<HashMap<String, CachedResponse>>>,
    last_rate_limit_reset: Arc<Mutex<Option<i64>>>,
}

impl GitHubClient {
    /// Create a new GitHub client
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            etag_cache: Arc::new(Mutex::new(HashMap::new())),
            last_rate_limit_reset: Arc::new(Mutex::new(None)),
        }
    }

    /// Get the last rate limit reset timestamp, if a rate limit was hit.
    pub fn get_last_rate_limit_reset(&self) -> Option<i64> {
        *self.last_rate_limit_reset.lock().unwrap()
    }

    /// Clear the stored rate limit reset timestamp.
    /// Call at the start of each poll cycle so stale values don't persist.
    pub fn clear_rate_limit_reset(&self) {
        *self.last_rate_limit_reset.lock().unwrap() = None;
    }

    #[cfg(test)]
    pub(crate) fn shares_cache_with(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.etag_cache, &other.etag_cache)
            && Arc::ptr_eq(&self.last_rate_limit_reset, &other.last_rate_limit_reset)
    }

    fn github_get(&self, url: &str, token: &str) -> reqwest::RequestBuilder {
        self.client
            .get(url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "openforge")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2026-03-10")
    }

    fn cached_etag_for_url(&self, url: &str) -> Option<String> {
        self.etag_cache
            .lock()
            .unwrap()
            .get(url)
            .map(|cached| cached.etag.clone())
    }

    fn cached_body_for_url(&self, url: &str) -> Option<String> {
        self.etag_cache
            .lock()
            .unwrap()
            .get(url)
            .map(|cached| cached.body.clone())
    }

    fn apply_cached_etag(&self, req: RequestBuilder, url: &str) -> RequestBuilder {
        if let Some(etag) = self.cached_etag_for_url(url) {
            req.header("If-None-Match", etag)
        } else {
            req
        }
    }

    fn cache_response_body(&self, url: &str, etag: Option<String>, body: &str) {
        if let Some(etag_value) = etag {
            self.etag_cache.lock().unwrap().insert(
                url.to_string(),
                CachedResponse {
                    etag: etag_value,
                    body: body.to_string(),
                },
            );
        }
    }

    fn capture_rate_limit_reset_from_headers(&self, status: StatusCode, headers: &HeaderMap) {
        if status != StatusCode::FORBIDDEN && status != StatusCode::TOO_MANY_REQUESTS {
            return;
        }

        if let Some(reset_val) = headers
            .get("x-ratelimit-reset")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<i64>().ok())
        {
            *self.last_rate_limit_reset.lock().unwrap() = Some(reset_val);
        }
    }

    async fn send_github(&self, req: RequestBuilder) -> Result<Response, GitHubError> {
        let response = req
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        self.capture_rate_limit_reset_from_headers(response.status(), response.headers());

        Ok(response)
    }

    async fn conditional_get(
        &self,
        url: &str,
        token: &str,
    ) -> Result<ConditionalResponse, GitHubError> {
        let response = self
            .send_github(self.apply_cached_etag(self.github_get(url, token), url))
            .await?;

        if response.status() == StatusCode::NOT_MODIFIED {
            return Ok(ConditionalResponse::NotModified(
                self.cached_body_for_url(url),
            ));
        }

        Ok(ConditionalResponse::Fresh(response))
    }

    async fn api_error_from_response(response: Response) -> GitHubError {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unable to read response body".to_string());

        GitHubError::ApiError {
            status: status.as_u16(),
            message: body,
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
        match self.conditional_get(url, token).await? {
            ConditionalResponse::NotModified(Some(cached_body)) => {
                serde_json::from_str(&cached_body)
                    .map_err(|e| GitHubError::ParseError(e.to_string()))
            }
            ConditionalResponse::NotModified(None) => Err(GitHubError::ParseError(
                "Received 304 but no cached response found".to_string(),
            )),
            ConditionalResponse::Fresh(response) => {
                if !response.status().is_success() {
                    return Err(Self::api_error_from_response(response).await);
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

                let result: T = serde_json::from_str(&body)
                    .map_err(|e| GitHubError::ParseError(e.to_string()))?;

                self.cache_response_body(url, etag, &body);

                Ok(result)
            }
        }
    }

    /// Get authenticated user's login
    pub async fn get_authenticated_user(&self, token: &str) -> Result<String, GitHubError> {
        let url = "https://api.github.com/user";

        let response = self.send_github(self.github_get(url, token)).await?;

        if !response.status().is_success() {
            return Err(Self::api_error_from_response(response).await);
        }

        let user: AuthenticatedUser = response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;

        Ok(user.login)
    }
}

impl Default for GitHubClient {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderValue, IF_NONE_MATCH};

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
    fn test_last_rate_limit_reset_initialized_none() {
        let client = GitHubClient::new();
        let reset = client.last_rate_limit_reset.lock().unwrap();
        assert!(reset.is_none());
    }

    #[test]
    fn test_get_last_rate_limit_reset_returns_none_initially() {
        let client = GitHubClient::new();
        assert_eq!(client.get_last_rate_limit_reset(), None);
    }

    #[test]
    fn test_cloned_clients_share_etag_cache() {
        let client1 = GitHubClient::new();
        let client2 = client1.clone();

        assert!(client1.shares_cache_with(&client2));
        assert!(client2.shares_cache_with(&client1));
    }

    #[test]
    fn test_cloned_clients_share_rate_limit_state() {
        let client1 = GitHubClient::new();
        let client2 = client1.clone();

        *client1.last_rate_limit_reset.lock().unwrap() = Some(12345);
        assert_eq!(client2.get_last_rate_limit_reset(), Some(12345));

        client2.clear_rate_limit_reset();
        assert_eq!(client1.get_last_rate_limit_reset(), None);
    }

    #[test]
    fn test_cloned_client_mutation_persists_across_clones() {
        let client_original = GitHubClient::new();
        let client_clone = client_original.clone();

        *client_clone.last_rate_limit_reset.lock().unwrap() = Some(99999);
        assert_eq!(client_original.get_last_rate_limit_reset(), Some(99999));

        client_original.clear_rate_limit_reset();
        assert_eq!(client_clone.get_last_rate_limit_reset(), None);
    }

    #[test]
    fn test_apply_cached_etag_sets_if_none_match_header() {
        let client = GitHubClient::new();
        client.etag_cache.lock().unwrap().insert(
            "https://example.com/resource".to_string(),
            CachedResponse {
                etag: "W/\"etag-123\"".to_string(),
                body: "{}".to_string(),
            },
        );

        let request = client
            .apply_cached_etag(
                client.github_get("https://example.com/resource", "token"),
                "https://example.com/resource",
            )
            .build()
            .expect("request should build");

        assert_eq!(
            request.headers().get(IF_NONE_MATCH),
            Some(&HeaderValue::from_static("W/\"etag-123\""))
        );
    }

    #[test]
    fn test_apply_cached_etag_leaves_header_absent_when_cache_missing() {
        let client = GitHubClient::new();

        let request = client
            .apply_cached_etag(
                client.github_get("https://example.com/resource", "token"),
                "https://example.com/resource",
            )
            .build()
            .expect("request should build");

        assert!(request.headers().get(IF_NONE_MATCH).is_none());
    }

    #[test]
    fn test_cache_response_body_stores_body_when_etag_present() {
        let client = GitHubClient::new();

        client.cache_response_body(
            "https://example.com/resource",
            Some("W/\"etag-123\"".to_string()),
            "{\"ok\":true}",
        );

        let cached = client
            .etag_cache
            .lock()
            .unwrap()
            .get("https://example.com/resource")
            .cloned()
            .expect("response should be cached");

        assert_eq!(cached.etag, "W/\"etag-123\"");
        assert_eq!(cached.body, "{\"ok\":true}");
    }

    #[test]
    fn test_cache_response_body_skips_cache_when_etag_missing() {
        let client = GitHubClient::new();

        client.cache_response_body("https://example.com/resource", None, "{\"ok\":true}");

        assert!(client.etag_cache.lock().unwrap().is_empty());
    }

    #[test]
    fn test_capture_rate_limit_reset_stores_value_for_rate_limit_status() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert("x-ratelimit-reset", HeaderValue::from_static("12345"));

        client.capture_rate_limit_reset_from_headers(reqwest::StatusCode::FORBIDDEN, &headers);

        assert_eq!(client.get_last_rate_limit_reset(), Some(12345));
    }

    #[test]
    fn test_capture_rate_limit_reset_ignores_non_rate_limit_status() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert("x-ratelimit-reset", HeaderValue::from_static("12345"));

        client.capture_rate_limit_reset_from_headers(reqwest::StatusCode::OK, &headers);

        assert_eq!(client.get_last_rate_limit_reset(), None);
    }

    #[test]
    fn test_capture_rate_limit_reset_ignores_invalid_header_value() {
        let client = GitHubClient::new();
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-ratelimit-reset",
            HeaderValue::from_static("not-a-number"),
        );

        client.capture_rate_limit_reset_from_headers(
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            &headers,
        );

        assert_eq!(client.get_last_rate_limit_reset(), None);
    }
}
