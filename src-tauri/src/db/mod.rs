use rusqlite::{Connection, Result};
use std::path::PathBuf;
use rusqlite_migration::{Migrations, M};
use std::sync::{Arc, Mutex};

mod agents;
mod config;
mod projects;
mod pull_requests;
mod review;
mod self_review;
mod tasks;
mod worktrees;
mod agent_review;

pub use agents::{AgentLogRow, AgentSessionRow};
pub use projects::{ProjectAttentionRow, ProjectRow};
pub use pull_requests::{PrCommentRow, PrRow};
pub use review::ReviewPrRow;
pub use self_review::SelfReviewCommentRow;
pub use tasks::TaskRow;
pub use worktrees::WorktreeRow;
pub use agent_review::AgentReviewCommentRow;

/// Database connection wrapper for thread-safe access
pub struct Database {
    pub(crate) conn: Arc<Mutex<Connection>>,
}

impl Database {
    /// Initialize the database at the given path
    /// Creates the database file if it doesn't exist and runs all versioned migrations
    /// using rusqlite_migration. Existing databases are bootstrapped via PRAGMA user_version.
    pub fn new(db_path: PathBuf) -> Result<Self> {
        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        }

        let mut conn = Connection::open(&db_path)?;

        // Bootstrap existing databases before running migrations
        bootstrap_existing_db(&conn)?;

        // Run versioned migrations
        get_migrations()
            .to_latest(&mut conn)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        // Enable foreign keys AFTER migrations (pragma is a no-op inside transactions)
        conn.execute("PRAGMA foreign_keys = ON", [])?;

        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
        };



        Ok(db)
    }



    /// Get a reference to the connection for executing queries
    pub fn connection(&self) -> Arc<Mutex<Connection>> {
        Arc::clone(&self.conn)
    }
}

/// Detects existing databases (created before the migration system) and sets
/// user_version to skip V1 migration (which would be a no-op anyway since
/// tables already exist with IF NOT EXISTS).
fn bootstrap_existing_db(conn: &Connection) -> Result<()> {
    let uv: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if uv == 0 {
        let has_tasks: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='tasks'",
            [],
            |r| r.get(0),
        )?;
        if has_tasks {
            conn.execute("PRAGMA user_version = 1", [])?;
        }
    }
    Ok(())
}

/// Returns the complete V1 migration set for this application.
/// This is the single source of truth for schema version management.
pub(crate) fn get_migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up_with_hook(
            r#"
DROP TABLE IF EXISTS agent_logs;
DROP TABLE IF EXISTS pr_comments;
DROP TABLE IF EXISTS agent_sessions;
DROP TABLE IF EXISTS pull_requests;
DROP TABLE IF EXISTS tickets;

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    jira_key TEXT,
    jira_status TEXT,
    jira_assignee TEXT,
    plan_text TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    project_id TEXT REFERENCES projects(id),
    jira_title TEXT,
    jira_description TEXT
);

CREATE TABLE IF NOT EXISTS agent_sessions (
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
);

CREATE TABLE IF NOT EXISTS agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    log_type TEXT NOT NULL,
    content TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
);

CREATE TABLE IF NOT EXISTS pull_requests (
    id INTEGER PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    head_sha TEXT NOT NULL DEFAULT '',
    ci_status TEXT,
    ci_check_runs TEXT,
    last_polled_at INTEGER DEFAULT 0,
    review_status TEXT,
    merged_at INTEGER,
    FOREIGN KEY (ticket_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS pr_comments (
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
);

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_config (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    UNIQUE(project_id, key)
);

CREATE TABLE IF NOT EXISTS worktrees (
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
);

CREATE TABLE IF NOT EXISTS review_prs (
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
    updated_at INTEGER NOT NULL,
    viewed_at INTEGER,
    viewed_head_sha TEXT
);

CREATE TABLE IF NOT EXISTS self_review_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    round INTEGER NOT NULL DEFAULT 1,
    comment_type TEXT NOT NULL,
    file_path TEXT,
    line_number INTEGER,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    archived_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_self_review_comments_task_archived ON self_review_comments(task_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_self_review_comments_task_round ON self_review_comments(task_id, round);
CREATE INDEX IF NOT EXISTS idx_review_prs_updated_at ON review_prs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_prs_repo ON review_prs(repo_owner, repo_name);

INSERT OR IGNORE INTO config (key, value) VALUES ('jira_api_token', '');
INSERT OR IGNORE INTO config (key, value) VALUES ('jira_base_url', '');
INSERT OR IGNORE INTO config (key, value) VALUES ('jira_board_id', '');
INSERT OR IGNORE INTO config (key, value) VALUES ('jira_username', '');
INSERT OR IGNORE INTO config (key, value) VALUES ('filter_assigned_to_me', 'true');
INSERT OR IGNORE INTO config (key, value) VALUES ('exclude_done_tickets', 'true');
INSERT OR IGNORE INTO config (key, value) VALUES ('custom_jql', '');
INSERT OR IGNORE INTO config (key, value) VALUES ('github_token', '');
INSERT OR IGNORE INTO config (key, value) VALUES ('github_default_repo', '');
INSERT OR IGNORE INTO config (key, value) VALUES ('opencode_port', '4096');
INSERT OR IGNORE INTO config (key, value) VALUES ('opencode_auto_start', 'true');
INSERT OR IGNORE INTO config (key, value) VALUES ('jira_poll_interval', '60');
INSERT OR IGNORE INTO config (key, value) VALUES ('github_poll_interval', '15');
INSERT OR IGNORE INTO config (key, value) VALUES ('next_task_id', '1');
INSERT OR IGNORE INTO config (key, value) VALUES ('next_project_id', '1')
            "#,
            |tx| {
                // One-time migration: Copy per-project credentials to global config
                let global_token: String = tx
                    .query_row(
                        "SELECT value FROM config WHERE key = 'jira_api_token'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap_or_default();

                if global_token.is_empty() {
                    let source_project: Option<String> = tx.query_row(
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
                            let value: String = tx
                                .query_row(
                                    "SELECT value FROM project_config WHERE project_id = ?1 AND key = ?2",
                                    rusqlite::params![project_id, key],
                                    |row| row.get(0),
                                )
                                .unwrap_or_default();
                            if !value.is_empty() {
                                tx.execute(
                                    "UPDATE config SET value = ?1 WHERE key = ?2",
                                    rusqlite::params![value, key],
                                ).map_err(rusqlite_migration::HookError::RusqliteError)?;
                            }
                        }
                    }
                }

                // One-time migration: Simplify kanban columns from 5 to 3
                tx.execute(
                    "UPDATE tasks SET status = 'backlog' WHERE status = 'todo'",
                    [],
                ).map_err(rusqlite_migration::HookError::RusqliteError)?;
                tx.execute(
                    "UPDATE tasks SET status = 'doing' WHERE status IN ('in_progress', 'in_review', 'testing')",
                    [],
                ).map_err(rusqlite_migration::HookError::RusqliteError)?;
                tx.execute(
                    "UPDATE tasks SET status = 'backlog' WHERE status NOT IN ('backlog', 'doing', 'done')",
                    [],
                ).map_err(rusqlite_migration::HookError::RusqliteError)?;

                Ok(())
            },
        ),
        M::up(
            r#"
CREATE TABLE IF NOT EXISTS agent_review_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_pr_id INTEGER NOT NULL,
    review_session_key TEXT NOT NULL,
    comment_type TEXT NOT NULL,
    file_path TEXT,
    line_number INTEGER,
    side TEXT,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    opencode_session_id TEXT,
    raw_agent_output TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (review_pr_id) REFERENCES review_prs(id)
);
CREATE INDEX IF NOT EXISTS idx_agent_review_comments_pr ON agent_review_comments(review_pr_id);
CREATE INDEX IF NOT EXISTS idx_agent_review_comments_session ON agent_review_comments(review_session_key);
            "#
        ),
    ])
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
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('tasks', 'agent_sessions', 'agent_logs', 'pull_requests', 'pr_comments', 'config', 'projects', 'project_config', 'worktrees', 'review_prs', 'self_review_comments', 'agent_review_comments')",
                [],
                |row| row.get(0),
            )
            .expect("Failed to count tables");

        assert_eq!(table_count, 12, "All 12 tables should be created");

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

        // Simulate an existing database with project_config data (pre-migration)
        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            // Create minimal schema to simulate old database
            conn.execute(
                "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
                [],
            ).expect("create projects table");
            conn.execute(
                "CREATE TABLE project_config (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(project_id, key))",
                [],
            ).expect("create project_config table");
            conn.execute(
                "CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
                [],
            ).expect("create config table");
            // Insert a project with credentials
            conn.execute(
                "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                rusqlite::params!["proj-1", "Test Project", "/tmp/test", 1000, 1000],
            ).expect("insert project");
            conn.execute(
                "INSERT INTO project_config (project_id, key, value) VALUES (?, ?, ?)",
                rusqlite::params!["proj-1", "jira_api_token", "proj-token"],
            ).expect("insert jira_api_token");
            conn.execute(
                "INSERT INTO project_config (project_id, key, value) VALUES (?, ?, ?)",
                rusqlite::params!["proj-1", "jira_base_url", "https://test.atlassian.net"],
            ).expect("insert jira_base_url");
            conn.execute(
                "INSERT INTO project_config (project_id, key, value) VALUES (?, ?, ?)",
                rusqlite::params!["proj-1", "jira_username", "user@test.com"],
            ).expect("insert jira_username");
            conn.execute(
                "INSERT INTO project_config (project_id, key, value) VALUES (?, ?, ?)",
                rusqlite::params!["proj-1", "github_token", "ghp_testtoken"],
            ).expect("insert github_token");
        }

        // Now open with Database::new() which will run the migration hook
        let db = Database::new(PathBuf::from(&path)).expect("Failed to open DB");

        // Verify credentials were copied to global config by the migration hook
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
    fn test_indexes_created_on_migration() {
        let path = format!("/tmp/test_indexes_{}.db", std::process::id());
        let _ = fs::remove_file(&path);

        let db = Database::new(PathBuf::from(&path)).expect("Failed to create DB");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        // Verify all 4 indexes exist in sqlite_master
        let index_names = vec![
            "idx_self_review_comments_task_archived",
            "idx_self_review_comments_task_round",
            "idx_review_prs_updated_at",
            "idx_review_prs_repo",
        ];

        for index_name in index_names {
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
                    rusqlite::params![index_name],
                    |row| {
                        let count: i64 = row.get(0)?;
                        Ok(count > 0)
                    },
                )
                .expect("Failed to query sqlite_master");

            assert!(exists, "Index {} should exist", index_name);
        }

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_migrations_validate() {
        let migrations = super::get_migrations();
        migrations.validate().expect("migrations should be valid");
    }

    #[test]
    fn test_bootstrap_existing_db() {
        let path = std::env::temp_dir().join(format!("test_bootstrap_{}.db", std::process::id()));
        let _ = fs::remove_file(&path);

        // Create a raw database with the tasks table (simulating existing DB)
        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            conn.execute(
                "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
                [],
            ).expect("create tasks table");
            let uv: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
            assert_eq!(uv, 0, "user_version should be 0 before bootstrap");
        }

        // Now open with Database::new() which should bootstrap
        let db = Database::new(path.clone()).expect("Database::new on existing db");
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        let uv: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert!(uv >= 1, "user_version should be >= 1 after bootstrap, got {}", uv);

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_new_db_user_version() {
        let path = std::env::temp_dir().join(format!("test_uv_{}.db", std::process::id()));
        let _ = fs::remove_file(&path);

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        let uv: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(uv, 2, "Fresh DB should have user_version=2 after migrations, got {}", uv);

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

}
