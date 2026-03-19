use log::warn;
use serde::Deserialize;
use std::sync::Mutex;

use crate::db;

// ============================================================================
// Parsed Review Types
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct ParsedReview {
    pub summary: String,
    #[serde(default)]
    pub comments: Vec<ParsedComment>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ParsedComment {
    pub file: String,
    pub line: i32,
    #[serde(default = "default_side")]
    pub side: String,
    pub body: String,
}

fn default_side() -> String {
    "RIGHT".to_string()
}

// ============================================================================
// Parsing
// ============================================================================

/// Parse agent review response with multiple fallback strategies.
///
/// Strategies tried in order:
/// 1. Extract JSON from ```json ... ``` code block
/// 2. Parse entire raw_output as JSON directly
/// 3. Find the first `{` and last `}` and parse that substring
///
/// After successful parse, validates each comment:
/// - Skips comments with empty file, line <= 0, or empty body (with warnings)
/// - Normalizes side to "RIGHT" if not "LEFT" or "RIGHT"
pub fn parse_agent_review_response(raw_output: &str) -> Result<ParsedReview, String> {
    // Strategy 1: JSON code block (```json ... ```)
    if let Some(json_str) = extract_json_code_block(raw_output) {
        if let Ok(mut review) = serde_json::from_str::<ParsedReview>(&json_str) {
            review.comments = validate_comments(review.comments);
            return Ok(review);
        }
    }

    // Strategy 2: Parse entire string as JSON directly
    if let Ok(mut review) = serde_json::from_str::<ParsedReview>(raw_output) {
        review.comments = validate_comments(review.comments);
        return Ok(review);
    }

    // Strategy 3: Find first `{` and last `}`, extract and parse
    if let Some(json_str) = extract_json_braces(raw_output) {
        if let Ok(mut review) = serde_json::from_str::<ParsedReview>(&json_str) {
            review.comments = validate_comments(review.comments);
            return Ok(review);
        }
    }

    Err("Failed to parse agent review response: no valid JSON found".to_string())
}

fn extract_json_code_block(text: &str) -> Option<String> {
    let start_marker = "```json";
    let end_marker = "```";

    let start = text.find(start_marker)?;
    let after_start = start + start_marker.len();

    // Skip newline after the opening fence
    let content_start = text[after_start..]
        .find('\n')
        .map(|i| after_start + i + 1)
        .unwrap_or(after_start);

    let end = text[content_start..]
        .find(end_marker)
        .map(|i| content_start + i)?;

    let json_str = text[content_start..end].trim().to_string();
    if json_str.is_empty() {
        return None;
    }
    Some(json_str)
}

fn extract_json_braces(text: &str) -> Option<String> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;

    if start >= end {
        return None;
    }

    Some(text[start..=end].to_string())
}

fn validate_comments(comments: Vec<ParsedComment>) -> Vec<ParsedComment> {
    let mut valid = Vec::new();
    for mut comment in comments {
        if comment.file.is_empty() {
            warn!("Warning: skipping comment with empty file path");
            continue;
        }
        if comment.line <= 0 {
            warn!(
                "Warning: skipping comment with invalid line number: {}",
                comment.line
            );
            continue;
        }
        if comment.body.is_empty() {
            warn!("Warning: skipping comment with empty body");
            continue;
        }
        // Normalize side to "RIGHT" if not "LEFT" or "RIGHT"
        if comment.side != "LEFT" && comment.side != "RIGHT" {
            warn!(
                "Warning: invalid side '{}', defaulting to RIGHT",
                comment.side
            );
            comment.side = "RIGHT".to_string();
        }
        valid.push(comment);
    }
    valid
}

// ============================================================================
// Storage
// ============================================================================

/// Store a parsed review to the database.
///
/// Inserts the summary as a "summary" comment (no file_path, no line_number),
/// then inserts each validated inline comment with type "inline".
pub fn store_parsed_review(
    db: &Mutex<db::Database>,
    review_pr_id: i64,
    review_session_key: &str,
    opencode_session_id: Option<&str>,
    raw_output: &str,
    review: &ParsedReview,
) -> Result<(), String> {
    let db = db.lock().unwrap();

    // Insert summary as a "summary" comment
    db.insert_agent_review_comment(
        review_pr_id,
        review_session_key,
        "summary",
        None,
        None,
        None,
        &review.summary,
        opencode_session_id,
        Some(raw_output),
    )
    .map_err(|e| format!("Failed to insert summary: {}", e))?;

    // Insert each inline comment
    for comment in &review.comments {
        db.insert_agent_review_comment(
            review_pr_id,
            review_session_key,
            "inline",
            Some(&comment.file),
            Some(comment.line),
            Some(&comment.side),
            &comment.body,
            opencode_session_id,
            None,
        )
        .map_err(|e| format!("Failed to insert comment: {}", e))?;
    }

    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::*;
    use std::fs;

    #[test]
    fn test_parse_json_code_block() {
        let raw = r#"
Here is my review:

```json
{
  "summary": "Overall LGTM",
  "comments": [
    {
      "file": "src/main.rs",
      "line": 42,
      "side": "RIGHT",
      "body": "Consider adding error handling here"
    }
  ]
}
```

Let me know if you have questions."#;

        let review = parse_agent_review_response(raw).expect("should parse JSON code block");
        assert_eq!(review.summary, "Overall LGTM");
        assert_eq!(review.comments.len(), 1);
        assert_eq!(review.comments[0].file, "src/main.rs");
        assert_eq!(review.comments[0].line, 42);
        assert_eq!(review.comments[0].side, "RIGHT");
        assert_eq!(
            review.comments[0].body,
            "Consider adding error handling here"
        );
    }

    #[test]
    fn test_parse_raw_json() {
        let raw = r#"{"summary": "Looks good", "comments": []}"#;
        let review = parse_agent_review_response(raw).expect("should parse raw JSON");
        assert_eq!(review.summary, "Looks good");
        assert_eq!(review.comments.len(), 0);
    }

    #[test]
    fn test_parse_malformed_output() {
        let raw = "This is just plain text with no JSON at all!";
        let result = parse_agent_review_response(raw);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Failed to parse agent review response"));
    }

    #[test]
    fn test_parse_json_between_braces() {
        let raw = r#"Some prefix text here { "summary": "Found it", "comments": [] } and some trailing text"#;
        let review = parse_agent_review_response(raw).expect("should parse via brace extraction");
        assert_eq!(review.summary, "Found it");
        assert!(review.comments.is_empty());
    }

    #[test]
    fn test_validate_comment_defaults_side() {
        let raw = r#"{
  "summary": "Test",
  "comments": [
    {"file": "src/lib.rs", "line": 10, "side": "INVALID", "body": "Some comment"},
    {"file": "src/lib.rs", "line": 20, "body": "No side field"}
  ]
}"#;
        let review = parse_agent_review_response(raw).expect("should parse");
        assert_eq!(review.comments.len(), 2);
        // INVALID side gets normalized to RIGHT
        assert_eq!(review.comments[0].side, "RIGHT");
        // Missing side defaults to RIGHT via serde default
        assert_eq!(review.comments[1].side, "RIGHT");
    }

    #[test]
    fn test_filter_invalid_comments() {
        let raw = r#"{
  "summary": "Test",
  "comments": [
    {"file": "", "line": 10, "side": "RIGHT", "body": "Empty file"},
    {"file": "src/main.rs", "line": 0, "side": "RIGHT", "body": "Zero line"},
    {"file": "src/main.rs", "line": -1, "side": "RIGHT", "body": "Negative line"},
    {"file": "src/main.rs", "line": 5, "side": "RIGHT", "body": ""},
    {"file": "src/main.rs", "line": 15, "side": "LEFT", "body": "Valid comment"}
  ]
}"#;
        let review = parse_agent_review_response(raw).expect("should parse");
        // Only the valid comment should remain
        assert_eq!(review.comments.len(), 1);
        assert_eq!(review.comments[0].body, "Valid comment");
        assert_eq!(review.comments[0].side, "LEFT");
    }

    #[test]
    fn test_parse_empty_comments_array() {
        let raw = r#"{"summary": "No inline comments needed", "comments": []}"#;
        let review = parse_agent_review_response(raw).expect("should parse");
        assert_eq!(review.summary, "No inline comments needed");
        assert!(review.comments.is_empty());
    }

    #[test]
    fn test_store_parsed_review() {
        let (db, path) = make_test_db("review_parser_store");
        insert_test_task(&db);

        // Insert a review_prs row for FK constraint
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
            "INSERT INTO review_prs (id, number, title, state, draft, html_url, user_login, repo_owner, repo_name, head_ref, base_ref, head_sha, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![1, 42, "Test PR", "open", 0, "https://github.com/test/pr/42", "testuser", "owner", "repo", "feature", "main", "abc123", 1000, 1000],
        ).expect("insert review_pr");
        drop(conn);

        let review = ParsedReview {
            summary: "Great work overall".to_string(),
            comments: vec![ParsedComment {
                file: "src/lib.rs".to_string(),
                line: 25,
                side: "RIGHT".to_string(),
                body: "Consider refactoring this".to_string(),
            }],
        };

        let db_mutex = std::sync::Mutex::new(db);
        let raw_output = r#"{"summary":"Great work overall","comments":[{"file":"src/lib.rs","line":25,"side":"RIGHT","body":"Consider refactoring this"}]}"#;

        store_parsed_review(
            &db_mutex,
            1,
            "test-session-key",
            Some("opencode-session-1"),
            raw_output,
            &review,
        )
        .expect("store should succeed");

        // Verify by reading back from DB
        let db = db_mutex.into_inner().unwrap();
        let comments = db
            .get_agent_review_comments_for_pr(1)
            .expect("get comments failed");

        assert_eq!(comments.len(), 2);

        // First should be the summary comment
        assert_eq!(comments[0].comment_type, "summary");
        assert_eq!(comments[0].body, "Great work overall");
        assert_eq!(comments[0].file_path, None);
        assert_eq!(comments[0].line_number, None);
        assert_eq!(
            comments[0].opencode_session_id,
            Some("opencode-session-1".to_string())
        );
        assert!(comments[0].raw_agent_output.is_some());

        // Second should be the inline comment
        assert_eq!(comments[1].comment_type, "inline");
        assert_eq!(comments[1].body, "Consider refactoring this");
        assert_eq!(comments[1].file_path, Some("src/lib.rs".to_string()));
        assert_eq!(comments[1].line_number, Some(25));
        assert_eq!(comments[1].side, Some("RIGHT".to_string()));
        assert_eq!(comments[1].raw_agent_output, None);

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
