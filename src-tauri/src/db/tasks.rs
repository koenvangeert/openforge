use rusqlite::Result;
use serde::Serialize;

/// Task row from database
#[derive(Debug, Clone, Serialize)]
pub struct TaskRow {
    pub id: String,
    pub title: String,
    pub status: String,
    pub jira_key: Option<String>,
    pub jira_title: Option<String>,
    pub jira_status: Option<String>,
    pub jira_assignee: Option<String>,
    pub plan_text: Option<String>,
    pub project_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub jira_description: Option<String>,
}

impl super::Database {
    /// Get all tasks for a project
    pub fn get_tasks_for_project(&self, project_id: &str) -> Result<Vec<TaskRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, status, jira_key, jira_title, jira_status, jira_assignee, plan_text, project_id, created_at, updated_at, jira_description 
             FROM tasks WHERE project_id = ?1 ORDER BY updated_at DESC",
        )?;

        let tasks = stmt.query_map([project_id], |row| {
            Ok(TaskRow {
                id: row.get(0)?,
                title: row.get(1)?,
                status: row.get(2)?,
                jira_key: row.get(3)?,
                jira_title: row.get(4)?,
                jira_status: row.get(5)?,
                jira_assignee: row.get(6)?,
                plan_text: row.get(7)?,
                project_id: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                jira_description: row.get(11)?,
            })
        })?;

        let mut result = Vec::new();
        for task in tasks {
            result.push(task?);
        }
        Ok(result)
    }

    pub fn create_task(
        &self,
        title: &str,
        status: &str,
        jira_key: Option<&str>,
        project_id: Option<&str>,
        plan_text: Option<&str>,
    ) -> Result<TaskRow> {
        let conn = self.conn.lock().unwrap();

        let next_id: i64 = conn.query_row(
            "SELECT value FROM config WHERE key = 'next_task_id'",
            [],
            |row| {
                let val: String = row.get(0)?;
                Ok(val.parse::<i64>().unwrap_or(1))
            },
        )?;

        let task_id = format!("T-{}", next_id);

        conn.execute(
            "UPDATE config SET value = ?1 WHERE key = 'next_task_id'",
            [&(next_id + 1).to_string()],
        )?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO tasks (id, title, status, jira_key, jira_title, jira_status, jira_assignee, plan_text, project_id, created_at, updated_at, jira_description)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![
                &task_id,
                title,
                status,
                jira_key,
                None::<String>,
                None::<String>,
                None::<String>,
                plan_text,
                project_id,
                now,
                now,
                None::<String>,
            ],
        )?;

        Ok(TaskRow {
            id: task_id,
            title: title.to_string(),
            status: status.to_string(),
            jira_key: jira_key.map(|s| s.to_string()),
            jira_title: None,
            jira_status: None,
            jira_assignee: None,
            plan_text: plan_text.map(|s| s.to_string()),
            project_id: project_id.map(|s| s.to_string()),
            created_at: now,
            updated_at: now,
            jira_description: None,
        })
    }

    pub fn get_all_tasks(&self) -> Result<Vec<TaskRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, status, jira_key, jira_title, jira_status, jira_assignee, plan_text, project_id, created_at, updated_at, jira_description 
             FROM tasks ORDER BY updated_at DESC"
        )?;

        let tasks = stmt.query_map([], |row| {
            Ok(TaskRow {
                id: row.get(0)?,
                title: row.get(1)?,
                status: row.get(2)?,
                jira_key: row.get(3)?,
                jira_title: row.get(4)?,
                jira_status: row.get(5)?,
                jira_assignee: row.get(6)?,
                plan_text: row.get(7)?,
                project_id: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                jira_description: row.get(11)?,
            })
        })?;

        let mut result = Vec::new();
        for task in tasks {
            result.push(task?);
        }
        Ok(result)
    }

    pub fn get_task(&self, id: &str) -> Result<Option<TaskRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, status, jira_key, jira_title, jira_status, jira_assignee, plan_text, project_id, created_at, updated_at, jira_description 
             FROM tasks WHERE id = ?1"
        )?;
        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(TaskRow {
                id: row.get(0)?,
                title: row.get(1)?,
                status: row.get(2)?,
                jira_key: row.get(3)?,
                jira_title: row.get(4)?,
                jira_status: row.get(5)?,
                jira_assignee: row.get(6)?,
                plan_text: row.get(7)?,
                project_id: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                jira_description: row.get(11)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn update_task(&self, id: &str, title: &str, jira_key: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE tasks SET title = ?1, jira_key = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![title, jira_key, now, id],
        )?;
        Ok(())
    }

    pub fn update_task_status(&self, id: &str, status: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE tasks SET status = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![status, now, id],
        )?;
        Ok(())
    }

    /// Delete a task and all associated data (sessions, logs, PRs, comments, worktrees, reviews).
    ///
    /// Wrapped in a transaction so all-or-nothing: if any step fails the DB stays consistent.
    ///
    /// # Arguments
    /// * `id` - Task ID to delete
    pub fn delete_task(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| -> Result<()> {
            conn.execute("DELETE FROM agent_logs WHERE session_id IN (SELECT id FROM agent_sessions WHERE ticket_id = ?1)", rusqlite::params![id])?;
            conn.execute(
                "DELETE FROM agent_sessions WHERE ticket_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute("DELETE FROM pr_comments WHERE pr_id IN (SELECT id FROM pull_requests WHERE ticket_id = ?1)", rusqlite::params![id])?;
            conn.execute(
                "DELETE FROM pull_requests WHERE ticket_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute(
                "DELETE FROM self_review_comments WHERE task_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute(
                "DELETE FROM worktrees WHERE task_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute("DELETE FROM tasks WHERE id = ?1", rusqlite::params![id])?;
            Ok(())
        })();
        match result {
            Ok(()) => {
                conn.execute_batch("COMMIT")?;
                Ok(())
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    /// Get all task IDs with the given status for a specific project.
    ///
    /// # Arguments
    /// * `project_id` - Project to scope the query to
    /// * `status` - Task status to filter by (e.g. "done")
    pub fn get_task_ids_by_status(&self, project_id: &str, status: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT id FROM tasks WHERE project_id = ?1 AND status = ?2")?;
        let ids = stmt.query_map(rusqlite::params![project_id, status], |row| row.get(0))?;
        let mut result = Vec::new();
        for id in ids {
            result.push(id?);
        }
        Ok(result)
    }

    pub fn update_task_jira_info(
        &self,
        jira_key: &str,
        jira_title: &str,
        jira_status: &str,
        jira_assignee: &str,
        jira_description: &str,
    ) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE tasks SET jira_title = ?1, jira_status = ?2, jira_assignee = ?3, jira_description = ?4, updated_at = ?5 WHERE jira_key = ?6",
            rusqlite::params![jira_title, jira_status, jira_assignee, jira_description, now, jira_key],
        )?;
        Ok(conn.changes() as usize)
    }

    pub fn get_tasks_with_jira_links(&self) -> Result<Vec<TaskRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, status, jira_key, jira_title, jira_status, jira_assignee, plan_text, project_id, created_at, updated_at, jira_description 
             FROM tasks WHERE jira_key IS NOT NULL ORDER BY updated_at DESC"
        )?;

        let tasks = stmt.query_map([], |row| {
            Ok(TaskRow {
                id: row.get(0)?,
                title: row.get(1)?,
                status: row.get(2)?,
                jira_key: row.get(3)?,
                jira_title: row.get(4)?,
                jira_status: row.get(5)?,
                jira_assignee: row.get(6)?,
                plan_text: row.get(7)?,
                project_id: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                jira_description: row.get(11)?,
            })
        })?;

        let mut result = Vec::new();
        for task in tasks {
            result.push(task?);
        }
        Ok(result)
    }

    pub fn get_task_ids_and_jira_keys(&self) -> Result<Vec<(String, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, jira_key FROM tasks")?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn get_all_task_ids(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id FROM tasks")?;
        let ids = stmt.query_map([], |row| row.get(0))?;
        let mut result = Vec::new();
        for id in ids {
            result.push(id?);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::fs;

    #[test]
    fn test_create_task_and_retrieve() {
        let (db, path) = make_test_db("create_task");

        let task = db
            .create_task("My task", "backlog", None, None, None)
            .expect("create failed");

        assert_eq!(task.id, "T-1");
        assert_eq!(task.title, "My task");
        assert_eq!(task.status, "backlog");

        let tasks = db.get_all_tasks().expect("get_all failed");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "T-1");
        assert_eq!(tasks[0].title, "My task");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_update_task() {
        let (db, path) = make_test_db("update_task");

        let task = db
            .create_task("Original", "backlog", None, None, None)
            .expect("create failed");

        db.update_task(&task.id, "Updated", None)
            .expect("update failed");

        let tasks = db.get_all_tasks().expect("get_all failed");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "Updated");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_get_task_by_id() {
        let (db, path) = make_test_db("get_task_by_id");

        let task = db
            .create_task("Found me", "backlog", None, None, None)
            .expect("create failed");

        let retrieved = db.get_task(&task.id).expect("get failed");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().title, "Found me");

        let missing = db.get_task("T-999").expect("get failed");
        assert!(missing.is_none());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_autoincrement() {
        let (db, path) = make_test_db("task_autoincrement");

        let task1 = db
            .create_task("Task 1", "backlog", None, None, None)
            .expect("create 1 failed");
        let task2 = db
            .create_task("Task 2", "backlog", None, None, None)
            .expect("create 2 failed");
        let task3 = db
            .create_task("Task 3", "backlog", None, None, None)
            .expect("create 3 failed");

        assert_eq!(task1.id, "T-1");
        assert_eq!(task2.id, "T-2");
        assert_eq!(task3.id, "T-3");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_update_task_status() {
        let (db, path) = make_test_db("update_task_status");

        let task = db
            .create_task("My task", "backlog", None, None, None)
            .expect("create failed");

        db.update_task_status(&task.id, "doing")
            .expect("update status failed");

        let updated = db.get_task(&task.id).expect("get failed").unwrap();
        assert_eq!(updated.status, "doing");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_update_task_jira_info() {
        let (db, path) = make_test_db("update_jira_info");

        db.create_task("Linked task", "backlog", Some("PROJ-1"), None, None)
            .expect("create 1 failed");
        db.create_task("Unlinked task", "backlog", None, None, None)
            .expect("create 2 failed");

        let updated = db
            .update_task_jira_info(
                "PROJ-1",
                "JIRA Title",
                "In Progress",
                "bob",
                "This is a test description",
            )
            .expect("update jira info failed");

        assert_eq!(updated, 1);

        let tasks = db.get_all_tasks().expect("get all failed");
        let linked = tasks.iter().find(|t| t.jira_key.is_some()).unwrap();
        assert_eq!(linked.jira_title, Some("JIRA Title".to_string()));
        assert_eq!(linked.jira_status, Some("In Progress".to_string()));
        assert_eq!(linked.jira_assignee, Some("bob".to_string()));
        assert_eq!(
            linked.jira_description,
            Some("This is a test description".to_string())
        );

        let unlinked = tasks.iter().find(|t| t.jira_key.is_none()).unwrap();
        assert_eq!(unlinked.jira_title, None);
        assert_eq!(unlinked.jira_status, None);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_get_tasks_with_jira_links() {
        let (db, path) = make_test_db("tasks_with_jira");

        db.create_task("Task 1", "backlog", Some("PROJ-1"), None, None)
            .expect("create 1 failed");
        db.create_task("Task 2", "backlog", Some("PROJ-2"), None, None)
            .expect("create 2 failed");
        db.create_task("Task 3", "backlog", None, None, None)
            .expect("create 3 failed");

        let linked = db.get_tasks_with_jira_links().expect("get linked failed");
        assert_eq!(linked.len(), 2);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_jira_description_null_handling() {
        let (db, path) = make_test_db("jira_desc_null");

        db.create_task("Task with jira", "backlog", Some("PROJ-1"), None, None)
            .expect("create task failed");

        let task = db.get_task("T-1").expect("get failed").unwrap();
        assert_eq!(task.jira_description, None);

        db.update_task_jira_info("PROJ-1", "Title", "To Do", "alice", "")
            .expect("update with empty desc failed");

        let task = db.get_task("T-1").expect("get failed").unwrap();
        assert_eq!(task.jira_description, Some("".to_string()));

        db.update_task_jira_info(
            "PROJ-1",
            "Title",
            "In Progress",
            "bob",
            "<p>Test description</p>",
        )
        .expect("update with html desc failed");

        let task = db.get_task("T-1").expect("get failed").unwrap();
        assert_eq!(
            task.jira_description,
            Some("<p>Test description</p>".to_string())
        );

        let multiline = "Line 1\nLine 2\nLine 3";
        db.update_task_jira_info("PROJ-1", "Title", "Done", "charlie", multiline)
            .expect("update with multiline desc failed");

        let task = db.get_task("T-1").expect("get failed").unwrap();
        assert_eq!(task.jira_description, Some(multiline.to_string()));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_delete_task_basic() {
        let (db, path) = make_test_db("delete_task_basic");

        let task = db
            .create_task("Deletable", "backlog", None, None, None)
            .expect("create failed");
        let tasks = db.get_all_tasks().expect("get failed");
        assert_eq!(tasks.len(), 1);

        db.delete_task(&task.id).expect("delete failed");

        let tasks = db.get_all_tasks().expect("get failed");
        assert_eq!(tasks.len(), 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_delete_task_with_children() {
        let (db, path) = make_test_db("delete_task_children");
        insert_test_task(&db);

        db.create_agent_session("ses-del", "T-100", None, "implement", "running")
            .expect("create session failed");
        db.insert_agent_log("ses-del", "info", "log entry")
            .expect("add log failed");

        db.insert_pull_request(
            99,
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
            501,
            99,
            "reviewer",
            "Fix this",
            "review",
            Some("main.rs"),
            Some(10),
            false,
            1000,
        )
        .expect("insert comment failed");

        db.insert_self_review_comment("T-100", "issue", Some("main.rs"), Some(5), "Looks wrong")
            .expect("insert self review failed");

        db.delete_task("T-100").expect("delete failed");

        let task = db.get_task("T-100").expect("get failed");
        assert!(task.is_none());

        let sessions = db
            .get_latest_session_for_ticket("T-100")
            .expect("get session failed");
        assert!(sessions.is_none());

        let comments = db
            .get_active_self_review_comments("T-100")
            .expect("get self review failed");
        assert!(comments.is_empty());

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
