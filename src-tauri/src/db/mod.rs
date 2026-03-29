use log::warn;
use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

mod agent_review;
mod agents;
mod authored_prs;
mod board_status;
mod config;
pub(crate) mod migrations;
mod projects;
mod pull_requests;
mod review;
mod self_review;
mod task_workspaces;
mod tasks;
mod worktrees;

pub use agent_review::AgentReviewCommentRow;
pub use agents::AgentSessionRow;
pub use authored_prs::AuthoredPrRow;
pub use board_status::BoardStatus;
pub use projects::{ProjectAttentionRow, ProjectRow};
pub use pull_requests::{PrCommentRow, PrRow};
pub use review::ReviewPrRow;
pub use self_review::SelfReviewCommentRow;
pub use task_workspaces::TaskWorkspaceRow;
pub use tasks::{TaskRow, WorkQueueTaskRow};
pub use worktrees::WorktreeRow;

/// Database connection wrapper for thread-safe access
pub struct Database {
    pub(crate) conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        }

        let mut conn = Connection::open(&db_path)?;

        migrations::bootstrap_existing_db(&conn)?;

        migrations::get_migrations()
            .to_latest(&mut conn)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        migrations::ensure_tasks_columns(&conn)?;
        migrations::ensure_mergeability_columns(&conn)?;

        conn.execute("PRAGMA foreign_keys = ON", [])?;

        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
        };

        Ok(db)
    }

    pub fn connection(&self) -> Arc<Mutex<Connection>> {
        Arc::clone(&self.conn)
    }
}

pub fn acquire_db(db: &std::sync::Mutex<Database>) -> std::sync::MutexGuard<'_, Database> {
    match db.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            warn!("[db] Warning: recovering from poisoned mutex");
            poisoned.into_inner()
        }
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
            "INSERT INTO tasks (id, initial_prompt, status, project_id, created_at, updated_at, prompt, summary, agent, permission_mode) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params!["T-100", "Test task", "backlog", None::<String>, 1000, 1000, "Test task", None::<String>, None::<String>, None::<String>],
        ).expect("Failed to insert test task");
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    #[test]
    fn test_acquire_db_with_healthy_mutex() {
        let (db, db_path) = super::test_helpers::make_test_db("acquire_db_healthy");
        let mutex = std::sync::Mutex::new(db);
        let guard = super::acquire_db(&mutex);
        assert!(guard.get_config("opencode_port").is_ok());
        drop(guard);
        drop(mutex);
        let _ = fs::remove_file(&db_path);
    }
}
