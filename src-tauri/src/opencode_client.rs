//! OpenCode REST API Client
//!
//! Type-safe Rust client for interacting with the OpenCode HTTP server.
//! Provides functions for session management, prompt sending, and SSE event streaming.
//!
//! ## API Endpoints (opencode serve)
//! - POST /session — Create new session
//! - POST /session/{id}/message — Send message to session
//! - POST /session/{id}/prompt_async — Send message async (no wait)
//! - POST /session/{id}/abort — Abort a running session
//! - GET /event — Subscribe to server-sent events
//! - GET /global/health — Health check
//!
//! ## Base URL
//! Default: http://localhost:4096
//! Configurable via OpenCodeClient::with_base_url(base_url)

use reqwest::{Client, Response};
use serde::{Deserialize, Serialize};
use std::error::Error as StdError;
use std::fmt;
use tokio_stream::Stream;

/// Default OpenCode server base URL
pub const DEFAULT_BASE_URL: &str = "http://localhost:4096";

/// OpenCode API client
#[derive(Clone)]
pub struct OpenCodeClient {
    client: Client,
    base_url: String,
}

impl OpenCodeClient {
    /// Create a new OpenCode client with default base URL
    pub fn new() -> Self {
        Self::with_base_url(DEFAULT_BASE_URL.to_string())
    }

    /// Create a new OpenCode client with custom base URL
    pub fn with_base_url(base_url: String) -> Self {
        Self {
            client: Client::new(),
            base_url,
        }
    }

    /// Create a new session
    ///
    /// # Arguments
    /// * `title` - Session title
    ///
    /// # Returns
    /// Session ID on success
    ///
    /// # Example
    /// ```no_run
    /// # use opencode_client::OpenCodeClient;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let client = OpenCodeClient::new();
    /// let session_id = client.create_session("My Session".to_string()).await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn create_session(&self, title: String) -> Result<String, OpenCodeError> {
        let url = format!("{}/session", self.base_url);
        let request = CreateSessionRequest { title };

        let response = self
            .client
            .post(&url)
            .json(&request)
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

        let session_response: CreateSessionResponse = response
            .json()
            .await
            .map_err(|e| OpenCodeError::ParseError(e.to_string()))?;

        Ok(session_response.id)
    }

    /// Send a prompt to a session
    ///
    /// # Arguments
    /// * `session_id` - Session ID
    /// * `text` - Prompt text
    ///
    /// # Returns
    /// Response from the API (structure depends on OpenCode version)
    ///
    /// # Example
    /// ```no_run
    /// # use opencode_client::OpenCodeClient;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let client = OpenCodeClient::new();
    /// let response = client.send_prompt("session_123", "Hello!".to_string()).await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn send_prompt(
        &self,
        session_id: &str,
        text: String,
    ) -> Result<serde_json::Value, OpenCodeError> {
        let url = format!("{}/session/{}/message", self.base_url, session_id);
        let request = SendPromptRequest {
            parts: vec![Part {
                r#type: "text".to_string(),
                text,
            }],
        };

        let response = self
            .client
            .post(&url)
            .json(&request)
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

        let json_response: serde_json::Value = response
            .json()
            .await
            .map_err(|e| OpenCodeError::ParseError(e.to_string()))?;

        Ok(json_response)
    }

    /// Subscribe to server-sent events
    ///
    /// # Returns
    /// Stream of bytes from the SSE endpoint
    ///
    /// # Example
    /// ```no_run
    /// # use opencode_client::OpenCodeClient;
    /// # use tokio_stream::StreamExt;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let client = OpenCodeClient::new();
    /// let mut stream = client.subscribe_events().await?;
    /// while let Some(chunk) = stream.next().await {
    ///     // Process SSE chunk
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn subscribe_events(&self) -> Result<EventStream, OpenCodeError> {
        let url = format!("{}/event", self.base_url);

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

        Ok(EventStream { response })
    }

    /// Health check
    ///
    /// # Returns
    /// Health status and version information
    pub async fn health(&self) -> Result<HealthResponse, OpenCodeError> {
        let url = format!("{}/global/health", self.base_url);

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

        let health: HealthResponse = response
            .json()
            .await
            .map_err(|e| OpenCodeError::ParseError(e.to_string()))?;

        Ok(health)
    }

    /// Send a prompt asynchronously (fire-and-forget)
    ///
    /// # Arguments
    /// * `session_id` - Session ID
    /// * `text` - Prompt text
    /// * `agent` - Optional agent name to route the prompt to
    ///
    /// # Returns
    /// Ok on successful submission (does not wait for completion)
    pub async fn prompt_async(
        &self,
        session_id: &str,
        text: String,
        agent: Option<String>,
    ) -> Result<(), OpenCodeError> {
        let url = format!("{}/session/{}/prompt_async", self.base_url, session_id);
        let request = PromptAsyncRequest {
            parts: vec![Part {
                r#type: "text".to_string(),
                text,
            }],
            agent,
        };

        let response = self
            .client
            .post(&url)
            .json(&request)
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

        Ok(())
    }

    /// Abort a running session
    ///
    /// # Arguments
    /// * `session_id` - Session ID to abort
    ///
    /// # Returns
    /// Ok on successful abort
    pub async fn abort_session(&self, session_id: &str) -> Result<(), OpenCodeError> {
        let url = format!("{}/session/{}/abort", self.base_url, session_id);

        let response = self
            .client
            .post(&url)
            .json(&serde_json::json!({}))
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

        Ok(())
    }

    /// List available agents
    ///
    /// # Returns
    /// List of agent information
    pub async fn list_agents(&self) -> Result<Vec<AgentInfo>, OpenCodeError> {
        let url = format!("{}/agent", self.base_url);

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

        let agents: Vec<AgentInfo> = response
            .json()
            .await
            .map_err(|e| OpenCodeError::ParseError(e.to_string()))?;

        Ok(agents)
    }

    /// Get session messages
    ///
    /// # Arguments
    /// * `session_id` - Session ID
    ///
    /// # Returns
    /// Array of message objects (each with role, parts, etc.)
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

        let messages: Vec<serde_json::Value> = response
            .json()
            .await
            .map_err(|e| OpenCodeError::ParseError(e.to_string()))?;

        Ok(messages)
    }

    /// Get session information
    ///
    /// # Arguments
    /// * `session_id` - Session ID
    ///
    /// # Returns
    /// Session information including status
    pub async fn get_session(&self, session_id: &str) -> Result<SessionInfo, OpenCodeError> {
        let url = format!("{}/session/{}", self.base_url, session_id);

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

        let session: SessionInfo = response
            .json()
            .await
            .map_err(|e| OpenCodeError::ParseError(e.to_string()))?;

        Ok(session)
    }
}

impl Default for OpenCodeClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Server-sent events stream wrapper
pub struct EventStream {
    response: Response,
}

impl EventStream {
    /// Get the underlying byte stream
    pub fn into_stream(self) -> impl Stream<Item = Result<bytes::Bytes, reqwest::Error>> {
        self.response.bytes_stream()
    }
}

// ============================================================================
// Request/Response Types
// ============================================================================

/// Request to create a new session
#[derive(Debug, Serialize, Deserialize)]
pub struct CreateSessionRequest {
    pub title: String,
}

/// Response from creating a session
#[derive(Debug, Serialize, Deserialize)]
pub struct CreateSessionResponse {
    pub id: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Request to send a prompt
#[derive(Debug, Serialize, Deserialize)]
pub struct SendPromptRequest {
    pub parts: Vec<Part>,
}

/// Part of a prompt (text, image, etc.)
#[derive(Debug, Serialize, Deserialize)]
pub struct Part {
    #[serde(rename = "type")]
    pub r#type: String,
    pub text: String,
}

/// Health check response
#[derive(Debug, Serialize, Deserialize)]
pub struct HealthResponse {
    pub healthy: bool,
    #[serde(default)]
    pub version: Option<String>,
}

/// Request to send a prompt asynchronously
#[derive(Debug, Serialize)]
pub struct PromptAsyncRequest {
    pub parts: Vec<Part>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
}

/// Agent information
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AgentInfo {
    pub name: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Session information
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub status: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

// ============================================================================
// Error Types
// ============================================================================

/// OpenCode API errors
#[derive(Debug)]
pub enum OpenCodeError {
    /// Network error (connection failed, timeout, etc.)
    NetworkError(String),
    /// API returned error status
    ApiError { status: u16, message: String },
    /// Failed to parse response
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

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_creation() {
        let client = OpenCodeClient::new();
        assert_eq!(client.base_url, DEFAULT_BASE_URL);
    }

    #[test]
    fn test_client_with_custom_url() {
        let custom_url = "http://localhost:8080";
        let client = OpenCodeClient::with_base_url(custom_url.to_string());
        assert_eq!(client.base_url, custom_url);
    }

    #[test]
    fn test_request_serialization() {
        let request = CreateSessionRequest {
            title: "Test Session".to_string(),
        };
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("Test Session"));
    }

    #[test]
    fn test_prompt_request_serialization() {
        let request = SendPromptRequest {
            parts: vec![Part {
                r#type: "text".to_string(),
                text: "Hello".to_string(),
            }],
        };
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("text"));
        assert!(json.contains("Hello"));
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
}
