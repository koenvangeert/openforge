use std::error::Error as StdError;
use std::fmt;

/// GitHub API error types
#[derive(Debug)]
#[allow(clippy::enum_variant_names)]
pub enum GitHubError {
    /// Network error (connection failure, timeout, etc.)
    NetworkError(String),
    /// API error (non-2xx status code)
    ApiError { status: u16, message: String },
    /// Parse error (JSON deserialization failure)
    ParseError(String),
}

impl fmt::Display for GitHubError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GitHubError::NetworkError(msg) => write!(f, "Network error: {}", msg),
            GitHubError::ApiError { status, message } => {
                write!(f, "API error (status {}): {}", status, message)
            }
            GitHubError::ParseError(msg) => write!(f, "Parse error: {}", msg),
        }
    }
}

impl StdError for GitHubError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let network_err = GitHubError::NetworkError("Connection timeout".to_string());
        assert_eq!(network_err.to_string(), "Network error: Connection timeout");

        let api_err = GitHubError::ApiError {
            status: 404,
            message: "Not Found".to_string(),
        };
        assert_eq!(api_err.to_string(), "API error (status 404): Not Found");

        let parse_err = GitHubError::ParseError("Invalid JSON".to_string());
        assert_eq!(parse_err.to_string(), "Parse error: Invalid JSON");
    }
}
