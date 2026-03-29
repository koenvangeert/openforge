use rusqlite::Result;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TaskWorkspaceRow {
    pub id: i64,
    pub task_id: String,
    pub project_id: String,
    pub workspace_path: String,
    pub repo_path: String,
    pub kind: String,
    pub branch_name: Option<String>,
    pub provider_name: String,
    pub opencode_port: Option<i64>,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl super::Database {
    #[allow(clippy::too_many_arguments)]
    pub fn upsert_task_workspace_record(
        &self,
        task_id: &str,
        project_id: &str,
        workspace_path: &str,
        repo_path: &str,
        kind: &str,
        branch_name: Option<&str>,
        provider_name: &str,
        opencode_port: Option<i64>,
        status: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO task_workspaces (task_id, project_id, workspace_path, repo_path, kind, branch_name, provider_name, opencode_port, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(task_id) DO UPDATE SET
               project_id = excluded.project_id,
               workspace_path = excluded.workspace_path,
               repo_path = excluded.repo_path,
               kind = excluded.kind,
               branch_name = excluded.branch_name,
               provider_name = excluded.provider_name,
               opencode_port = excluded.opencode_port,
               status = excluded.status,
               updated_at = excluded.updated_at",
            rusqlite::params![task_id, project_id, workspace_path, repo_path, kind, branch_name, provider_name, opencode_port, status, now, now],
        )?;

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_task_workspace_record(
        &self,
        task_id: &str,
        project_id: &str,
        workspace_path: &str,
        repo_path: &str,
        kind: &str,
        branch_name: Option<&str>,
        provider_name: &str,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO task_workspaces (task_id, project_id, workspace_path, repo_path, kind, branch_name, provider_name, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8, ?9)",
            rusqlite::params![task_id, project_id, workspace_path, repo_path, kind, branch_name, provider_name, now, now],
        )?;

        Ok(conn.last_insert_rowid())
    }

    pub fn get_task_workspace_for_task(&self, task_id: &str) -> Result<Option<TaskWorkspaceRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, task_id, project_id, workspace_path, repo_path, kind, branch_name, provider_name, opencode_port, status, created_at, updated_at
             FROM task_workspaces WHERE task_id = ?1",
        )?;
        let mut rows = stmt.query([task_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(TaskWorkspaceRow {
                id: row.get(0)?,
                task_id: row.get(1)?,
                project_id: row.get(2)?,
                workspace_path: row.get(3)?,
                repo_path: row.get(4)?,
                kind: row.get(5)?,
                branch_name: row.get(6)?,
                provider_name: row.get(7)?,
                opencode_port: row.get(8)?,
                status: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn update_task_workspace_runtime(
        &self,
        task_id: &str,
        workspace_path: &str,
        provider_name: &str,
        opencode_port: Option<i64>,
        status: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE task_workspaces
             SET workspace_path = ?1, provider_name = ?2, opencode_port = ?3, status = ?4, updated_at = ?5
             WHERE task_id = ?6",
            rusqlite::params![workspace_path, provider_name, opencode_port, status, now, task_id],
        )?;
        Ok(())
    }

    pub fn update_task_workspace_status(&self, task_id: &str, status: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE task_workspaces SET status = ?1, updated_at = ?2 WHERE task_id = ?3",
            rusqlite::params![status, now, task_id],
        )?;
        Ok(())
    }

    pub fn get_resumable_task_workspaces(&self) -> Result<Vec<TaskWorkspaceRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT tw.id, tw.task_id, tw.project_id, tw.workspace_path, tw.repo_path,
                    tw.kind, tw.branch_name, tw.provider_name, tw.opencode_port, tw.status,
                    tw.created_at, tw.updated_at
             FROM task_workspaces tw
             INNER JOIN tasks t ON tw.task_id = t.id
             INNER JOIN agent_sessions a ON tw.task_id = a.ticket_id
             WHERE tw.status = 'active' AND t.status = 'doing'
             ORDER BY tw.updated_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(TaskWorkspaceRow {
                id: row.get(0)?,
                task_id: row.get(1)?,
                project_id: row.get(2)?,
                workspace_path: row.get(3)?,
                repo_path: row.get(4)?,
                kind: row.get(5)?,
                branch_name: row.get(6)?,
                provider_name: row.get(7)?,
                opencode_port: row.get(8)?,
                status: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn get_project_for_workspace(&self, workspace_path: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT project_id FROM task_workspaces WHERE workspace_path = ?1 LIMIT 1")?;
        let mut rows = stmt.query([workspace_path])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn clear_stale_task_workspace_ports(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE task_workspaces SET opencode_port = NULL, updated_at = ?1 WHERE opencode_port IS NOT NULL",
            rusqlite::params![now],
        )?;
        Ok(conn.changes() as usize)
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::fs;

    #[test]
    fn test_task_workspace_lifecycle() {
        let (db, path) = make_test_db("task_workspace_lifecycle");
        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task(
                "Workspace task",
                "doing",
                Some(&project.id),
                None,
                None,
                None,
            )
            .expect("create task failed");

        db.create_task_workspace_record(
            &task.id,
            &project.id,
            "/tmp/test-repo/.workspace/T-1",
            "/tmp/test-repo",
            "git_worktree",
            Some("t-1"),
            "opencode",
        )
        .expect("create task workspace failed");

        let workspace = db
            .get_task_workspace_for_task(&task.id)
            .expect("get task workspace failed")
            .expect("task workspace missing");
        assert_eq!(workspace.workspace_path, "/tmp/test-repo/.workspace/T-1");
        assert_eq!(workspace.kind, "git_worktree");
        assert_eq!(workspace.branch_name, Some("t-1".to_string()));
        assert_eq!(workspace.provider_name, "opencode");
        assert_eq!(workspace.status, "active");

        db.update_task_workspace_runtime(
            &task.id,
            "/tmp/test-repo/.workspace/T-1",
            "opencode",
            Some(4312),
            "active",
        )
        .expect("update runtime failed");
        db.update_task_workspace_status(&task.id, "completed")
            .expect("update status failed");

        let updated = db
            .get_task_workspace_for_task(&task.id)
            .expect("get updated workspace failed")
            .expect("updated workspace missing");
        assert_eq!(updated.opencode_port, Some(4312));
        assert_eq!(updated.status, "completed");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_get_resumable_task_workspaces_only_doing_tasks() {
        let (db, path) = make_test_db("resumable_task_workspaces");
        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let doing_task = db
            .create_task("Doing task", "doing", Some(&project.id), None, None, None)
            .expect("create doing task failed");
        let done_task = db
            .create_task("Done task", "done", Some(&project.id), None, None, None)
            .expect("create done task failed");

        db.create_task_workspace_record(
            &doing_task.id,
            &project.id,
            "/tmp/test-repo/.workspace/doing",
            "/tmp/test-repo",
            "project_dir",
            None,
            "opencode",
        )
        .expect("create doing workspace failed");
        db.create_task_workspace_record(
            &done_task.id,
            &project.id,
            "/tmp/test-repo/.workspace/done",
            "/tmp/test-repo",
            "project_dir",
            None,
            "opencode",
        )
        .expect("create done workspace failed");

        db.create_agent_session(
            "ses-doing",
            &doing_task.id,
            Some("oc-doing"),
            "implement",
            "running",
            "opencode",
        )
        .expect("create doing session failed");
        db.create_agent_session(
            "ses-done",
            &done_task.id,
            Some("oc-done"),
            "implement",
            "running",
            "opencode",
        )
        .expect("create done session failed");

        let resumable = db
            .get_resumable_task_workspaces()
            .expect("get resumable failed");
        assert_eq!(resumable.len(), 1);
        assert_eq!(resumable[0].task_id, doing_task.id);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_upsert_task_workspace_record_updates_existing_row() {
        let (db, path) = make_test_db("upsert_task_workspace_record");
        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task(
                "Workspace task",
                "doing",
                Some(&project.id),
                None,
                None,
                None,
            )
            .expect("create task failed");

        db.create_task_workspace_record(
            &task.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/test-repo",
            "project_dir",
            None,
            "opencode",
        )
        .expect("create task workspace failed");

        db.upsert_task_workspace_record(
            &task.id,
            &project.id,
            "/tmp/test-repo/.workspace/T-1",
            "/tmp/test-repo",
            "git_worktree",
            Some("t-1"),
            "opencode",
            Some(8080),
            "active",
        )
        .expect("upsert task workspace failed");

        let workspace = db
            .get_task_workspace_for_task(&task.id)
            .expect("get task workspace failed")
            .expect("task workspace missing");
        assert_eq!(workspace.workspace_path, "/tmp/test-repo/.workspace/T-1");
        assert_eq!(workspace.kind, "git_worktree");
        assert_eq!(workspace.branch_name, Some("t-1".to_string()));
        assert_eq!(workspace.opencode_port, Some(8080));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_clear_stale_task_workspace_ports() {
        let (db, path) = make_test_db("clear_stale_task_workspace_ports");
        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task(
                "Workspace task",
                "doing",
                Some(&project.id),
                None,
                None,
                None,
            )
            .expect("create task failed");

        db.upsert_task_workspace_record(
            &task.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/test-repo",
            "project_dir",
            None,
            "opencode",
            Some(4567),
            "active",
        )
        .expect("upsert task workspace failed");

        let count = db
            .clear_stale_task_workspace_ports()
            .expect("clear stale task workspace ports failed");
        assert_eq!(count, 1);

        let workspace = db
            .get_task_workspace_for_task(&task.id)
            .expect("get task workspace failed")
            .expect("task workspace missing");
        assert_eq!(workspace.opencode_port, None);

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
