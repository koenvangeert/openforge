use rusqlite::Result;
use serde::Serialize;

/// Self review comment row from database
#[derive(Debug, Clone, Serialize)]
pub struct SelfReviewCommentRow {
    pub id: i64,
    pub task_id: String,
    pub round: i32,
    pub comment_type: String,
    pub file_path: Option<String>,
    pub line_number: Option<i32>,
    pub body: String,
    pub created_at: i64,
    pub archived_at: Option<i64>,
}

impl super::Database {
    /// Insert a self review comment. Automatically determines round based on max active round for task.
    pub fn insert_self_review_comment(
        &self,
        task_id: &str,
        comment_type: &str,
        file_path: Option<&str>,
        line_number: Option<i32>,
        body: &str,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;

        // Determine round: if there are active comments, use their round; otherwise use max archived round + 1
        let active_round: Option<i32> = conn.query_row(
            "SELECT MAX(round) FROM self_review_comments WHERE task_id = ?1 AND archived_at IS NULL",
            [task_id],
            |row| row.get(0),
        ).ok();

        let round = if let Some(r) = active_round {
            r
        } else {
            // No active comments, check max archived round
            let max_archived: Option<i32> = conn.query_row(
                "SELECT MAX(round) FROM self_review_comments WHERE task_id = ?1 AND archived_at IS NOT NULL",
                [task_id],
                |row| row.get(0),
            ).ok();
            max_archived.unwrap_or(0) + 1
        };

        conn.execute(
            "INSERT INTO self_review_comments (task_id, round, comment_type, file_path, line_number, body, created_at, archived_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)",
            rusqlite::params![task_id, round, comment_type, file_path, line_number, body, now],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Get all active (non-archived) self review comments for a task, ordered by creation time.
    pub fn get_active_self_review_comments(
        &self,
        task_id: &str,
    ) -> Result<Vec<SelfReviewCommentRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, task_id, round, comment_type, file_path, line_number, body, created_at, archived_at
             FROM self_review_comments
             WHERE task_id = ?1 AND archived_at IS NULL
             ORDER BY created_at ASC",
        )?;

        let comments = stmt.query_map([task_id], |row| {
            Ok(SelfReviewCommentRow {
                id: row.get(0)?,
                task_id: row.get(1)?,
                round: row.get(2)?,
                comment_type: row.get(3)?,
                file_path: row.get(4)?,
                line_number: row.get(5)?,
                body: row.get(6)?,
                created_at: row.get(7)?,
                archived_at: row.get(8)?,
            })
        })?;

        let mut result = Vec::new();
        for comment in comments {
            result.push(comment?);
        }
        Ok(result)
    }

    /// Get archived self review comments for a task. Returns only the latest archived round, ordered by creation time.
    pub fn get_archived_self_review_comments(
        &self,
        task_id: &str,
    ) -> Result<Vec<SelfReviewCommentRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, task_id, round, comment_type, file_path, line_number, body, created_at, archived_at
             FROM self_review_comments
             WHERE task_id = ?1 AND archived_at IS NOT NULL
             AND round = (SELECT MAX(round) FROM self_review_comments WHERE task_id = ?1 AND archived_at IS NOT NULL)
             ORDER BY created_at ASC",
        )?;

        let comments = stmt.query_map([task_id], |row| {
            Ok(SelfReviewCommentRow {
                id: row.get(0)?,
                task_id: row.get(1)?,
                round: row.get(2)?,
                comment_type: row.get(3)?,
                file_path: row.get(4)?,
                line_number: row.get(5)?,
                body: row.get(6)?,
                created_at: row.get(7)?,
                archived_at: row.get(8)?,
            })
        })?;

        let mut result = Vec::new();
        for comment in comments {
            result.push(comment?);
        }
        Ok(result)
    }

    /// Delete a self review comment by ID.
    pub fn delete_self_review_comment(&self, comment_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM self_review_comments WHERE id = ?1",
            [comment_id],
        )?;
        Ok(())
    }

    /// Archive all active comments for a task by setting archived_at to current time.
    pub fn archive_self_review_comments(&self, task_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;

        conn.execute(
            "UPDATE self_review_comments SET archived_at = ?1 WHERE task_id = ?2 AND archived_at IS NULL",
            rusqlite::params![now, task_id],
        )?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::fs;

    #[test]
    fn test_self_review_comment_insert_and_retrieve() {
        let (db, path) = make_test_db("self_review_insert");
        insert_test_task(&db);

        let id1 = db
            .insert_self_review_comment("T-100", "general", None, None, "First comment")
            .expect("insert 1 failed");
        let id2 = db
            .insert_self_review_comment(
                "T-100",
                "file_specific",
                Some("src/main.rs"),
                Some(42),
                "Fix this line",
            )
            .expect("insert 2 failed");

        assert!(id1 > 0);
        assert!(id2 > id1);

        let comments = db
            .get_active_self_review_comments("T-100")
            .expect("get active failed");
        assert_eq!(comments.len(), 2);
        assert_eq!(comments[0].id, id1);
        assert_eq!(comments[0].body, "First comment");
        assert_eq!(comments[0].round, 1);
        assert_eq!(comments[0].archived_at, None);
        assert_eq!(comments[1].id, id2);
        assert_eq!(comments[1].file_path, Some("src/main.rs".to_string()));
        assert_eq!(comments[1].line_number, Some(42));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_self_review_comment_round_tracking() {
        let (db, path) = make_test_db("self_review_rounds");
        insert_test_task(&db);

        let _id1 = db
            .insert_self_review_comment("T-100", "general", None, None, "Round 1 comment 1")
            .expect("insert 1 failed");
        let _id2 = db
            .insert_self_review_comment("T-100", "general", None, None, "Round 1 comment 2")
            .expect("insert 2 failed");

        let comments = db
            .get_active_self_review_comments("T-100")
            .expect("get active 1 failed");
        assert_eq!(comments.len(), 2);
        assert_eq!(comments[0].round, 1);
        assert_eq!(comments[1].round, 1);

        db.archive_self_review_comments("T-100")
            .expect("archive failed");

        let active = db
            .get_active_self_review_comments("T-100")
            .expect("get active 2 failed");
        assert_eq!(active.len(), 0);

        let archived = db
            .get_archived_self_review_comments("T-100")
            .expect("get archived failed");
        assert_eq!(archived.len(), 2);
        assert_eq!(archived[0].round, 1);
        assert!(archived[0].archived_at.is_some());

        let _id3 = db
            .insert_self_review_comment("T-100", "general", None, None, "Round 2 comment 1")
            .expect("insert 3 failed");

        let active2 = db
            .get_active_self_review_comments("T-100")
            .expect("get active 3 failed");
        assert_eq!(active2.len(), 1);
        assert_eq!(active2[0].round, 2);
        assert_eq!(active2[0].body, "Round 2 comment 1");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_self_review_comment_delete() {
        let (db, path) = make_test_db("self_review_delete");
        insert_test_task(&db);

        let id1 = db
            .insert_self_review_comment("T-100", "general", None, None, "Comment 1")
            .expect("insert 1 failed");
        let id2 = db
            .insert_self_review_comment("T-100", "general", None, None, "Comment 2")
            .expect("insert 2 failed");

        let comments = db
            .get_active_self_review_comments("T-100")
            .expect("get before delete failed");
        assert_eq!(comments.len(), 2);

        db.delete_self_review_comment(id1).expect("delete failed");

        let comments = db
            .get_active_self_review_comments("T-100")
            .expect("get after delete failed");
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, id2);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_self_review_comment_archive_flow() {
        let (db, path) = make_test_db("self_review_archive");
        insert_test_task(&db);

        db.insert_self_review_comment("T-100", "general", None, None, "Comment 1")
            .expect("insert 1 failed");
        db.insert_self_review_comment("T-100", "general", None, None, "Comment 2")
            .expect("insert 2 failed");

        let active = db
            .get_active_self_review_comments("T-100")
            .expect("get active 1 failed");
        assert_eq!(active.len(), 2);
        assert!(active[0].archived_at.is_none());

        db.archive_self_review_comments("T-100")
            .expect("archive failed");

        let active = db
            .get_active_self_review_comments("T-100")
            .expect("get active 2 failed");
        assert_eq!(active.len(), 0);

        let archived = db
            .get_archived_self_review_comments("T-100")
            .expect("get archived failed");
        assert_eq!(archived.len(), 2);
        assert!(archived[0].archived_at.is_some());
        assert!(archived[1].archived_at.is_some());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_self_review_comment_latest_archived_round_only() {
        let (db, path) = make_test_db("self_review_latest_round");
        insert_test_task(&db);

        db.insert_self_review_comment("T-100", "general", None, None, "Round 1 comment 1")
            .expect("insert r1c1 failed");
        db.insert_self_review_comment("T-100", "general", None, None, "Round 1 comment 2")
            .expect("insert r1c2 failed");

        db.archive_self_review_comments("T-100")
            .expect("archive 1 failed");

        db.insert_self_review_comment("T-100", "general", None, None, "Round 2 comment 1")
            .expect("insert r2c1 failed");
        db.insert_self_review_comment("T-100", "general", None, None, "Round 2 comment 2")
            .expect("insert r2c2 failed");

        db.archive_self_review_comments("T-100")
            .expect("archive 2 failed");

        let archived = db
            .get_archived_self_review_comments("T-100")
            .expect("get archived failed");
        assert_eq!(archived.len(), 2);
        assert_eq!(archived[0].round, 2);
        assert_eq!(archived[1].round, 2);
        assert_eq!(archived[0].body, "Round 2 comment 1");
        assert_eq!(archived[1].body, "Round 2 comment 2");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_self_review_comment_empty_task() {
        let (db, path) = make_test_db("self_review_empty");
        insert_test_task(&db);

        let active = db
            .get_active_self_review_comments("T-100")
            .expect("get active failed");
        assert_eq!(active.len(), 0);

        let archived = db
            .get_archived_self_review_comments("T-100")
            .expect("get archived failed");
        assert_eq!(archived.len(), 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_self_review_comment_multiple_tasks() {
        let (db, path) = make_test_db("self_review_multi_task");
        insert_test_task(&db);

        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, initial_prompt, status, project_id, created_at, updated_at, prompt, summary) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params!["T-200", "Test task 2", "backlog", None::<String>, 1000, 1000, "Test task 2", None::<String>],
        ).expect("Failed to insert test task T-200");
        drop(conn);

        db.insert_self_review_comment("T-100", "general", None, None, "Task 100 comment 1")
            .expect("insert t100c1 failed");
        db.insert_self_review_comment("T-100", "general", None, None, "Task 100 comment 2")
            .expect("insert t100c2 failed");
        db.insert_self_review_comment("T-200", "general", None, None, "Task 200 comment 1")
            .expect("insert t200c1 failed");

        let comments_100 = db
            .get_active_self_review_comments("T-100")
            .expect("get t100 failed");
        assert_eq!(comments_100.len(), 2);
        assert!(comments_100.iter().all(|c| c.task_id == "T-100"));

        let comments_200 = db
            .get_active_self_review_comments("T-200")
            .expect("get t200 failed");
        assert_eq!(comments_200.len(), 1);
        assert_eq!(comments_200[0].task_id, "T-200");

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
