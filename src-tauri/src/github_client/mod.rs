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

pub mod error;
pub mod types;
mod pulls;
mod checks;
mod reviews;

pub use error::GitHubError;
pub use types::*;
pub use checks::{aggregate_ci_status, deduplicate_check_runs, filter_to_required};
pub use reviews::aggregate_review_status;

use reqwest::Client;
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Cached HTTP response with ETag for conditional requests
struct CachedResponse {
    etag: String,
    body: String,
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
        let cached_etag = {
            self.etag_cache
                .lock()
                .unwrap()
                .get(url)
                .map(|c| c.etag.clone())
        };

        let mut req = self
            .client
            .get(url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "openforge");

        if let Some(ref etag) = cached_etag {
            req = req.header("If-None-Match", etag);
        }

        let response = req
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;

        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            if let Some(cached) = self.etag_cache.lock().unwrap().get(url) {
                let result: T = serde_json::from_str(&cached.body)
                    .map_err(|e| GitHubError::ParseError(e.to_string()))?;
                return Ok(result);
            }
            // Cache miss despite 304 — fall through to error
            return Err(GitHubError::ParseError(
                "Received 304 but no cached response found".to_string(),
            ));
        }

        if !response.status().is_success() {
            let status = response.status();
            if status.as_u16() == 403 || status.as_u16() == 429 {
                if let Some(reset_val) = response
                    .headers()
                    .get("x-ratelimit-reset")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.parse::<i64>().ok())
                {
                    *self.last_rate_limit_reset.lock().unwrap() = Some(reset_val);
                }
            }
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(GitHubError::ApiError {
                status: status.as_u16(),
                message: body,
            });
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

        if let Some(etag_value) = etag {
            self.etag_cache.lock().unwrap().insert(
                url.to_string(),
                CachedResponse {
                    etag: etag_value,
                    body: body.clone(),
                },
            );
        }

        let result: T =
            serde_json::from_str(&body).map_err(|e| GitHubError::ParseError(e.to_string()))?;

        Ok(result)
    }

    /// Get authenticated user's login
    pub async fn get_authenticated_user(&self, token: &str) -> Result<String, GitHubError> {
        let url = "https://api.github.com/user";

        let response = self
            .client
            .get(url)
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
}
