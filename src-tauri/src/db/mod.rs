use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

mod agents;
mod config;
mod projects;
mod pull_requests;
mod review;
mod self_review;
mod tasks;
mod worktrees;

pub use agents::{AgentLogRow, AgentSessionRow};
pub use projects::ProjectRow;
pub use pull_requests::{PrCommentRow, PrRow};
pub use review::ReviewPrRow;
pub use self_review::SelfReviewCommentRow;
pub use tasks::TaskRow;
pub use worktrees::WorktreeRow;

/// Database connection wrapper for thread-safe access
pub struct Database {
    pub(crate) conn: Arc<Mutex<Connection>>,
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
            ("github_poll_interval", "15"),
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
        // Migration: Add review_status column to pull_requests table
        // ============================================================================
        let review_status_exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('pull_requests') WHERE name='review_status'",
            [],
            |row| {
                let count: i64 = row.get(0)?;
                Ok(count > 0)
            },
        )?;

        if !review_status_exists {
            conn.execute(
                "ALTER TABLE pull_requests ADD COLUMN review_status TEXT",
                [],
            )?;
        }

        // ============================================================================
        // Migration: Add merged_at column to pull_requests table
        // ============================================================================
        let merged_at_exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('pull_requests') WHERE name='merged_at'",
            [],
            |row| {
                let count: i64 = row.get(0)?;
                Ok(count > 0)
            },
        )?;

        if !merged_at_exists {
            conn.execute("ALTER TABLE pull_requests ADD COLUMN merged_at INTEGER", [])?;
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

        // ============================================================================
        // Migration: Add jira_title column to tasks table
        // ============================================================================
        let jira_title_exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name='jira_title'",
            [],
            |row| {
                let count: i64 = row.get(0)?;
                Ok(count > 0)
            },
        )?;

        if !jira_title_exists {
            conn.execute("ALTER TABLE tasks ADD COLUMN jira_title TEXT", [])?;
        }

        // ============================================================================
        // Migration: Add jira_description column to tasks table
        // ============================================================================
        let jira_description_exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name='jira_description'",
            [],
            |row| {
                let count: i64 = row.get(0)?;
                Ok(count > 0)
            },
        )?;

        if !jira_description_exists {
            conn.execute("ALTER TABLE tasks ADD COLUMN jira_description TEXT", [])?;
        }

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

        // ============================================================================
        // Retroactive migration: Mark existing bot comments as addressed
        // ============================================================================
        conn.execute(
            "UPDATE pr_comments SET addressed = 1 WHERE author LIKE '%[bot]%' AND addressed = 0",
            [],
        )?;

        Ok(())
    }

    /// Get a reference to the connection for executing queries
    pub fn connection(&self) -> Arc<Mutex<Connection>> {
        Arc::clone(&self.conn)
    }
}

#[cfg(test)]
pub mod test_helpers {
    use super::*;
    use std::fs;

    pub fn make_test_db(name: &str) -> (Database, std::path::PathBuf) {
        let db_path = std::env::temp_dir().join(format!("test_{}.db", name));
        let _ = fs::remove_file(&db_path);
        let db = Database::new(db_path.clone()).expect("Failed to create database");
        (db, db_path)
    }

    pub fn insert_test_task(db: &Database) {
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, status, jira_key, jira_title, jira_status, jira_assignee, plan_text, project_id, created_at, updated_at, jira_description) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params!["T-100", "Test task", "backlog", "PROJ-100", "Test task summary", "To Do", "alice", None::<String>, None::<String>, 1000, 1000, None::<String>],
        ).expect("Failed to insert test task");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

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
}
