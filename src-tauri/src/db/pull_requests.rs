use rusqlite::Result;
use serde::Serialize;
use std::collections::HashSet;

/// Pull request row from database
#[derive(Debug, Clone, Serialize)]
pub struct PrRow {
    pub id: i64,
    pub ticket_id: String,
    pub repo_owner: String,
    pub repo_name: String,
    pub title: String,
    pub url: String,
    pub state: String,
    pub head_sha: String,
    pub ci_status: Option<String>,
    pub ci_check_runs: Option<String>,
    pub review_status: Option<String>,
    pub merged_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub unaddressed_comment_count: i64,
}

/// PR comment row from database
#[derive(Debug, Clone, Serialize)]
pub struct PrCommentRow {
    pub id: i64,
    pub pr_id: i64,
    pub author: String,
    pub body: String,
    pub comment_type: String,
    pub file_path: Option<String>,
    pub line_number: Option<i32>,
    pub addressed: i32,
    pub created_at: i64,
}

impl super::Database {
    /// Get all open pull requests from the database
    pub fn get_open_prs(&self) -> Result<Vec<PrRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ticket_id, repo_owner, repo_name, title, url, state, head_sha, ci_status, ci_check_runs, review_status, merged_at, created_at, updated_at,
                    (SELECT COUNT(*) FROM pr_comments WHERE pr_id = pull_requests.id AND addressed = 0) as unaddressed_comment_count
             FROM pull_requests
             WHERE state = 'open'
             ORDER BY updated_at DESC"
        )?;

        let prs = stmt.query_map([], |row| {
            Ok(PrRow {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                repo_owner: row.get(2)?,
                repo_name: row.get(3)?,
                title: row.get(4)?,
                url: row.get(5)?,
                state: row.get(6)?,
                head_sha: row.get(7)?,
                ci_status: row.get(8)?,
                ci_check_runs: row.get(9)?,
                review_status: row.get(10)?,
                merged_at: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
                unaddressed_comment_count: row.get(14)?,
            })
        })?;

        let mut result = Vec::new();
        for pr in prs {
            result.push(pr?);
        }
        Ok(result)
    }

    pub fn get_all_pull_requests(&self) -> Result<Vec<PrRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ticket_id, repo_owner, repo_name, title, url, state, head_sha, ci_status, ci_check_runs, review_status, merged_at, created_at, updated_at,
                    (SELECT COUNT(*) FROM pr_comments WHERE pr_id = pull_requests.id AND addressed = 0) as unaddressed_comment_count
             FROM pull_requests
             ORDER BY updated_at DESC",
        )?;

        let prs = stmt.query_map([], |row| {
            Ok(PrRow {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                repo_owner: row.get(2)?,
                repo_name: row.get(3)?,
                title: row.get(4)?,
                url: row.get(5)?,
                state: row.get(6)?,
                head_sha: row.get(7)?,
                ci_status: row.get(8)?,
                ci_check_runs: row.get(9)?,
                review_status: row.get(10)?,
                merged_at: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
                unaddressed_comment_count: row.get(14)?,
            })
        })?;

        let mut result = Vec::new();
        for pr in prs {
            result.push(pr?);
        }
        Ok(result)
    }

    pub fn comment_exists(&self, id: i64) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM pr_comments WHERE id = ?1")?;
        let count: i64 = stmt.query_row([id], |row| row.get(0))?;
        Ok(count > 0)
    }

    /// Insert a PR comment into the database
    #[allow(clippy::too_many_arguments)]
    pub fn insert_pr_comment(
        &self,
        id: i64,
        pr_id: i64,
        author: &str,
        body: &str,
        comment_type: &str,
        file_path: Option<&str>,
        line_number: Option<i32>,
        addressed: bool,
        created_at: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO pr_comments (id, pr_id, author, body, comment_type, file_path, line_number, addressed, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                id,
                pr_id,
                author,
                body,
                comment_type,
                file_path,
                line_number,
                if addressed { 1 } else { 0 },
                created_at,
            ],
        )?;
        Ok(())
    }

    /// Insert or update a pull request in the database
    /// Uses ON CONFLICT to preserve CI status columns (head_sha, ci_status, ci_check_runs)
    pub fn insert_pull_request(
        &self,
        id: i64,
        ticket_id: &str,
        repo_owner: &str,
        repo_name: &str,
        title: &str,
        url: &str,
        state: &str,
        created_at: i64,
        updated_at: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO pull_requests (id, ticket_id, repo_owner, repo_name, title, url, state, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               ticket_id=excluded.ticket_id,
               repo_owner=excluded.repo_owner,
               repo_name=excluded.repo_name,
               title=excluded.title,
               url=excluded.url,
               state=excluded.state,
               updated_at=excluded.updated_at",
            rusqlite::params![
                id,
                ticket_id,
                repo_owner,
                repo_name,
                title,
                url,
                state,
                created_at,
                updated_at,
            ],
        )?;
        Ok(())
    }

    /// Update the head SHA for a pull request
    pub fn update_pr_head_sha(&self, pr_id: i64, sha: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE pull_requests SET head_sha = ?1 WHERE id = ?2",
            rusqlite::params![sha, pr_id],
        )?;
        Ok(())
    }

    /// Update CI status and check runs for a pull request
    pub fn update_pr_ci_status(
        &self,
        pr_id: i64,
        head_sha: &str,
        ci_status: &str,
        ci_check_runs: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE pull_requests SET head_sha = ?1, ci_status = ?2, ci_check_runs = ?3 WHERE id = ?4",
            rusqlite::params![head_sha, ci_status, ci_check_runs, pr_id],
        )?;
        Ok(())
    }

    /// Get CI status for a pull request
    pub fn get_pr_ci_status(&self, pr_id: i64) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT ci_status FROM pull_requests WHERE id = ?1")?;
        let mut rows = stmt.query([pr_id])?;
        if let Some(row) = rows.next()? {
            Ok(row.get(0)?)
        } else {
            Ok(None)
        }
    }

    /// Get review status for a pull request
    pub fn get_pr_review_status(&self, pr_id: i64) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT review_status FROM pull_requests WHERE id = ?1")?;
        let mut rows = stmt.query([pr_id])?;
        if let Some(row) = rows.next()? {
            Ok(row.get(0)?)
        } else {
            Ok(None)
        }
    }

    pub fn update_pr_review_status(&self, pr_id: i64, review_status: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE pull_requests SET review_status = ?1 WHERE id = ?2",
            rusqlite::params![review_status, pr_id],
        )?;
        Ok(())
    }

    pub fn update_pr_merged(&self, id: i64, merged_at: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE pull_requests SET state = 'merged', merged_at = ?1 WHERE id = ?2",
            rusqlite::params![merged_at, id],
        )?;
        Ok(())
    }

    /// Get existing comment IDs for a PR as a HashSet for efficient batch lookups
    pub fn get_existing_comment_ids(&self, pr_id: i64) -> Result<HashSet<i64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id FROM pr_comments WHERE pr_id = ?1")?;
        let ids = stmt.query_map([pr_id], |row| row.get(0))?;
        let mut result = HashSet::new();
        for id in ids {
            result.insert(id?);
        }
        Ok(result)
    }

    /// Get the last polled timestamp for a PR, or None if PR doesn't exist
    pub fn get_pr_last_polled(&self, pr_id: i64) -> Result<Option<i64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT last_polled_at FROM pull_requests WHERE id = ?1")?;
        let mut rows = stmt.query([pr_id])?;
        if let Some(row) = rows.next()? {
            Ok(row.get(0)?)
        } else {
            Ok(None)
        }
    }

    /// Set the last polled timestamp for a PR
    pub fn set_pr_last_polled(&self, pr_id: i64, timestamp: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE pull_requests SET last_polled_at = ?1 WHERE id = ?2",
            rusqlite::params![timestamp, pr_id],
        )?;
        Ok(())
    }

    /// Get all comments for a specific PR
    pub fn get_comments_for_pr(&self, pr_id: i64) -> Result<Vec<PrCommentRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, pr_id, author, body, comment_type, file_path, line_number, addressed, created_at 
             FROM pr_comments 
             WHERE pr_id = ?1 
             ORDER BY created_at ASC"
        )?;

        let comments = stmt.query_map([pr_id], |row| {
            Ok(PrCommentRow {
                id: row.get(0)?,
                pr_id: row.get(1)?,
                author: row.get(2)?,
                body: row.get(3)?,
                comment_type: row.get(4)?,
                file_path: row.get(5)?,
                line_number: row.get(6)?,
                addressed: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?;

        let mut result = Vec::new();
        for comment in comments {
            result.push(comment?);
        }
        Ok(result)
    }

    pub fn mark_comment_addressed(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE pr_comments SET addressed = 1 WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn get_pr_comments_by_ids(&self, ids: &[i64]) -> Result<Vec<PrCommentRow>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock().unwrap();
        let placeholders: Vec<String> = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT id, pr_id, author, body, comment_type, file_path, line_number, addressed, created_at FROM pr_comments WHERE id IN ({}) ORDER BY created_at ASC",
            placeholders.join(", ")
        );
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<Box<dyn rusqlite::types::ToSql>> = ids
            .iter()
            .map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>)
            .collect();
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let comments = stmt.query_map(param_refs.as_slice(), |row| {
            Ok(PrCommentRow {
                id: row.get(0)?,
                pr_id: row.get(1)?,
                author: row.get(2)?,
                body: row.get(3)?,
                comment_type: row.get(4)?,
                file_path: row.get(5)?,
                line_number: row.get(6)?,
                addressed: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?;
        let mut result = Vec::new();
        for comment in comments {
            result.push(comment?);
        }
        Ok(result)
    }

    pub fn close_stale_open_prs(
        &self,
        repo_owner: &str,
        repo_name: &str,
        open_pr_ids: &[i64],
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        if open_pr_ids.is_empty() {
            conn.execute(
                "UPDATE pull_requests SET state = 'closed' WHERE repo_owner = ?1 AND repo_name = ?2 AND state = 'open'",
                [repo_owner, repo_name],
            )?;
        } else {
            let placeholders: Vec<String> = open_pr_ids
                .iter()
                .enumerate()
                .map(|(i, _)| format!("?{}", i + 3))
                .collect();
            let sql = format!(
                "UPDATE pull_requests SET state = 'closed' WHERE repo_owner = ?1 AND repo_name = ?2 AND state = 'open' AND id NOT IN ({})",
                placeholders.join(", ")
            );
            let mut stmt = conn.prepare(&sql)?;
            let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![
                Box::new(repo_owner.to_string()),
                Box::new(repo_name.to_string()),
            ];
            for id in open_pr_ids {
                params.push(Box::new(*id));
            }
            let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();
            stmt.execute(param_refs.as_slice())?;
        }
        Ok(())
    }

    pub fn mark_comments_addressed(&self, ids: &[i64]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let conn = self.conn.lock().unwrap();
        let placeholders: Vec<String> = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "UPDATE pr_comments SET addressed = 1 WHERE id IN ({})",
            placeholders.join(", ")
        );
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<Box<dyn rusqlite::types::ToSql>> = ids
            .iter()
            .map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>)
            .collect();
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        stmt.execute(param_refs.as_slice())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::fs;

    #[test]
    fn test_pull_request_crud() {
        let (db, path) = make_test_db("pr_crud");
        insert_test_task(&db);

        db.insert_pull_request(
            42,
            "T-100",
            "acme",
            "repo",
            "Fix auth",
            "https://github.com/acme/repo/pull/42",
            "open",
            1000,
            2000,
        )
        .expect("insert pr failed");

        let open_prs = db.get_open_prs().expect("get open prs failed");
        assert_eq!(open_prs.len(), 1);
        assert_eq!(open_prs[0].id, 42);
        assert_eq!(open_prs[0].ticket_id, "T-100");
        assert_eq!(open_prs[0].state, "open");

        db.insert_pull_request(
            42,
            "T-100",
            "acme",
            "repo",
            "Fix auth",
            "https://github.com/acme/repo/pull/42",
            "merged",
            1000,
            3000,
        )
        .expect("update pr failed");

        let open_prs = db.get_open_prs().expect("get open prs failed");
        assert_eq!(open_prs.len(), 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_pr_comment_lifecycle() {
        let (db, path) = make_test_db("pr_comment_lifecycle");
        insert_test_task(&db);

        db.insert_pull_request(
            10,
            "T-100",
            "acme",
            "repo",
            "PR title",
            "https://example.com",
            "open",
            1000,
            1000,
        )
        .expect("insert pr failed");

        assert!(!db.comment_exists(501).expect("check failed"));

        db.insert_pr_comment(
            501,
            10,
            "reviewer",
            "Fix this",
            "review_comment",
            Some("src/main.rs"),
            Some(42),
            false,
            2000,
        )
        .expect("insert comment failed");
        db.insert_pr_comment(
            502,
            10,
            "reviewer",
            "Nit: rename",
            "review_comment",
            None,
            None,
            false,
            2001,
        )
        .expect("insert comment 2 failed");

        assert!(db.comment_exists(501).expect("check failed"));

        let comments = db.get_comments_for_pr(10).expect("get comments failed");
        assert_eq!(comments.len(), 2);
        assert_eq!(comments[0].id, 501);
        assert_eq!(comments[0].author, "reviewer");
        assert_eq!(comments[0].file_path, Some("src/main.rs".to_string()));
        assert_eq!(comments[0].addressed, 0);

        db.mark_comment_addressed(501).expect("mark failed");

        let comments = db.get_comments_for_pr(10).expect("get comments failed");
        assert_eq!(comments[0].addressed, 1);
        assert_eq!(comments[1].addressed, 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_get_pr_comments_by_ids() {
        let (db, path) = make_test_db("pr_comments_by_ids");
        insert_test_task(&db);

        db.insert_pull_request(
            20,
            "T-100",
            "acme",
            "repo",
            "PR",
            "https://example.com",
            "open",
            1000,
            1000,
        )
        .expect("insert pr failed");

        db.insert_pr_comment(
            601,
            20,
            "alice",
            "Comment 1",
            "review_comment",
            None,
            None,
            false,
            3000,
        )
        .expect("insert 1 failed");
        db.insert_pr_comment(
            602,
            20,
            "bob",
            "Comment 2",
            "review_comment",
            None,
            None,
            false,
            3001,
        )
        .expect("insert 2 failed");
        db.insert_pr_comment(
            603,
            20,
            "carol",
            "Comment 3",
            "issue_comment",
            None,
            None,
            false,
            3002,
        )
        .expect("insert 3 failed");

        let result = db
            .get_pr_comments_by_ids(&[601, 603])
            .expect("get by ids failed");
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].author, "alice");
        assert_eq!(result[1].author, "carol");

        let empty = db.get_pr_comments_by_ids(&[]).expect("empty query failed");
        assert_eq!(empty.len(), 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_mark_comments_addressed_batch() {
        let (db, path) = make_test_db("mark_batch_addressed");
        insert_test_task(&db);

        db.insert_pull_request(
            30,
            "T-100",
            "acme",
            "repo",
            "PR",
            "https://example.com",
            "open",
            1000,
            1000,
        )
        .expect("insert pr failed");

        db.insert_pr_comment(
            701,
            30,
            "a",
            "c1",
            "review_comment",
            None,
            None,
            false,
            4000,
        )
        .expect("insert failed");
        db.insert_pr_comment(
            702,
            30,
            "b",
            "c2",
            "review_comment",
            None,
            None,
            false,
            4001,
        )
        .expect("insert failed");
        db.insert_pr_comment(
            703,
            30,
            "c",
            "c3",
            "review_comment",
            None,
            None,
            false,
            4002,
        )
        .expect("insert failed");

        db.mark_comments_addressed(&[701, 703])
            .expect("batch mark failed");

        let comments = db.get_comments_for_pr(30).expect("get failed");
        assert_eq!(comments[0].addressed, 1);
        assert_eq!(comments[1].addressed, 0);
        assert_eq!(comments[2].addressed, 1);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_ci_status_migration() {
        let (db, path) = make_test_db("ci_migration");

        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let has_head_sha: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name='head_sha'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let has_ci_status: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name='ci_status'",
            [], |row| row.get(0)
        ).unwrap();
        let has_ci_check_runs: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name='ci_check_runs'",
            [], |row| row.get(0)
        ).unwrap();

        assert!(has_head_sha, "head_sha column missing");
        assert!(has_ci_status, "ci_status column missing");
        assert!(has_ci_check_runs, "ci_check_runs column missing");

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_update_pr_ci_status() {
        let (db, path) = make_test_db("ci_status_update");
        insert_test_task(&db);

        let now = 1000i64;
        db.insert_pull_request(
            42,
            "T-100",
            "owner",
            "repo",
            "Test PR",
            "https://github.com/pr/42",
            "open",
            now,
            now,
        )
        .unwrap();

        db.update_pr_ci_status(42, "sha123", "success", r#"[{"id":1,"name":"build","status":"completed","conclusion":"success","html_url":"https://example.com"}]"#).unwrap();

        let prs = db.get_open_prs().unwrap();
        let pr = prs.iter().find(|p| p.id == 42).expect("PR not found");

        assert_eq!(pr.head_sha, "sha123");
        assert_eq!(pr.ci_status, Some("success".to_string()));
        assert!(pr.ci_check_runs.is_some());
        assert!(pr.ci_check_runs.as_ref().unwrap().contains("build"));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_pr_upsert_preserves_ci_status() {
        let (db, path) = make_test_db("ci_upsert_preserve");
        insert_test_task(&db);

        let now = 1000i64;
        db.insert_pull_request(
            42,
            "T-100",
            "owner",
            "repo",
            "Test PR",
            "https://github.com/pr/42",
            "open",
            now,
            now,
        )
        .unwrap();

        db.update_pr_ci_status(42, "sha123", "success", r#"[{"id":1,"name":"build","status":"completed","conclusion":"success","html_url":"https://example.com"}]"#).unwrap();

        db.insert_pull_request(
            42,
            "T-100",
            "owner",
            "repo",
            "Test PR Updated",
            "https://github.com/pr/42",
            "open",
            now + 30,
            now + 30,
        )
        .unwrap();

        let prs = db.get_open_prs().unwrap();
        let pr = prs.iter().find(|p| p.id == 42).expect("PR not found");

        assert_eq!(
            pr.ci_status,
            Some("success".to_string()),
            "CI status was wiped by upsert!"
        );
        assert!(
            pr.ci_check_runs.is_some(),
            "CI check runs were wiped by upsert!"
        );
        assert_eq!(pr.head_sha, "sha123", "Head SHA was wiped by upsert!");
        assert_eq!(pr.title, "Test PR Updated");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_get_existing_comment_ids() {
        let (db, path) = make_test_db("existing_comment_ids");
        insert_test_task(&db);

        db.insert_pull_request(
            50,
            "T-100",
            "acme",
            "repo",
            "PR",
            "https://example.com",
            "open",
            1000,
            1000,
        )
        .expect("insert pr failed");

        db.insert_pr_comment(
            801,
            50,
            "alice",
            "c1",
            "review_comment",
            None,
            None,
            false,
            5000,
        )
        .expect("insert c1 failed");
        db.insert_pr_comment(
            802,
            50,
            "bob",
            "c2",
            "review_comment",
            None,
            None,
            false,
            5001,
        )
        .expect("insert c2 failed");
        db.insert_pr_comment(
            803,
            50,
            "carol",
            "c3",
            "review_comment",
            None,
            None,
            false,
            5002,
        )
        .expect("insert c3 failed");

        let existing = db
            .get_existing_comment_ids(50)
            .expect("get existing comment ids failed");

        assert_eq!(existing.len(), 3);
        assert!(existing.contains(&801));
        assert!(existing.contains(&802));
        assert!(existing.contains(&803));

        let empty = db
            .get_existing_comment_ids(999)
            .expect("get for nonexistent pr failed");
        assert_eq!(empty.len(), 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_pr_last_polled_lifecycle() {
        let (db, path) = make_test_db("pr_last_polled");
        insert_test_task(&db);

        db.insert_pull_request(
            60,
            "T-100",
            "acme",
            "repo",
            "PR",
            "https://example.com",
            "open",
            1000,
            1000,
        )
        .expect("insert pr failed");

        let initial = db.get_pr_last_polled(60).expect("get initial failed");
        assert_eq!(initial, Some(0));

        db.set_pr_last_polled(60, 1700000000)
            .expect("set last polled failed");

        let updated = db.get_pr_last_polled(60).expect("get updated failed");
        assert_eq!(updated, Some(1700000000));

        let nonexistent = db.get_pr_last_polled(999).expect("get nonexistent failed");
        assert_eq!(nonexistent, None);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_insert_pr_comment_with_addressed() {
        let (db, path) = make_test_db("pr_comment_addressed");
        insert_test_task(&db);

        db.insert_pull_request(
            100,
            "T-100",
            "acme",
            "repo",
            "PR title",
            "https://example.com",
            "open",
            1000,
            1000,
        )
        .expect("insert pr failed");

        db.insert_pr_comment(
            701,
            100,
            "bot-user",
            "Automated check passed",
            "review_comment",
            None,
            None,
            true,
            2000,
        )
        .expect("insert addressed comment failed");

        db.insert_pr_comment(
            702,
            100,
            "human-reviewer",
            "Please fix this",
            "review_comment",
            None,
            None,
            false,
            2001,
        )
        .expect("insert unaddressed comment failed");

        let comments = db.get_comments_for_pr(100).expect("get comments failed");
        assert_eq!(comments.len(), 2);
        assert_eq!(comments[0].id, 701);
        assert_eq!(comments[0].addressed, 1);
        assert_eq!(comments[1].id, 702);
        assert_eq!(comments[1].addressed, 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_unaddressed_comment_count_subquery() {
        let (db, path) = make_test_db("unaddressed_count");
        insert_test_task(&db);

        db.insert_pull_request(
            101,
            "T-100",
            "acme",
            "repo",
            "PR 1",
            "https://example.com/1",
            "open",
            1000,
            1000,
        )
        .expect("insert pr 1 failed");

        db.insert_pr_comment(
            711,
            101,
            "bot",
            "Check passed",
            "review_comment",
            None,
            None,
            true,
            2000,
        )
        .expect("insert comment 1 failed");
        db.insert_pr_comment(
            712,
            101,
            "reviewer",
            "Fix this",
            "review_comment",
            None,
            None,
            false,
            2001,
        )
        .expect("insert comment 2 failed");
        db.insert_pr_comment(
            713,
            101,
            "reviewer",
            "Also fix that",
            "review_comment",
            None,
            None,
            false,
            2002,
        )
        .expect("insert comment 3 failed");

        db.insert_pull_request(
            102,
            "T-100",
            "acme",
            "repo",
            "PR 2",
            "https://example.com/2",
            "open",
            1000,
            1000,
        )
        .expect("insert pr 2 failed");

        let prs = db.get_all_pull_requests().expect("get prs failed");
        let pr1 = prs.iter().find(|p| p.id == 101).expect("pr 1 not found");
        let pr2 = prs.iter().find(|p| p.id == 102).expect("pr 2 not found");

        assert_eq!(pr1.unaddressed_comment_count, 2);
        assert_eq!(pr2.unaddressed_comment_count, 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_retroactive_bot_migration() {
        let (db, path) = make_test_db("bot_migration");
        insert_test_task(&db);

        db.insert_pull_request(
            103,
            "T-100",
            "acme",
            "repo",
            "PR title",
            "https://example.com",
            "open",
            1000,
            1000,
        )
        .expect("insert pr failed");

        db.insert_pr_comment(
            721,
            103,
            "dependabot[bot]",
            "Dependency update",
            "review_comment",
            None,
            None,
            false,
            2000,
        )
        .expect("insert dependabot comment failed");
        db.insert_pr_comment(
            722,
            103,
            "codecov[bot]",
            "Coverage report",
            "review_comment",
            None,
            None,
            false,
            2001,
        )
        .expect("insert codecov comment failed");
        db.insert_pr_comment(
            723,
            103,
            "renovate[bot]",
            "Renovate update",
            "review_comment",
            None,
            None,
            false,
            2002,
        )
        .expect("insert renovate comment failed");
        db.insert_pr_comment(
            724,
            103,
            "human-reviewer",
            "Please fix this",
            "review_comment",
            None,
            None,
            false,
            2003,
        )
        .expect("insert human comment failed");

        let conn = db.conn.lock().unwrap();
        conn.execute(
            "UPDATE pr_comments SET addressed = 1 WHERE author LIKE '%[bot]%' AND addressed = 0",
            [],
        )
        .expect("migration failed");
        drop(conn);

        let comments = db.get_comments_for_pr(103).expect("get comments failed");
        assert_eq!(comments.len(), 4);

        let dependabot = comments
            .iter()
            .find(|c| c.id == 721)
            .expect("dependabot not found");
        let codecov = comments
            .iter()
            .find(|c| c.id == 722)
            .expect("codecov not found");
        let renovate = comments
            .iter()
            .find(|c| c.id == 723)
            .expect("renovate not found");
        let human = comments
            .iter()
            .find(|c| c.id == 724)
            .expect("human not found");

        assert_eq!(dependabot.addressed, 1);
        assert_eq!(codecov.addressed, 1);
        assert_eq!(renovate.addressed, 1);
        assert_eq!(human.addressed, 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
