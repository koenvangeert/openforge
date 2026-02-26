use rusqlite::Result;
use serde::Serialize;

/// Agent review comment row from database
#[derive(Debug, Clone, Serialize)]
pub struct AgentReviewCommentRow {
    pub id: i64,
    pub review_pr_id: i64,
    pub review_session_key: String,
    pub comment_type: String,
    pub file_path: Option<String>,
    pub line_number: Option<i32>,
    pub side: Option<String>,
    pub body: String,
    pub status: String,
    pub opencode_session_id: Option<String>,
    pub raw_agent_output: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl super::Database {
    /// Insert an agent review comment
    pub fn insert_agent_review_comment(
        &self,
        review_pr_id: i64,
        review_session_key: &str,
        comment_type: &str,
        file_path: Option<&str>,
        line_number: Option<i32>,
        side: Option<&str>,
        body: &str,
        opencode_session_id: Option<&str>,
        raw_agent_output: Option<&str>,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO agent_review_comments (review_pr_id, review_session_key, comment_type, file_path, line_number, side, body, status, opencode_session_id, raw_agent_output, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![review_pr_id, review_session_key, comment_type, file_path, line_number, side, body, "pending", opencode_session_id, raw_agent_output, now, now],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Get all agent review comments for a PR, ordered by creation time
    pub fn get_agent_review_comments_for_pr(
        &self,
        review_pr_id: i64,
    ) -> Result<Vec<AgentReviewCommentRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, review_pr_id, review_session_key, comment_type, file_path, line_number, side, body, status, opencode_session_id, raw_agent_output, created_at, updated_at
             FROM agent_review_comments
             WHERE review_pr_id = ?1
             ORDER BY created_at ASC",
        )?;

        let comments = stmt.query_map([review_pr_id], |row| {
            Ok(AgentReviewCommentRow {
                id: row.get(0)?,
                review_pr_id: row.get(1)?,
                review_session_key: row.get(2)?,
                comment_type: row.get(3)?,
                file_path: row.get(4)?,
                line_number: row.get(5)?,
                side: row.get(6)?,
                body: row.get(7)?,
                status: row.get(8)?,
                opencode_session_id: row.get(9)?,
                raw_agent_output: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })?;

        let mut result = Vec::new();
        for comment in comments {
            result.push(comment?);
        }
        Ok(result)
    }

    /// Update the status of an agent review comment
    pub fn update_agent_review_comment_status(&self, comment_id: i64, status: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;

        conn.execute(
            "UPDATE agent_review_comments SET status = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![status, now, comment_id],
        )?;

        Ok(())
    }

    /// Delete all agent review comments for a PR
    pub fn delete_agent_review_comments_for_pr(&self, review_pr_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM agent_review_comments WHERE review_pr_id = ?1",
            [review_pr_id],
        )?;

        Ok(())
    }

    /// Get a summary of agent review comments for a PR (returns the first comment as summary)
    pub fn get_agent_review_summary(
        &self,
        review_pr_id: i64,
    ) -> Result<Option<AgentReviewCommentRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, review_pr_id, review_session_key, comment_type, file_path, line_number, side, body, status, opencode_session_id, raw_agent_output, created_at, updated_at
             FROM agent_review_comments
             WHERE review_pr_id = ?1
             ORDER BY created_at ASC
             LIMIT 1",
        )?;

        let result = stmt.query_row([review_pr_id], |row| {
            Ok(AgentReviewCommentRow {
                id: row.get(0)?,
                review_pr_id: row.get(1)?,
                review_session_key: row.get(2)?,
                comment_type: row.get(3)?,
                file_path: row.get(4)?,
                line_number: row.get(5)?,
                side: row.get(6)?,
                body: row.get(7)?,
                status: row.get(8)?,
                opencode_session_id: row.get(9)?,
                raw_agent_output: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        });

        match result {
            Ok(row) => Ok(Some(row)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::fs;

    #[test]
    fn test_agent_review_comment_insert_and_retrieve() {
        let (db, path) = make_test_db("agent_review_insert");
        insert_test_task(&db);

        // Insert a review_pr row for FK constraint
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
            "INSERT INTO review_prs (id, number, title, state, draft, html_url, user_login, repo_owner, repo_name, head_ref, base_ref, head_sha, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![1, 42, "Test PR", "open", 0, "https://github.com/test/pr/42", "testuser", "owner", "repo", "feature", "main", "abc123", 1000, 1000],
        ).expect("insert review_pr");
        drop(conn);

        let id1 = db
            .insert_agent_review_comment(
                1,
                "session-key-1",
                "general",
                None,
                None,
                None,
                "First review comment",
                None,
                None,
            )
            .expect("insert 1 failed");

        let id2 = db
            .insert_agent_review_comment(
                1,
                "session-key-1",
                "file_specific",
                Some("src/main.rs"),
                Some(42),
                Some("LEFT"),
                "Fix this line",
                Some("opencode-123"),
                Some("raw output"),
            )
            .expect("insert 2 failed");

        assert!(id1 > 0);
        assert!(id2 > id1);

        let comments = db
            .get_agent_review_comments_for_pr(1)
            .expect("get comments failed");
        assert_eq!(comments.len(), 2);
        assert_eq!(comments[0].id, id1);
        assert_eq!(comments[0].body, "First review comment");
        assert_eq!(comments[0].status, "pending");
        assert_eq!(comments[0].file_path, None);
        assert_eq!(comments[1].id, id2);
        assert_eq!(comments[1].file_path, Some("src/main.rs".to_string()));
        assert_eq!(comments[1].line_number, Some(42));
        assert_eq!(comments[1].side, Some("LEFT".to_string()));
        assert_eq!(
            comments[1].opencode_session_id,
            Some("opencode-123".to_string())
        );

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_agent_review_comment_update_status() {
        let (db, path) = make_test_db("agent_review_update");
        insert_test_task(&db);

        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
            "INSERT INTO review_prs (id, number, title, state, draft, html_url, user_login, repo_owner, repo_name, head_ref, base_ref, head_sha, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![1, 42, "Test PR", "open", 0, "https://github.com/test/pr/42", "testuser", "owner", "repo", "feature", "main", "abc123", 1000, 1000],
        ).expect("insert review_pr");
        drop(conn);

        let id = db
            .insert_agent_review_comment(
                1,
                "session-key-1",
                "general",
                None,
                None,
                None,
                "Comment",
                None,
                None,
            )
            .expect("insert failed");

        let comments = db
            .get_agent_review_comments_for_pr(1)
            .expect("get before update failed");
        assert_eq!(comments[0].status, "pending");

        db.update_agent_review_comment_status(id, "approved")
            .expect("update failed");

        let comments = db
            .get_agent_review_comments_for_pr(1)
            .expect("get after update failed");
        assert_eq!(comments[0].status, "approved");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_agent_review_comment_delete_for_pr() {
        let (db, path) = make_test_db("agent_review_delete");
        insert_test_task(&db);

        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
            "INSERT INTO review_prs (id, number, title, state, draft, html_url, user_login, repo_owner, repo_name, head_ref, base_ref, head_sha, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![1, 42, "Test PR", "open", 0, "https://github.com/test/pr/42", "testuser", "owner", "repo", "feature", "main", "abc123", 1000, 1000],
        ).expect("insert review_pr");
        drop(conn);

        db.insert_agent_review_comment(
            1,
            "session-key-1",
            "general",
            None,
            None,
            None,
            "Comment 1",
            None,
            None,
        )
        .expect("insert 1 failed");

        db.insert_agent_review_comment(
            1,
            "session-key-1",
            "general",
            None,
            None,
            None,
            "Comment 2",
            None,
            None,
        )
        .expect("insert 2 failed");

        let comments = db
            .get_agent_review_comments_for_pr(1)
            .expect("get before delete failed");
        assert_eq!(comments.len(), 2);

        db.delete_agent_review_comments_for_pr(1)
            .expect("delete failed");

        let comments = db
            .get_agent_review_comments_for_pr(1)
            .expect("get after delete failed");
        assert_eq!(comments.len(), 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_agent_review_comment_get_summary() {
        let (db, path) = make_test_db("agent_review_summary");
        insert_test_task(&db);

        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
            "INSERT INTO review_prs (id, number, title, state, draft, html_url, user_login, repo_owner, repo_name, head_ref, base_ref, head_sha, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![1, 42, "Test PR", "open", 0, "https://github.com/test/pr/42", "testuser", "owner", "repo", "feature", "main", "abc123", 1000, 1000],
        ).expect("insert review_pr");
        drop(conn);

        // No comments yet
        let summary = db
            .get_agent_review_summary(1)
            .expect("get summary on empty failed");
        assert!(summary.is_none());

        db.insert_agent_review_comment(
            1,
            "session-key-1",
            "general",
            None,
            None,
            None,
            "First comment",
            None,
            None,
        )
        .expect("insert 1 failed");

        db.insert_agent_review_comment(
            1,
            "session-key-1",
            "general",
            None,
            None,
            None,
            "Second comment",
            None,
            None,
        )
        .expect("insert 2 failed");

        let summary = db.get_agent_review_summary(1).expect("get summary failed");
        assert!(summary.is_some());
        let summary = summary.unwrap();
        assert_eq!(summary.body, "First comment");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_agent_review_comment_migration_table_exists() {
        let (db, path) = make_test_db("agent_review_migration");

        let conn = db.connection();
        let conn = conn.lock().unwrap();

        // Verify table exists
        let table_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='agent_review_comments'",
                [],
                |row| {
                    let count: i64 = row.get(0)?;
                    Ok(count > 0)
                },
            )
            .expect("Failed to query sqlite_master");

        assert!(table_exists, "agent_review_comments table should exist");

        // Verify indexes exist
        let pr_index_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_agent_review_comments_pr'",
                [],
                |row| {
                    let count: i64 = row.get(0)?;
                    Ok(count > 0)
                },
            )
            .expect("Failed to query pr index");

        assert!(
            pr_index_exists,
            "idx_agent_review_comments_pr index should exist"
        );

        let session_index_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_agent_review_comments_session'",
                [],
                |row| {
                    let count: i64 = row.get(0)?;
                    Ok(count > 0)
                },
            )
            .expect("Failed to query session index");

        assert!(
            session_index_exists,
            "idx_agent_review_comments_session index should exist"
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_agent_review_comment_multiple_prs() {
        let (db, path) = make_test_db("agent_review_multi_pr");
        insert_test_task(&db);

        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
            "INSERT INTO review_prs (id, number, title, state, draft, html_url, user_login, repo_owner, repo_name, head_ref, base_ref, head_sha, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![1, 42, "Test PR 1", "open", 0, "https://github.com/test/pr/42", "testuser", "owner", "repo", "feature", "main", "abc123", 1000, 1000],
        ).expect("insert review_pr 1");
        conn.execute(
            "INSERT INTO review_prs (id, number, title, state, draft, html_url, user_login, repo_owner, repo_name, head_ref, base_ref, head_sha, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![2, 43, "Test PR 2", "open", 0, "https://github.com/test/pr/43", "testuser", "owner", "repo", "feature2", "main", "def456", 1000, 1000],
        ).expect("insert review_pr 2");
        drop(conn);

        db.insert_agent_review_comment(
            1,
            "session-key-1",
            "general",
            None,
            None,
            None,
            "PR 1 comment 1",
            None,
            None,
        )
        .expect("insert pr1c1 failed");

        db.insert_agent_review_comment(
            1,
            "session-key-1",
            "general",
            None,
            None,
            None,
            "PR 1 comment 2",
            None,
            None,
        )
        .expect("insert pr1c2 failed");

        db.insert_agent_review_comment(
            2,
            "session-key-2",
            "general",
            None,
            None,
            None,
            "PR 2 comment 1",
            None,
            None,
        )
        .expect("insert pr2c1 failed");

        let comments_pr1 = db
            .get_agent_review_comments_for_pr(1)
            .expect("get pr1 failed");
        assert_eq!(comments_pr1.len(), 2);
        assert!(comments_pr1.iter().all(|c| c.review_pr_id == 1));

        let comments_pr2 = db
            .get_agent_review_comments_for_pr(2)
            .expect("get pr2 failed");
        assert_eq!(comments_pr2.len(), 1);
        assert_eq!(comments_pr2[0].review_pr_id, 2);

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
