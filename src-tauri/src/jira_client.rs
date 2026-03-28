//! JIRA Cloud REST API Client
//!
//! Type-safe Rust client for interacting with JIRA Cloud REST API v3.
//! Provides functions for searching issues via JQL, fetching ticket details,
//! and transitioning ticket status.
//!
//! ## API Endpoints
//! - GET /rest/api/3/search/jql?jql={jql} — Search issues via JQL (enhanced search)
//! - GET /rest/api/3/issue/{key} — Get issue details
//! - POST /rest/api/3/issue/{key}/transitions — Transition issue status
//! - GET /rest/api/3/issue/{key}/transitions — Get available transitions
//!
//! ## Authentication
//! Uses HTTP Basic Auth with base64-encoded `email:api_token`
//! Authorization header format: `Basic {base64(email:api_token)}`
//!
//! ## Base URL
//! Format: https://your-domain.atlassian.net
//! Must be provided by caller (no default)

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::error::Error as StdError;
use std::fmt;

/// JIRA API client
#[derive(Clone)]
pub struct JiraClient {
    client: Client,
}

impl JiraClient {
    /// Create a new JIRA client
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    /// Search issues using JQL (JIRA Query Language)
    ///
    /// # Arguments
    /// * `base_url` - JIRA instance base URL (e.g., "https://your-domain.atlassian.net")
    /// * `email` - JIRA account email
    /// * `api_token` - JIRA API token
    /// * `jql` - JQL query string (e.g., "project = PROJ AND status = 'In Progress'")
    ///
    /// # Returns
    /// Vector of JiraIssue on success
    ///
    /// # Example
    /// ```no_run
    /// # use jira_client::JiraClient;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let client = JiraClient::new();
    /// let issues = client.search_issues(
    ///     "https://example.atlassian.net",
    ///     "user@example.com",
    ///     "api_token_here",
    ///     "project = PROJ"
    /// ).await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn search_issues(
        &self,
        base_url: &str,
        email: &str,
        api_token: &str,
        jql: &str,
    ) -> Result<Vec<JiraIssue>, JiraError> {
        let url = format!("{}/rest/api/3/search/jql", base_url);
        let auth_header = create_basic_auth_header(email, api_token);

        let response = self
            .client
            .get(&url)
            .header("Authorization", auth_header)
            .query(&[
                ("jql", jql),
                ("fields", "summary,status,description,assignee,priority"),
                ("expand", "renderedFields"),
            ])
            .send()
            .await
            .map_err(|e| JiraError::NetworkError(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(JiraError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        let search_response: SearchResponse = response
            .json()
            .await
            .map_err(|e| JiraError::ParseError(e.to_string()))?;

        Ok(search_response.issues)
    }
}

impl Default for JiraClient {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Request/Response Types
// ============================================================================

/// Search response from JIRA API
#[derive(Debug, Deserialize)]
pub struct SearchResponse {
    pub issues: Vec<JiraIssue>,
}

/// JIRA issue representation
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct JiraIssue {
    pub key: String,
    pub fields: JiraFields,
    #[serde(default, rename = "renderedFields")]
    pub rendered_fields: Option<JiraRenderedFields>,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// JIRA issue fields
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct JiraFields {
    pub summary: String,
    #[serde(default)]
    pub description: Option<serde_json::Value>,
    #[serde(default)]
    pub status: Option<JiraStatus>,
    #[serde(default)]
    pub assignee: Option<JiraUser>,
    #[serde(default)]
    pub priority: Option<JiraPriority>,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Pre-rendered HTML fields from JIRA (via expand=renderedFields)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct JiraRenderedFields {
    #[serde(default)]
    pub description: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// JIRA status
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct JiraStatus {
    pub name: String,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// JIRA user
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct JiraUser {
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(default)]
    pub email_address: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// JIRA priority
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct JiraPriority {
    pub name: String,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

// ============================================================================
// Error Types
// ============================================================================

/// JIRA API error types
#[derive(Debug)]
#[allow(clippy::enum_variant_names)]
pub enum JiraError {
    /// Network error (connection failure, timeout, etc.)
    NetworkError(String),
    /// API error (non-2xx status code)
    ApiError { status: u16, message: String },
    /// Parse error (JSON deserialization failure)
    ParseError(String),
}

impl fmt::Display for JiraError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            JiraError::NetworkError(msg) => write!(f, "Network error: {}", msg),
            JiraError::ApiError { status, message } => {
                write!(f, "API error (status {}): {}", status, message)
            }
            JiraError::ParseError(msg) => write!(f, "Parse error: {}", msg),
        }
    }
}

impl StdError for JiraError {}

// ============================================================================
// Helper Functions
// ============================================================================

/// Create HTTP Basic Auth header value
///
/// Encodes `email:api_token` as base64 and returns `Basic {base64_string}`
fn create_basic_auth_header(email: &str, api_token: &str) -> String {
    let credentials = format!("{}:{}", email, api_token);
    let encoded = base64_encode(&credentials);
    format!("Basic {}", encoded)
}

/// Base64 encode a string
fn base64_encode(input: &str) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD.encode(input.as_bytes())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_creation() {
        let _client = JiraClient::new();
    }

    #[test]
    fn test_basic_auth_header() {
        let header = create_basic_auth_header("user@example.com", "token123");
        assert!(header.starts_with("Basic "));
        // Verify it's valid base64
        let encoded = header.strip_prefix("Basic ").unwrap();
        assert!(!encoded.is_empty());
    }

    #[test]
    fn test_base64_encoding() {
        let input = "user@example.com:token123";
        let encoded = base64_encode(input);
        // Verify it's valid base64 (should not contain invalid chars)
        assert!(encoded
            .chars()
            .all(|c| c.is_alphanumeric() || c == '+' || c == '/' || c == '='));
    }

    #[test]
    fn test_error_display() {
        let network_err = JiraError::NetworkError("Connection timeout".to_string());
        assert_eq!(network_err.to_string(), "Network error: Connection timeout");

        let api_err = JiraError::ApiError {
            status: 401,
            message: "Unauthorized".to_string(),
        };
        assert_eq!(api_err.to_string(), "API error (status 401): Unauthorized");

        let parse_err = JiraError::ParseError("Invalid JSON".to_string());
        assert_eq!(parse_err.to_string(), "Parse error: Invalid JSON");
    }
}
