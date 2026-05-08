//! OpenCode legacy HTTP compatibility types.
//!
//! OpenForge no longer owns an `opencode serve` lifecycle after the plugin-hook
//! migration. New OpenCode work runs through `opencode run` PTYs with events
//! posted by the installed OpenCode plugin hook. This module intentionally keeps
//! only the shared DTOs used by provider discovery plus the narrow legacy
//! session-output reader used by `get_session_output` when a pre-migration
//! managed server is still present.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::error::Error as StdError;
use std::fmt;

/// OpenCode API client for the intentionally retained legacy session-output path.
#[derive(Clone)]
pub struct OpenCodeClient {
    client: Client,
    base_url: String,
}

impl OpenCodeClient {
    /// Create a new legacy client for a known managed OpenCode server URL.
    pub fn with_base_url(base_url: String) -> Self {
        Self {
            client: Client::new(),
            base_url,
        }
    }

    /// Get session messages for legacy output recovery.
    ///
    /// This is not part of the current OpenCode execution path. It exists only
    /// so old workspaces with an OpenForge-managed `opencode serve` port can
    /// still render assistant output via `get_session_output`.
    pub async fn get_session_messages(
        &self,
        session_id: &str,
    ) -> Result<Vec<serde_json::Value>, OpenCodeError> {
        let url = format!("{}/session/{}/message", self.base_url, session_id);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| OpenCodeError::NetworkError(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(OpenCodeError::ApiError {
                status: status.as_u16(),
                message: body,
            });
        }

        response
            .json()
            .await
            .map_err(|e| OpenCodeError::ParseError(e.to_string()))
    }
}

/// Request to send a prompt asynchronously.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptModel {
    #[serde(rename = "providerID")]
    pub provider_id: String,
    #[serde(rename = "modelID")]
    pub model_id: String,
}

/// Agent information.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AgentInfo {
    pub name: String,
    #[serde(default)]
    pub hidden: Option<bool>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProviderModelInfo {
    pub provider_id: String,
    pub model_id: String,
    pub name: String,
}

/// Command information.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CommandInfo {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Skill information — enriched from CommandInfo with template content and level.
#[derive(Debug, Clone, Serialize)]
pub struct SkillInfo {
    pub name: String,
    pub description: Option<String>,
    pub agent: Option<String>,
    pub template: Option<String>,
    pub level: String,      // "project" or "user"
    pub source_dir: String, // ".agents", ".claude", or ".opencode"
}

/// OpenCode API errors.
#[derive(Debug)]
#[allow(clippy::enum_variant_names)]
pub enum OpenCodeError {
    /// Network error (connection failed, timeout, etc.).
    NetworkError(String),
    /// API returned error status.
    ApiError { status: u16, message: String },
    /// Failed to parse response.
    ParseError(String),
}

impl fmt::Display for OpenCodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OpenCodeError::NetworkError(msg) => write!(f, "Network error: {}", msg),
            OpenCodeError::ApiError { status, message } => {
                write!(f, "API error (status {}): {}", status, message)
            }
            OpenCodeError::ParseError(msg) => write!(f, "Parse error: {}", msg),
        }
    }
}

impl StdError for OpenCodeError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_with_custom_url() {
        let custom_url = "http://localhost:8080";
        let client = OpenCodeClient::with_base_url(custom_url.to_string());
        assert_eq!(client.base_url, custom_url);
    }

    #[test]
    fn test_error_display() {
        let err = OpenCodeError::NetworkError("Connection refused".to_string());
        assert_eq!(err.to_string(), "Network error: Connection refused");

        let err = OpenCodeError::ApiError {
            status: 404,
            message: "Not found".to_string(),
        };
        assert_eq!(err.to_string(), "API error (status 404): Not found");

        let err = OpenCodeError::ParseError("Invalid JSON".to_string());
        assert_eq!(err.to_string(), "Parse error: Invalid JSON");
    }

    #[test]
    fn test_prompt_model_serialization() {
        let model = PromptModel {
            provider_id: "anthropic".to_string(),
            model_id: "claude-sonnet".to_string(),
        };

        let value = serde_json::to_value(&model).unwrap();
        assert_eq!(value["providerID"], "anthropic");
        assert_eq!(value["modelID"], "claude-sonnet");
        assert!(value.get("provider_id").is_none());
        assert!(value.get("model_id").is_none());
    }
}
