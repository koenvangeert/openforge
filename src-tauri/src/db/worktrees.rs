use rusqlite::Result;
use serde::Serialize;

/// Worktree row from database
#[derive(Debug, Clone, Serialize)]
pub struct WorktreeRow {
    pub id: i64,
    pub task_id: String,
    pub project_id: String,
    pub repo_path: String,
    pub worktree_path: String,
    pub branch_name: String,
    pub opencode_port: Option<i64>,
    pub opencode_pid: Option<i64>,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl super::Database {
    /// Create a worktree record
    pub fn create_worktree_record(
        &self,
        task_id: &str,
        project_id: &str,
        repo_path: &str,
        worktree_path: &str,
        branch_name: &str,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO worktrees (task_id, project_id, repo_path, worktree_path, branch_name, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7)",
            rusqlite::params![task_id, project_id, repo_path, worktree_path, branch_name, now, now],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Get worktree for a task
    pub fn get_worktree_for_task(&self, task_id: &str) -> Result<Option<WorktreeRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, task_id, project_id, repo_path, worktree_path, branch_name, opencode_port, opencode_pid, status, created_at, updated_at
             FROM worktrees WHERE task_id = ?1",
        )?;
        let mut rows = stmt.query([task_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(WorktreeRow {
                id: row.get(0)?,
                task_id: row.get(1)?,
                project_id: row.get(2)?,
                repo_path: row.get(3)?,
                worktree_path: row.get(4)?,
                branch_name: row.get(5)?,
                opencode_port: row.get(6)?,
                opencode_pid: row.get(7)?,
                status: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// Update worktree server info
    pub fn update_worktree_server(&self, task_id: &str, port: i64, pid: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE worktrees SET opencode_port = ?1, opencode_pid = ?2, updated_at = ?3 WHERE task_id = ?4",
            rusqlite::params![port, pid, now, task_id],
        )?;
        Ok(())
    }

    /// Update worktree status
    pub fn update_worktree_status(&self, task_id: &str, status: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE worktrees SET status = ?1, updated_at = ?2 WHERE task_id = ?3",
            rusqlite::params![status, now, task_id],
        )?;
        Ok(())
    }

    /// Delete a worktree record
    pub fn delete_worktree_record(&self, task_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM worktrees WHERE task_id = ?1",
            rusqlite::params![task_id],
        )?;
        Ok(())
    }

    /// Get all active worktrees
    pub fn get_active_worktrees(&self) -> Result<Vec<WorktreeRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, task_id, project_id, repo_path, worktree_path, branch_name, opencode_port, opencode_pid, status, created_at, updated_at
             FROM worktrees WHERE status = 'active' ORDER BY updated_at DESC",
        )?;

        let worktrees = stmt.query_map([], |row| {
            Ok(WorktreeRow {
                id: row.get(0)?,
                task_id: row.get(1)?,
                project_id: row.get(2)?,
                repo_path: row.get(3)?,
                worktree_path: row.get(4)?,
                branch_name: row.get(5)?,
                opencode_port: row.get(6)?,
                opencode_pid: row.get(7)?,
                status: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;

        let mut result = Vec::new();
        for worktree in worktrees {
            result.push(worktree?);
        }
        Ok(result)
    }

    /// Get worktrees that need OpenCode server restart on app startup.
    /// Returns active worktrees for non-done tasks that have at least one agent session
    /// (i.e., tasks that previously had agent work in progress).
    pub fn get_resumable_worktrees(&self) -> Result<Vec<WorktreeRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT w.id, w.task_id, w.project_id, w.repo_path, w.worktree_path,
                    w.branch_name, w.opencode_port, w.opencode_pid, w.status, w.created_at, w.updated_at
             FROM worktrees w
             INNER JOIN tasks t ON w.task_id = t.id
             INNER JOIN agent_sessions a ON w.task_id = a.ticket_id
             WHERE w.status = 'active' AND t.status = 'doing'
             ORDER BY w.updated_at DESC",
        )?;

        let worktrees = stmt.query_map([], |row| {
            Ok(WorktreeRow {
                id: row.get(0)?,
                task_id: row.get(1)?,
                project_id: row.get(2)?,
                repo_path: row.get(3)?,
                worktree_path: row.get(4)?,
                branch_name: row.get(5)?,
                opencode_port: row.get(6)?,
                opencode_pid: row.get(7)?,
                status: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;

        let mut result = Vec::new();
        for worktree in worktrees {
            result.push(worktree?);
        }
        Ok(result)
    }

    /// Clear stale OpenCode server port/pid from all worktrees on app startup
    pub fn clear_stale_worktree_servers(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE worktrees SET opencode_port = NULL, opencode_pid = NULL, updated_at = ?1 WHERE opencode_port IS NOT NULL",
            rusqlite::params![now],
        )?;
        Ok(conn.changes() as usize)
    }

    /// Get project_id for a given worktree path.
    /// Used by create_task to deduce the project when an agent creates a subtask.
    pub fn get_project_for_worktree(&self, worktree_path: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT project_id FROM worktrees WHERE worktree_path = ?1 LIMIT 1")?;
        let mut rows = stmt.query([worktree_path])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::fs;

    #[test]
    fn test_clear_stale_worktree_servers() {
        let (db, path) = make_test_db("clear_stale_servers");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create project failed");

        insert_test_task(&db);

        db.create_worktree_record("T-100", &project.id, "/tmp/repo", "/tmp/wt1", "branch-1")
            .expect("create wt1 failed");
        db.update_worktree_server("T-100", 12345, 0)
            .expect("set port 1 failed");

        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, initial_prompt, status, jira_key, jira_title, jira_status, jira_assignee, project_id, created_at, updated_at, jira_description, prompt, summary) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            rusqlite::params!["T-200", "Test task 2", "backlog", "PROJ-200", "Task 2 summary", "To Do", "bob", None::<String>, 1000, 1000, None::<String>, "Test task 2", None::<String>],
        ).expect("Failed to insert test task T-200");
        drop(conn);

        db.create_worktree_record("T-200", &project.id, "/tmp/repo", "/tmp/wt2", "branch-2")
            .expect("create wt2 failed");
        db.update_worktree_server("T-200", 54321, 0)
            .expect("set port 2 failed");

        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, initial_prompt, status, jira_key, jira_title, jira_status, jira_assignee, project_id, created_at, updated_at, jira_description, prompt, summary) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            rusqlite::params!["T-300", "Test task 3", "backlog", "PROJ-300", "Task 3 summary", "To Do", "charlie", None::<String>, 1000, 1000, None::<String>, "Test task 3", None::<String>],
        ).expect("Failed to insert test task T-300");
        drop(conn);

        db.create_worktree_record("T-300", &project.id, "/tmp/repo", "/tmp/wt3", "branch-3")
            .expect("create wt3 failed");

        let count = db
            .clear_stale_worktree_servers()
            .expect("clear_stale_worktree_servers failed");
        assert_eq!(count, 2);

        let wt1 = db
            .get_worktree_for_task("T-100")
            .expect("get wt1 failed")
            .expect("wt1 not found");
        assert_eq!(wt1.opencode_port, None);
        assert_eq!(wt1.opencode_pid, None);

        let wt2 = db
            .get_worktree_for_task("T-200")
            .expect("get wt2 failed")
            .expect("wt2 not found");
        assert_eq!(wt2.opencode_port, None);
        assert_eq!(wt2.opencode_pid, None);

        let wt3 = db
            .get_worktree_for_task("T-300")
            .expect("get wt3 failed")
            .expect("wt3 not found");
        assert_eq!(wt3.opencode_port, None);

        let count2 = db
            .clear_stale_worktree_servers()
            .expect("second call failed");
        assert_eq!(count2, 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_get_resumable_worktrees_only_doing_tasks() {
        let (db, path) = make_test_db("resumable_worktrees_doing");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create project failed");

        // Insert a "doing" task with active worktree and agent session — should be resumable
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
             "INSERT INTO tasks (id, initial_prompt, status, jira_key, jira_title, jira_status, jira_assignee, project_id, created_at, updated_at, jira_description, prompt, summary) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
             rusqlite::params!["T-1", "Doing task", "doing", "PROJ-1", "Summary", "In Progress", "alice", None::<String>, 1000, 1000, None::<String>, "Doing task", None::<String>],
         ).expect("insert T-1");
        drop(conn);

        db.create_worktree_record("T-1", &project.id, "/tmp/repo", "/tmp/wt1", "branch-1")
            .expect("create wt1");
        db.create_agent_session(
            "sess-1",
            "T-1",
            None,
            "implementing",
            "interrupted",
            "claude-code",
        )
        .expect("create session 1");

        // Insert a "backlog" task with active worktree and agent session — should NOT be resumable
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
             "INSERT INTO tasks (id, initial_prompt, status, jira_key, jira_title, jira_status, jira_assignee, project_id, created_at, updated_at, jira_description, prompt, summary) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
             rusqlite::params!["T-2", "Backlog task", "backlog", "PROJ-2", "Summary", "To Do", "bob", None::<String>, 1000, 1000, None::<String>, "Backlog task", None::<String>],
         ).expect("insert T-2");
        drop(conn);

        db.create_worktree_record("T-2", &project.id, "/tmp/repo", "/tmp/wt2", "branch-2")
            .expect("create wt2");
        db.create_agent_session(
            "sess-2",
            "T-2",
            None,
            "implementing",
            "interrupted",
            "claude-code",
        )
        .expect("create session 2");

        // Insert a "done" task with active worktree and agent session — should NOT be resumable
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
             "INSERT INTO tasks (id, initial_prompt, status, jira_key, jira_title, jira_status, jira_assignee, project_id, created_at, updated_at, jira_description, prompt, summary) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
             rusqlite::params!["T-3", "Done task", "done", "PROJ-3", "Summary", "Done", "charlie", None::<String>, 1000, 1000, None::<String>, "Done task", None::<String>],
         ).expect("insert T-3");
        drop(conn);

        db.create_worktree_record("T-3", &project.id, "/tmp/repo", "/tmp/wt3", "branch-3")
            .expect("create wt3");
        db.create_agent_session(
            "sess-3",
            "T-3",
            None,
            "implementing",
            "completed",
            "claude-code",
        )
        .expect("create session 3");

        let resumable = db.get_resumable_worktrees().expect("get resumable");

        // Only the "doing" task should be returned
        assert_eq!(resumable.len(), 1);
        assert_eq!(resumable[0].task_id, "T-1");

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
