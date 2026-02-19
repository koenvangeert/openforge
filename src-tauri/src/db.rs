use rusqlite::{Connection, Result};
use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Task row from database
#[derive(Debug, Clone, Serialize)]
pub struct TaskRow {
    pub id: String,
    pub title: String,
    pub status: String,
    pub jira_key: Option<String>,
    pub jira_status: Option<String>,
    pub jira_assignee: Option<String>,
    pub plan_text: Option<String>,
    pub project_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Project row from database
#[derive(Debug, Clone, Serialize)]
pub struct ProjectRow {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: i64,
    pub updated_at: i64,
}

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
    pub created_at: i64,
    pub updated_at: i64,
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

/// Review PR row from database (cross-repo, not task-linked)
#[derive(Debug, Clone, Serialize)]
pub struct ReviewPrRow {
    pub id: i64,
    pub number: i64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub draft: bool,
    pub html_url: String,
    pub user_login: String,
    pub user_avatar_url: Option<String>,
    pub repo_owner: String,
    pub repo_name: String,
    pub head_ref: String,
    pub base_ref: String,
    pub head_sha: String,
    pub additions: i64,
    pub deletions: i64,
    pub changed_files: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Agent session row from database
#[derive(Debug, Clone, Serialize)]
pub struct AgentSessionRow {
    pub id: String,
    pub ticket_id: String,
    pub opencode_session_id: Option<String>,
    pub stage: String,
    pub status: String,
    pub checkpoint_data: Option<String>,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Agent log row from database
#[derive(Debug, Clone, Serialize)]
pub struct AgentLogRow {
    pub id: i64,
    pub session_id: String,
    pub timestamp: i64,
    pub log_type: String,
    pub content: String,
}

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

/// Database connection wrapper for thread-safe access
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    /// Initialize the database at the given path
    /// Creates the database file if it doesn't exist and runs all migrations
    pub fn new(db_path: PathBuf) -> Result<Self> {
        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        }

        let conn = Connection::open(&db_path)?;

        // Enable foreign keys
        conn.execute("PRAGMA foreign_keys = ON", [])?;

        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
        };

        db.run_migrations()?;

        Ok(db)
    }

    /// Run all database migrations
    fn run_migrations(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        let old_tickets_exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tickets'",
            [],
            |row| {
                let count: i64 = row.get(0)?;
                Ok(count > 0)
            },
        )?;

        if old_tickets_exists {
            conn.execute("DROP TABLE IF EXISTS agent_logs", [])?;
            conn.execute("DROP TABLE IF EXISTS pr_comments", [])?;
            conn.execute("DROP TABLE IF EXISTS agent_sessions", [])?;
            conn.execute("DROP TABLE IF EXISTS pull_requests", [])?;
            conn.execute("DROP TABLE IF EXISTS tickets", [])?;
        }

        conn.execute(
            "CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                status TEXT NOT NULL,
                jira_key TEXT,
                jira_status TEXT,
                jira_assignee TEXT,
                plan_text TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS agent_sessions (
                id TEXT PRIMARY KEY,
                ticket_id TEXT NOT NULL,
                opencode_session_id TEXT,
                stage TEXT NOT NULL,
                status TEXT NOT NULL,
                checkpoint_data TEXT,
                error_message TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (ticket_id) REFERENCES tasks(id)
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS agent_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                log_type TEXT NOT NULL,
                content TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS pull_requests (
                id INTEGER PRIMARY KEY,
                ticket_id TEXT NOT NULL,
                repo_owner TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                state TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (ticket_id) REFERENCES tasks(id)
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS pr_comments (
                id INTEGER PRIMARY KEY,
                pr_id INTEGER NOT NULL,
                author TEXT NOT NULL,
                body TEXT NOT NULL,
                comment_type TEXT NOT NULL,
                file_path TEXT,
                line_number INTEGER,
                addressed INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (pr_id) REFERENCES pull_requests(id)
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        let default_configs = [
            ("jira_api_token", ""),
            ("jira_base_url", ""),
            ("jira_board_id", ""),
            ("jira_username", ""),
            ("filter_assigned_to_me", "true"),
            ("exclude_done_tickets", "true"),
            ("custom_jql", ""),
            ("github_token", ""),
            ("github_default_repo", ""),
            ("opencode_port", "4096"),
            ("opencode_auto_start", "true"),
            ("jira_poll_interval", "60"),
            ("github_poll_interval", "30"),
        ];

        for (key, value) in &default_configs {
            conn.execute(
                "INSERT OR IGNORE INTO config (key, value) VALUES (?1, ?2)",
                [key, value],
            )?;
        }

        conn.execute(
            "INSERT OR IGNORE INTO config (key, value) VALUES ('next_task_id', '1')",
            [],
        )?;

        // Migration: Rename repos_root_path to path in projects table
        let repos_root_path_exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='repos_root_path'",
            [],
            |row| {
                let count: i64 = row.get(0)?;
                Ok(count > 0)
            },
        )?;

        if repos_root_path_exists {
            conn.execute(
                "ALTER TABLE projects RENAME COLUMN repos_root_path TO path",
                [],
            )?;
        }

        conn.execute(
            "CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS project_config (
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                UNIQUE(project_id, key)
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS worktrees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
                project_id TEXT NOT NULL REFERENCES projects(id),
                repo_path TEXT NOT NULL,
                worktree_path TEXT NOT NULL,
                branch_name TEXT NOT NULL,
                opencode_port INTEGER,
                opencode_pid INTEGER,
                status TEXT NOT NULL DEFAULT 'active',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        let project_id_exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name='project_id'",
            [],
            |row| {
                let count: i64 = row.get(0)?;
                Ok(count > 0)
            },
        )?;

        if !project_id_exists {
            conn.execute(
                "ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id)",
                [],
            )?;
        }

        conn.execute(
            "INSERT OR IGNORE INTO config (key, value) VALUES ('next_project_id', '1')",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS review_prs (
                id INTEGER PRIMARY KEY,
                number INTEGER NOT NULL,
                title TEXT NOT NULL,
                body TEXT,
                state TEXT NOT NULL,
                draft INTEGER NOT NULL DEFAULT 0,
                html_url TEXT NOT NULL,
                user_login TEXT NOT NULL,
                user_avatar_url TEXT,
                repo_owner TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                head_ref TEXT NOT NULL,
                base_ref TEXT NOT NULL,
                head_sha TEXT NOT NULL,
                additions INTEGER NOT NULL DEFAULT 0,
                deletions INTEGER NOT NULL DEFAULT 0,
                changed_files INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        // ============================================================================
        // Migration: Add CI status columns to pull_requests table
        // ============================================================================
        let head_sha_exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('pull_requests') WHERE name='head_sha'",
            [],
            |row| {
                let count: i64 = row.get(0)?;
                Ok(count > 0)
            },
        )?;

        if !head_sha_exists {
            conn.execute(
                "ALTER TABLE pull_requests ADD COLUMN head_sha TEXT NOT NULL DEFAULT ''",
                [],
            )?;
        }

        let ci_status_exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('pull_requests') WHERE name='ci_status'",
            [],
            |row| {
                let count: i64 = row.get(0)?;
                Ok(count > 0)
            },
        )?;

        if !ci_status_exists {
            conn.execute("ALTER TABLE pull_requests ADD COLUMN ci_status TEXT", [])?;
        }

        let ci_check_runs_exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('pull_requests') WHERE name='ci_check_runs'",
            [],
            |row| {
                let count: i64 = row.get(0)?;
                Ok(count > 0)
            },
        )?;

        if !ci_check_runs_exists {
            conn.execute(
                "ALTER TABLE pull_requests ADD COLUMN ci_check_runs TEXT",
                [],
            )?;
        }

        // ============================================================================
        // Migration: Add last_polled_at column to pull_requests table
        // ============================================================================
        let last_polled_at_exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('pull_requests') WHERE name='last_polled_at'",
            [],
            |row| {
                let count: i64 = row.get(0)?;
                Ok(count > 0)
            },
        )?;

        if !last_polled_at_exists {
            conn.execute(
                "ALTER TABLE pull_requests ADD COLUMN last_polled_at INTEGER DEFAULT 0",
                [],
            )?;
        }

        // ============================================================================
        // One-time migration: Copy per-project credentials to global config
        // If global credentials are empty but a project has them, copy them over.
        // This ensures existing users don't lose sync after the config migration.
        // ============================================================================
        let global_token: String = conn
            .query_row(
                "SELECT value FROM config WHERE key = 'jira_api_token'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();

        if global_token.is_empty() {
            let source_project: Option<String> = conn.query_row(
                "SELECT project_id FROM project_config WHERE key = 'jira_api_token' AND value != '' LIMIT 1",
                [],
                |row| row.get(0),
            ).ok();

            if let Some(project_id) = source_project {
                let keys = [
                    "jira_base_url",
                    "jira_username",
                    "jira_api_token",
                    "github_token",
                ];
                for key in &keys {
                    let value: String = conn
                        .query_row(
                            "SELECT value FROM project_config WHERE project_id = ?1 AND key = ?2",
                            rusqlite::params![project_id, key],
                            |row| row.get(0),
                        )
                        .unwrap_or_default();
                    if !value.is_empty() {
                        conn.execute(
                            "UPDATE config SET value = ?1 WHERE key = ?2",
                            rusqlite::params![value, key],
                        )?;
                    }
                }
            }
        }

        // ============================================================================
        // One-time migration: Simplify kanban columns from 5 to 3
        // Maps: todo→backlog, in_progress/in_review/testing→doing, done stays done
        // ============================================================================
        conn.execute(
            "UPDATE tasks SET status = 'backlog' WHERE status = 'todo'",
            [],
        )?;
        conn.execute(
            "UPDATE tasks SET status = 'doing' WHERE status IN ('in_progress', 'in_review', 'testing')",
            [],
        )?;
        conn.execute(
            "UPDATE tasks SET status = 'backlog' WHERE status NOT IN ('backlog', 'doing', 'done')",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS self_review_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                round INTEGER NOT NULL DEFAULT 1,
                comment_type TEXT NOT NULL,
                file_path TEXT,
                line_number INTEGER,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                archived_at INTEGER
            )",
            [],
        )?;

        Ok(())
    }

    /// Get a reference to the connection for executing queries
    pub fn connection(&self) -> Arc<Mutex<Connection>> {
        Arc::clone(&self.conn)
    }

    /// Get a config value by key
    pub fn get_config(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM config WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;

        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Set a config value
    pub fn set_config(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)",
            [key, value],
        )?;
        Ok(())
    }

    // ============================================================================
    // Project Management
    // ============================================================================

    /// Create a new project with auto-incremented ID
    pub fn create_project(&self, name: &str, path: &str) -> Result<ProjectRow> {
        let conn = self.conn.lock().unwrap();

        let next_id: i64 = conn.query_row(
            "SELECT value FROM config WHERE key = 'next_project_id'",
            [],
            |row| {
                let val: String = row.get(0)?;
                Ok(val.parse::<i64>().unwrap_or(1))
            },
        )?;

        let project_id = format!("P-{}", next_id);

        conn.execute(
            "UPDATE config SET value = ?1 WHERE key = 'next_project_id'",
            [&(next_id + 1).to_string()],
        )?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO projects (id, name, path, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![&project_id, name, path, now, now],
        )?;

        Ok(ProjectRow {
            id: project_id,
            name: name.to_string(),
            path: path.to_string(),
            created_at: now,
            updated_at: now,
        })
    }

    /// Get all projects
    pub fn get_all_projects(&self) -> Result<Vec<ProjectRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, path, created_at, updated_at 
             FROM projects ORDER BY updated_at DESC",
        )?;

        let projects = stmt.query_map([], |row| {
            Ok(ProjectRow {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;

        let mut result = Vec::new();
        for project in projects {
            result.push(project?);
        }
        Ok(result)
    }

    /// Get a project by ID
    pub fn get_project(&self, id: &str) -> Result<Option<ProjectRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, path, created_at, updated_at 
             FROM projects WHERE id = ?1",
        )?;
        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(ProjectRow {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// Update a project
    pub fn update_project(&self, id: &str, name: &str, path: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE projects SET name = ?1, path = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![name, path, now, id],
        )?;
        Ok(())
    }

    /// Delete a project
    pub fn delete_project(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM projects WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    // ============================================================================
    // Project Configuration
    // ============================================================================

    /// Get a project config value
    pub fn get_project_config(&self, project_id: &str, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT value FROM project_config WHERE project_id = ?1 AND key = ?2")?;
        let mut rows = stmt.query([project_id, key])?;

        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Set a project config value
    pub fn set_project_config(&self, project_id: &str, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO project_config (project_id, key, value) VALUES (?1, ?2, ?3)",
            [project_id, key, value],
        )?;
        Ok(())
    }

    /// Get all config values for a project
    pub fn get_all_project_config(
        &self,
        project_id: &str,
    ) -> Result<std::collections::HashMap<String, String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT key, value FROM project_config WHERE project_id = ?1")?;
        let rows = stmt.query_map([project_id], |row| Ok((row.get(0)?, row.get(1)?)))?;

        let mut result = std::collections::HashMap::new();
        for row in rows {
            let (key, value) = row?;
            result.insert(key, value);
        }
        Ok(result)
    }

    // ============================================================================
    // Worktree Management
    // ============================================================================

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
             WHERE w.status = 'active' AND t.status != 'done'
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

    /// Get all tasks for a project
    pub fn get_tasks_for_project(&self, project_id: &str) -> Result<Vec<TaskRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, status, jira_key, jira_status, jira_assignee, plan_text, project_id, created_at, updated_at 
             FROM tasks WHERE project_id = ?1 ORDER BY updated_at DESC",
        )?;

        let tasks = stmt.query_map([project_id], |row| {
            Ok(TaskRow {
                id: row.get(0)?,
                title: row.get(1)?,
                status: row.get(2)?,
                jira_key: row.get(3)?,
                jira_status: row.get(4)?,
                jira_assignee: row.get(5)?,
                plan_text: row.get(6)?,
                project_id: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
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
            "INSERT INTO tasks (id, title, status, jira_key, jira_status, jira_assignee, plan_text, project_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                &task_id,
                title,
                status,
                jira_key,
                None::<String>,
                None::<String>,
                None::<String>,
                project_id,
                now,
                now,
            ],
        )?;

        Ok(TaskRow {
            id: task_id,
            title: title.to_string(),
            status: status.to_string(),
            jira_key: jira_key.map(|s| s.to_string()),
            jira_status: None,
            jira_assignee: None,
            plan_text: None,
            project_id: project_id.map(|s| s.to_string()),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn get_all_tasks(&self) -> Result<Vec<TaskRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, status, jira_key, jira_status, jira_assignee, plan_text, project_id, created_at, updated_at 
             FROM tasks ORDER BY updated_at DESC"
        )?;

        let tasks = stmt.query_map([], |row| {
            Ok(TaskRow {
                id: row.get(0)?,
                title: row.get(1)?,
                status: row.get(2)?,
                jira_key: row.get(3)?,
                jira_status: row.get(4)?,
                jira_assignee: row.get(5)?,
                plan_text: row.get(6)?,
                project_id: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
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
            "SELECT id, title, status, jira_key, jira_status, jira_assignee, plan_text, project_id, created_at, updated_at 
             FROM tasks WHERE id = ?1"
        )?;
        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(TaskRow {
                id: row.get(0)?,
                title: row.get(1)?,
                status: row.get(2)?,
                jira_key: row.get(3)?,
                jira_status: row.get(4)?,
                jira_assignee: row.get(5)?,
                plan_text: row.get(6)?,
                project_id: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
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

    pub fn delete_task(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
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
            "DELETE FROM worktrees WHERE task_id = ?1",
            rusqlite::params![id],
        )?;
        conn.execute("DELETE FROM tasks WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    pub fn update_task_jira_info(
        &self,
        jira_key: &str,
        jira_status: &str,
        jira_assignee: &str,
    ) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE tasks SET jira_status = ?1, jira_assignee = ?2, updated_at = ?3 WHERE jira_key = ?4",
            rusqlite::params![jira_status, jira_assignee, now, jira_key],
        )?;
        Ok(conn.changes() as usize)
    }

    pub fn get_tasks_with_jira_links(&self) -> Result<Vec<TaskRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, status, jira_key, jira_status, jira_assignee, plan_text, project_id, created_at, updated_at 
             FROM tasks WHERE jira_key IS NOT NULL ORDER BY updated_at DESC"
        )?;

        let tasks = stmt.query_map([], |row| {
            Ok(TaskRow {
                id: row.get(0)?,
                title: row.get(1)?,
                status: row.get(2)?,
                jira_key: row.get(3)?,
                jira_status: row.get(4)?,
                jira_assignee: row.get(5)?,
                plan_text: row.get(6)?,
                project_id: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
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

    /// Get all open pull requests from the database
    pub fn get_open_prs(&self) -> Result<Vec<PrRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ticket_id, repo_owner, repo_name, title, url, state, head_sha, ci_status, ci_check_runs, created_at, updated_at 
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
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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
            "SELECT id, ticket_id, repo_owner, repo_name, title, url, state, head_sha, ci_status, ci_check_runs, created_at, updated_at
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
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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
        created_at: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO pr_comments (id, pr_id, author, body, comment_type, file_path, line_number, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                id,
                pr_id,
                author,
                body,
                comment_type,
                file_path,
                line_number,
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

    pub fn create_agent_session(
        &self,
        id: &str,
        ticket_id: &str,
        opencode_session_id: Option<&str>,
        stage: &str,
        status: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO agent_sessions (id, ticket_id, opencode_session_id, stage, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![id, ticket_id, opencode_session_id, stage, status, now, now],
        )?;
        Ok(())
    }

    pub fn update_agent_session(
        &self,
        id: &str,
        stage: &str,
        status: &str,
        checkpoint_data: Option<&str>,
        error_message: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE agent_sessions SET stage = ?1, status = ?2, checkpoint_data = ?3, error_message = ?4, updated_at = ?5 WHERE id = ?6",
            rusqlite::params![stage, status, checkpoint_data, error_message, now, id],
        )?;
        Ok(())
    }

    pub fn set_agent_session_opencode_id(&self, id: &str, opencode_session_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE agent_sessions SET opencode_session_id = ?1 WHERE id = ?2",
            [opencode_session_id, id],
        )?;
        Ok(())
    }

    pub fn get_agent_session(&self, id: &str) -> Result<Option<AgentSessionRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ticket_id, opencode_session_id, stage, status, checkpoint_data, error_message, created_at, updated_at
             FROM agent_sessions WHERE id = ?1",
        )?;
        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(AgentSessionRow {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                opencode_session_id: row.get(2)?,
                stage: row.get(3)?,
                status: row.get(4)?,
                checkpoint_data: row.get(5)?,
                error_message: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_latest_session_for_ticket(
        &self,
        ticket_id: &str,
    ) -> Result<Option<AgentSessionRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ticket_id, opencode_session_id, stage, status, checkpoint_data, error_message, created_at, updated_at
             FROM agent_sessions WHERE ticket_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1",
        )?;
        let mut rows = stmt.query([ticket_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(AgentSessionRow {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                opencode_session_id: row.get(2)?,
                stage: row.get(3)?,
                status: row.get(4)?,
                checkpoint_data: row.get(5)?,
                error_message: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_latest_sessions_for_tickets(
        &self,
        ticket_ids: &[String],
    ) -> Result<Vec<AgentSessionRow>> {
        if ticket_ids.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock().unwrap();
        let placeholders: Vec<String> = ticket_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT s.id, s.ticket_id, s.opencode_session_id, s.stage, s.status, s.checkpoint_data, s.error_message, s.created_at, s.updated_at
             FROM agent_sessions s
             INNER JOIN (
                 SELECT ticket_id, MAX(created_at) as max_created
                 FROM agent_sessions
                 WHERE ticket_id IN ({})
                 GROUP BY ticket_id
             ) latest ON s.ticket_id = latest.ticket_id AND s.created_at = latest.max_created",
            placeholders.join(", ")
        );
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::types::ToSql> = ticket_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();
        let rows = stmt.query_map(params.as_slice(), |row| {
            Ok(AgentSessionRow {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                opencode_session_id: row.get(2)?,
                stage: row.get(3)?,
                status: row.get(4)?,
                checkpoint_data: row.get(5)?,
                error_message: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn insert_agent_log(&self, session_id: &str, log_type: &str, content: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO agent_logs (session_id, timestamp, log_type, content) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![session_id, now, log_type, content],
        )?;
        Ok(())
    }

    pub fn get_agent_logs(&self, session_id: &str) -> Result<Vec<AgentLogRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, timestamp, log_type, content FROM agent_logs WHERE session_id = ?1 ORDER BY timestamp ASC",
        )?;
        let logs = stmt.query_map([session_id], |row| {
            Ok(AgentLogRow {
                id: row.get(0)?,
                session_id: row.get(1)?,
                timestamp: row.get(2)?,
                log_type: row.get(3)?,
                content: row.get(4)?,
            })
        })?;
        let mut result = Vec::new();
        for log in logs {
            result.push(log?);
        }
        Ok(result)
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

    // ============================================================================
    // Review PRs (cross-repo)
    // ============================================================================

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_review_pr(
        &self,
        id: i64,
        number: i64,
        title: &str,
        body: Option<&str>,
        state: &str,
        draft: bool,
        html_url: &str,
        user_login: &str,
        user_avatar_url: Option<&str>,
        repo_owner: &str,
        repo_name: &str,
        head_ref: &str,
        base_ref: &str,
        head_sha: &str,
        additions: i64,
        deletions: i64,
        changed_files: i64,
        created_at: i64,
        updated_at: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO review_prs (id, number, title, body, state, draft, html_url, user_login, user_avatar_url, repo_owner, repo_name, head_ref, base_ref, head_sha, additions, deletions, changed_files, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            rusqlite::params![
                id, number, title, body, state, draft as i32, html_url, user_login, user_avatar_url,
                repo_owner, repo_name, head_ref, base_ref, head_sha, additions, deletions, changed_files,
                created_at, updated_at
            ],
        )?;
        Ok(())
    }

    pub fn get_all_review_prs(&self) -> Result<Vec<ReviewPrRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, number, title, body, state, draft, html_url, user_login, user_avatar_url,
                    repo_owner, repo_name, head_ref, base_ref, head_sha, additions, deletions,
                    changed_files, created_at, updated_at
             FROM review_prs ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ReviewPrRow {
                id: row.get(0)?,
                number: row.get(1)?,
                title: row.get(2)?,
                body: row.get(3)?,
                state: row.get(4)?,
                draft: row.get::<_, i32>(5)? != 0,
                html_url: row.get(6)?,
                user_login: row.get(7)?,
                user_avatar_url: row.get(8)?,
                repo_owner: row.get(9)?,
                repo_name: row.get(10)?,
                head_ref: row.get(11)?,
                base_ref: row.get(12)?,
                head_sha: row.get(13)?,
                additions: row.get(14)?,
                deletions: row.get(15)?,
                changed_files: row.get(16)?,
                created_at: row.get(17)?,
                updated_at: row.get(18)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn delete_stale_review_prs(&self, current_ids: &[i64]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        if current_ids.is_empty() {
            conn.execute("DELETE FROM review_prs", [])?;
        } else {
            let placeholders: Vec<String> = current_ids
                .iter()
                .enumerate()
                .map(|(i, _)| format!("?{}", i + 1))
                .collect();
            let sql = format!(
                "DELETE FROM review_prs WHERE id NOT IN ({})",
                placeholders.join(", ")
            );
            let mut stmt = conn.prepare(&sql)?;
            let params: Vec<Box<dyn rusqlite::types::ToSql>> = current_ids
                .iter()
                .map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>)
                .collect();
            let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();
            stmt.execute(param_refs.as_slice())?;
        }
        Ok(())
    }

    pub fn mark_running_sessions_interrupted(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE agent_sessions SET status = 'interrupted', error_message = 'Session interrupted by app restart', updated_at = ?1 WHERE status = 'running'",
            rusqlite::params![now],
        )?;
        Ok(conn.changes() as usize)
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

    // ============================================================================
    // Self Review Comments
    // ============================================================================

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
    use super::*;
    use std::fs;

    #[test]
    fn test_database_initialization() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join("test_ai_command_center.db");

        // Clean up if exists
        let _ = fs::remove_file(&db_path);

        // Create database
        let db = Database::new(db_path.clone()).expect("Failed to create database");

        // Verify tables exist by querying sqlite_master
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let table_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('tasks', 'agent_sessions', 'agent_logs', 'pull_requests', 'pr_comments', 'config', 'projects', 'project_config', 'worktrees', 'review_prs')",
                [],
                |row| row.get(0),
            )
            .expect("Failed to count tables");

        assert_eq!(table_count, 10, "All 10 tables should be created");

        let config_count: i32 = conn
            .query_row("SELECT COUNT(*) FROM config", [], |row| row.get(0))
            .expect("Failed to count config rows");

        assert_eq!(
            config_count, 15,
            "All 15 default config values should be inserted"
        );

        // Clean up
        drop(conn);
        drop(db);
        let _ = fs::remove_file(&db_path);
    }

    #[test]
    fn test_config_operations() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join("test_config_ops.db");

        // Clean up if exists
        let _ = fs::remove_file(&db_path);

        let db = Database::new(db_path.clone()).expect("Failed to create database");

        // Test getting default config
        let port = db
            .get_config("opencode_port")
            .expect("Failed to get config");
        assert_eq!(port, Some("4096".to_string()));

        // Test setting config
        db.set_config("opencode_port", "8080")
            .expect("Failed to set config");
        let port = db
            .get_config("opencode_port")
            .expect("Failed to get config");
        assert_eq!(port, Some("8080".to_string()));

        // Test non-existent key
        let result = db.get_config("nonexistent").expect("Failed to query");
        assert_eq!(result, None);

        // Clean up
        drop(db);
        let _ = fs::remove_file(&db_path);
    }

    fn make_test_db(name: &str) -> (Database, PathBuf) {
        let db_path = std::env::temp_dir().join(format!("test_{}.db", name));
        let _ = fs::remove_file(&db_path);
        let db = Database::new(db_path.clone()).expect("Failed to create database");
        (db, db_path)
    }

    fn insert_test_task(db: &Database) {
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, status, jira_key, jira_status, jira_assignee, plan_text, project_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params!["T-100", "Test task", "backlog", "PROJ-100", "To Do", "alice", None::<String>, None::<String>, 1000, 1000],
        ).expect("Failed to insert test task");
    }

    #[test]
    fn test_create_task_and_retrieve() {
        let (db, path) = make_test_db("create_task");

        let task = db
            .create_task("My task", "backlog", None, None)
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
            .create_task("Original", "backlog", None, None)
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
            .create_task("Found me", "backlog", None, None)
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
    fn test_agent_session_lifecycle() {
        let (db, path) = make_test_db("agent_session_lifecycle");
        insert_test_task(&db);

        db.create_agent_session("ses-1", "T-100", None, "read_ticket", "running")
            .expect("create failed");

        let session = db
            .get_agent_session("ses-1")
            .expect("get failed")
            .expect("not found");
        assert_eq!(session.ticket_id, "T-100");
        assert_eq!(session.stage, "read_ticket");
        assert_eq!(session.status, "running");
        assert!(session.opencode_session_id.is_none());

        db.set_agent_session_opencode_id("ses-1", "oc-abc")
            .expect("set opencode id failed");

        let session = db
            .get_agent_session("ses-1")
            .expect("get failed")
            .expect("not found");
        assert_eq!(session.opencode_session_id, Some("oc-abc".to_string()));

        db.update_agent_session(
            "ses-1",
            "implement",
            "paused",
            Some("{\"diff\":\"...\"}"),
            None,
        )
        .expect("update failed");

        let session = db
            .get_agent_session("ses-1")
            .expect("get failed")
            .expect("not found");
        assert_eq!(session.stage, "implement");
        assert_eq!(session.status, "paused");
        assert_eq!(
            session.checkpoint_data,
            Some("{\"diff\":\"...\"}".to_string())
        );

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_get_latest_session_for_ticket() {
        let (db, path) = make_test_db("latest_session");
        insert_test_task(&db);

        db.create_agent_session("ses-old", "T-100", None, "read_ticket", "completed")
            .expect("create 1 failed");
        db.create_agent_session("ses-new", "T-100", None, "implement", "running")
            .expect("create 2 failed");

        let latest = db
            .get_latest_session_for_ticket("T-100")
            .expect("get failed")
            .expect("not found");
        assert_eq!(latest.id, "ses-new");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_checkpoint_data_persistence() {
        let (db, path) = make_test_db("checkpoint_persist");
        insert_test_task(&db);

        db.create_agent_session("ses-cp", "T-100", None, "implement", "running")
            .expect("create session failed");

        db.update_agent_session(
            "ses-cp",
            "implement",
            "paused",
            Some("{\"question\":\"approve?\"}"),
            None,
        )
        .expect("update with checkpoint failed");

        let session = db
            .get_agent_session("ses-cp")
            .expect("get failed")
            .expect("not found");
        assert_eq!(
            session.checkpoint_data,
            Some("{\"question\":\"approve?\"}".to_string())
        );

        db.update_agent_session("ses-cp", "implement", "running", None, None)
            .expect("clear checkpoint failed");

        let session = db
            .get_agent_session("ses-cp")
            .expect("get failed")
            .expect("not found");
        assert_eq!(session.checkpoint_data, None);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_agent_logs() {
        let (db, path) = make_test_db("agent_logs");
        insert_test_task(&db);

        db.create_agent_session("ses-log", "T-100", None, "implement", "running")
            .expect("create session failed");

        db.insert_agent_log("ses-log", "stdout", "Building project...")
            .expect("insert log 1 failed");
        db.insert_agent_log("ses-log", "stderr", "Warning: unused var")
            .expect("insert log 2 failed");

        let logs = db.get_agent_logs("ses-log").expect("get logs failed");
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].log_type, "stdout");
        assert_eq!(logs[0].content, "Building project...");
        assert_eq!(logs[1].log_type, "stderr");

        drop(db);
        let _ = fs::remove_file(&path);
    }

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

        db.insert_pr_comment(701, 30, "a", "c1", "review_comment", None, None, 4000)
            .expect("insert failed");
        db.insert_pr_comment(702, 30, "b", "c2", "review_comment", None, None, 4001)
            .expect("insert failed");
        db.insert_pr_comment(703, 30, "c", "c3", "review_comment", None, None, 4002)
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
    fn test_config_set_new_key() {
        let (db, path) = make_test_db("config_new_key");

        db.set_config("custom_key", "custom_value")
            .expect("set failed");
        let val = db.get_config("custom_key").expect("get failed");
        assert_eq!(val, Some("custom_value".to_string()));

        db.set_config("custom_key", "overwritten")
            .expect("overwrite failed");
        let val = db.get_config("custom_key").expect("get failed");
        assert_eq!(val, Some("overwritten".to_string()));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_create_task_autoincrement() {
        let (db, path) = make_test_db("task_autoincrement");

        let task1 = db
            .create_task("Task 1", "backlog", None, None)
            .expect("create 1 failed");
        let task2 = db
            .create_task("Task 2", "backlog", None, None)
            .expect("create 2 failed");
        let task3 = db
            .create_task("Task 3", "backlog", None, None)
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
            .create_task("My task", "backlog", None, None)
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

        db.create_task("Linked task", "backlog", Some("PROJ-1"), None)
            .expect("create 1 failed");
        db.create_task("Unlinked task", "backlog", None, None)
            .expect("create 2 failed");

        let updated = db
            .update_task_jira_info("PROJ-1", "In Progress", "bob")
            .expect("update jira info failed");

        assert_eq!(updated, 1);

        let tasks = db.get_all_tasks().expect("get all failed");
        let linked = tasks.iter().find(|t| t.jira_key.is_some()).unwrap();
        assert_eq!(linked.jira_status, Some("In Progress".to_string()));
        assert_eq!(linked.jira_assignee, Some("bob".to_string()));

        let unlinked = tasks.iter().find(|t| t.jira_key.is_none()).unwrap();
        assert_eq!(unlinked.jira_status, None);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_get_tasks_with_jira_links() {
        let (db, path) = make_test_db("tasks_with_jira");

        db.create_task("Task 1", "backlog", Some("PROJ-1"), None)
            .expect("create 1 failed");
        db.create_task("Task 2", "backlog", Some("PROJ-2"), None)
            .expect("create 2 failed");
        db.create_task("Task 3", "backlog", None, None)
            .expect("create 3 failed");

        let linked = db.get_tasks_with_jira_links().expect("get linked failed");
        assert_eq!(linked.len(), 2);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_project_config_operations() {
        let (db, path) = make_test_db("project_config");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("Failed to create project");

        db.set_project_config(&project.id, "github_default_repo", "owner/repo")
            .expect("Failed to set github_default_repo");
        db.set_project_config(&project.id, "custom_setting", "value123")
            .expect("Failed to set custom_setting");

        let repo = db
            .get_project_config(&project.id, "github_default_repo")
            .expect("Failed to get github_default_repo");
        assert_eq!(repo, Some("owner/repo".to_string()));

        let setting = db
            .get_project_config(&project.id, "custom_setting")
            .expect("Failed to get custom_setting");
        assert_eq!(setting, Some("value123".to_string()));

        let nonexistent = db
            .get_project_config(&project.id, "nonexistent")
            .expect("Failed to query nonexistent");
        assert_eq!(nonexistent, None);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_global_and_project_config_are_independent() {
        let (db, path) = make_test_db("independent_configs");

        db.set_config("github_token", "global-token-456")
            .expect("Failed to set global github_token");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("Failed to create project");

        db.set_project_config(&project.id, "github_default_repo", "owner/repo")
            .expect("Failed to set project github_default_repo");

        let global_token = db
            .get_config("github_token")
            .expect("Failed to get global github_token");
        assert_eq!(global_token, Some("global-token-456".to_string()));

        let project_repo = db
            .get_project_config(&project.id, "github_default_repo")
            .expect("Failed to get project github_default_repo");
        assert_eq!(project_repo, Some("owner/repo".to_string()));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_migration_copies_credentials_to_global() {
        let path = format!("/tmp/test_migration_copy_{}.db", std::process::id());
        let _ = fs::remove_file(&path);

        {
            let db = Database::new(PathBuf::from(&path)).expect("Failed to create DB");
            let project = db
                .create_project("Test Project", "/tmp/test")
                .expect("Failed to create project");
            db.set_project_config(&project.id, "jira_api_token", "proj-token")
                .expect("set");
            db.set_project_config(&project.id, "jira_base_url", "https://test.atlassian.net")
                .expect("set");
            db.set_project_config(&project.id, "jira_username", "user@test.com")
                .expect("set");
            db.set_project_config(&project.id, "github_token", "ghp_testtoken")
                .expect("set");
        }

        let db = Database::new(PathBuf::from(&path)).expect("Failed to reopen DB");
        assert_eq!(
            db.get_config("jira_api_token").unwrap(),
            Some("proj-token".to_string())
        );
        assert_eq!(
            db.get_config("jira_base_url").unwrap(),
            Some("https://test.atlassian.net".to_string())
        );
        assert_eq!(
            db.get_config("jira_username").unwrap(),
            Some("user@test.com".to_string())
        );
        assert_eq!(
            db.get_config("github_token").unwrap(),
            Some("ghp_testtoken".to_string())
        );

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_migration_does_not_overwrite_existing_global() {
        let path = format!("/tmp/test_migration_idempotent_{}.db", std::process::id());
        let _ = fs::remove_file(&path);

        {
            let db = Database::new(PathBuf::from(&path)).expect("Failed to create DB");
            db.set_config("jira_api_token", "existing-token")
                .expect("set");
            let project = db
                .create_project("Test Project", "/tmp/test")
                .expect("Failed to create project");
            db.set_project_config(&project.id, "jira_api_token", "project-token")
                .expect("set");
        }

        let db = Database::new(PathBuf::from(&path)).expect("Failed to reopen DB");
        assert_eq!(
            db.get_config("jira_api_token").unwrap(),
            Some("existing-token".to_string())
        );

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_mark_running_sessions_interrupted() {
        let (db, path) = make_test_db("mark_interrupted");
        insert_test_task(&db);

        db.create_agent_session("ses-run1", "T-100", None, "implement", "running")
            .expect("create running 1 failed");
        db.create_agent_session("ses-run2", "T-100", None, "implement", "running")
            .expect("create running 2 failed");
        db.create_agent_session("ses-done", "T-100", None, "implement", "completed")
            .expect("create completed failed");
        db.create_agent_session("ses-fail", "T-100", None, "implement", "failed")
            .expect("create failed failed");

        let count = db
            .mark_running_sessions_interrupted()
            .expect("mark interrupted failed");
        assert_eq!(count, 2);

        let s1 = db.get_agent_session("ses-run1").expect("get").unwrap();
        assert_eq!(s1.status, "interrupted");
        assert_eq!(
            s1.error_message,
            Some("Session interrupted by app restart".to_string())
        );

        let s2 = db.get_agent_session("ses-run2").expect("get").unwrap();
        assert_eq!(s2.status, "interrupted");

        let s3 = db.get_agent_session("ses-done").expect("get").unwrap();
        assert_eq!(s3.status, "completed");

        let s4 = db.get_agent_session("ses-fail").expect("get").unwrap();
        assert_eq!(s4.status, "failed");

        let count2 = db
            .mark_running_sessions_interrupted()
            .expect("second call failed");
        assert_eq!(count2, 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_clear_stale_worktree_servers() {
        let (db, path) = make_test_db("clear_stale_servers");

        // Create a project (required FK for worktrees)
        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create project failed");

        // Create task T-100
        insert_test_task(&db);

        // Create worktree for T-100 and set port
        db.create_worktree_record("T-100", &project.id, "/tmp/repo", "/tmp/wt1", "branch-1")
            .expect("create wt1 failed");
        db.update_worktree_server("T-100", 12345, 0)
            .expect("set port 1 failed");

        // Create task T-200
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, status, jira_key, jira_status, jira_assignee, plan_text, project_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params!["T-200", "Test task 2", "backlog", "PROJ-200", "To Do", "bob", None::<String>, None::<String>, 1000, 1000],
        ).expect("Failed to insert test task T-200");
        drop(conn);

        // Create worktree for T-200 and set port
        db.create_worktree_record("T-200", &project.id, "/tmp/repo", "/tmp/wt2", "branch-2")
            .expect("create wt2 failed");
        db.update_worktree_server("T-200", 54321, 0)
            .expect("set port 2 failed");

        // Create task T-300
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, status, jira_key, jira_status, jira_assignee, plan_text, project_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params!["T-300", "Test task 3", "backlog", "PROJ-300", "To Do", "charlie", None::<String>, None::<String>, 1000, 1000],
        ).expect("Failed to insert test task T-300");
        drop(conn);

        // Create worktree for T-300 WITHOUT setting port (already NULL)
        db.create_worktree_record("T-300", &project.id, "/tmp/repo", "/tmp/wt3", "branch-3")
            .expect("create wt3 failed");

        // Call clear_stale_worktree_servers, should clear 2 worktrees
        let count = db
            .clear_stale_worktree_servers()
            .expect("clear_stale_worktree_servers failed");
        assert_eq!(count, 2);

        // Verify T-100 worktree is cleared
        let wt1 = db
            .get_worktree_for_task("T-100")
            .expect("get wt1 failed")
            .expect("wt1 not found");
        assert_eq!(wt1.opencode_port, None);
        assert_eq!(wt1.opencode_pid, None);

        // Verify T-200 worktree is cleared
        let wt2 = db
            .get_worktree_for_task("T-200")
            .expect("get wt2 failed")
            .expect("wt2 not found");
        assert_eq!(wt2.opencode_port, None);
        assert_eq!(wt2.opencode_pid, None);

        // Verify T-300 worktree is still NULL (was already NULL)
        let wt3 = db
            .get_worktree_for_task("T-300")
            .expect("get wt3 failed")
            .expect("wt3 not found");
        assert_eq!(wt3.opencode_port, None);

        // Call again, should return 0 (idempotent)
        let count2 = db
            .clear_stale_worktree_servers()
            .expect("second call failed");
        assert_eq!(count2, 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_review_pr_upsert_and_retrieve() {
        let (db, path) = make_test_db("review_pr_upsert");

        // Insert a review PR with full fields
        db.upsert_review_pr(
            123,
            456,
            "Add new feature",
            Some("This PR adds a new feature"),
            "open",
            false,
            "https://github.com/owner/repo/pull/456",
            "octocat",
            Some("https://avatars.githubusercontent.com/u/1?v=4"),
            "owner",
            "repo",
            "feature-branch",
            "main",
            "abc123def",
            100,
            50,
            10,
            1000,
            2000,
        )
        .expect("upsert failed");

        // Retrieve and verify all fields
        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].id, 123);
        assert_eq!(prs[0].number, 456);
        assert_eq!(prs[0].title, "Add new feature");
        assert_eq!(prs[0].body, Some("This PR adds a new feature".to_string()));
        assert_eq!(prs[0].state, "open");
        assert_eq!(prs[0].draft, false);
        assert_eq!(prs[0].html_url, "https://github.com/owner/repo/pull/456");
        assert_eq!(prs[0].user_login, "octocat");
        assert_eq!(
            prs[0].user_avatar_url,
            Some("https://avatars.githubusercontent.com/u/1?v=4".to_string())
        );
        assert_eq!(prs[0].repo_owner, "owner");
        assert_eq!(prs[0].repo_name, "repo");
        assert_eq!(prs[0].head_ref, "feature-branch");
        assert_eq!(prs[0].base_ref, "main");
        assert_eq!(prs[0].head_sha, "abc123def");
        assert_eq!(prs[0].additions, 100);
        assert_eq!(prs[0].deletions, 50);
        assert_eq!(prs[0].changed_files, 10);
        assert_eq!(prs[0].created_at, 1000);
        assert_eq!(prs[0].updated_at, 2000);

        // Update the same PR with a new title
        db.upsert_review_pr(
            123,
            456,
            "Add new feature - updated",
            Some("This PR adds a new feature"),
            "open",
            false,
            "https://github.com/owner/repo/pull/456",
            "octocat",
            Some("https://avatars.githubusercontent.com/u/1?v=4"),
            "owner",
            "repo",
            "feature-branch",
            "main",
            "abc123def",
            100,
            50,
            10,
            1000,
            3000,
        )
        .expect("upsert update failed");

        // Verify still 1 row with new title
        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].title, "Add new feature - updated");
        assert_eq!(prs[0].updated_at, 3000);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_review_pr_delete_stale() {
        let (db, path) = make_test_db("review_pr_stale");

        // Insert 3 review PRs
        db.upsert_review_pr(
            100,
            1,
            "PR 1",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/1",
            "user1",
            None,
            "owner",
            "repo",
            "branch1",
            "main",
            "sha1",
            10,
            5,
            2,
            1000,
            1000,
        )
        .expect("insert 1 failed");
        db.upsert_review_pr(
            200,
            2,
            "PR 2",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/2",
            "user2",
            None,
            "owner",
            "repo",
            "branch2",
            "main",
            "sha2",
            20,
            10,
            3,
            2000,
            2000,
        )
        .expect("insert 2 failed");
        db.upsert_review_pr(
            300,
            3,
            "PR 3",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/3",
            "user3",
            None,
            "owner",
            "repo",
            "branch3",
            "main",
            "sha3",
            30,
            15,
            4,
            3000,
            3000,
        )
        .expect("insert 3 failed");

        // Keep only ids 100 and 300, delete 200
        db.delete_stale_review_prs(&[100, 300])
            .expect("delete stale failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 2);
        assert!(prs.iter().any(|pr| pr.id == 100));
        assert!(prs.iter().any(|pr| pr.id == 300));
        assert!(!prs.iter().any(|pr| pr.id == 200));

        // Delete all by passing empty slice
        db.delete_stale_review_prs(&[]).expect("delete all failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_review_pr_ordering() {
        let (db, path) = make_test_db("review_pr_ordering");

        // Insert 2 review PRs with different updated_at values
        db.upsert_review_pr(
            1,
            10,
            "Older PR",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/10",
            "user1",
            None,
            "owner",
            "repo",
            "branch1",
            "main",
            "sha1",
            10,
            5,
            2,
            1000,
            1000,
        )
        .expect("insert older failed");
        db.upsert_review_pr(
            2,
            20,
            "Newer PR",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/20",
            "user2",
            None,
            "owner",
            "repo",
            "branch2",
            "main",
            "sha2",
            20,
            10,
            3,
            2000,
            5000,
        )
        .expect("insert newer failed");

        // Verify descending order by updated_at
        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 2);
        assert_eq!(prs[0].id, 2); // Newer PR first
        assert_eq!(prs[1].id, 1); // Older PR second

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_ci_status_migration() {
        let (db, path) = make_test_db("ci_migration");

        // Verify columns exist by querying pragma
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

        // Re-insert PR (simulating 30s sync cycle) - this must NOT wipe CI data
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

        let id1 = db
            .insert_self_review_comment("T-100", "general", None, None, "Round 1 comment 1")
            .expect("insert 1 failed");
        let id2 = db
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

        let id3 = db
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
            "INSERT INTO tasks (id, title, status, jira_key, jira_status, jira_assignee, plan_text, project_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params!["T-200", "Test task 2", "backlog", "PROJ-200", "To Do", "bob", None::<String>, None::<String>, 1000, 1000],
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

        db.insert_pr_comment(801, 50, "alice", "c1", "review_comment", None, None, 5000)
            .expect("insert c1 failed");
        db.insert_pr_comment(802, 50, "bob", "c2", "review_comment", None, None, 5001)
            .expect("insert c2 failed");
        db.insert_pr_comment(803, 50, "carol", "c3", "review_comment", None, None, 5002)
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
}
