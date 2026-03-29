use rusqlite::{Connection, Result};
use rusqlite_migration::{Migrations, M};

/// The user_version that a fully-migrated fresh database will have.
/// Equals the number of migrations returned by [`get_migrations`].
pub const LATEST_USER_VERSION: i32 = 19;

/// Returns the complete migration set for this application.
/// This is the single source of truth for schema version management.
pub fn get_migrations() -> Migrations<'static> {
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
    plan_text TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    project_id TEXT REFERENCES projects(id)
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
    mergeable INTEGER,
    mergeable_state TEXT,
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
    mergeable INTEGER,
    mergeable_state TEXT,
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

INSERT OR IGNORE INTO config (key, value) VALUES ('github_token', '');
INSERT OR IGNORE INTO config (key, value) VALUES ('github_default_repo', '');
INSERT OR IGNORE INTO config (key, value) VALUES ('opencode_port', '4096');
INSERT OR IGNORE INTO config (key, value) VALUES ('opencode_auto_start', 'true');
INSERT OR IGNORE INTO config (key, value) VALUES ('github_poll_interval', '15');
INSERT OR IGNORE INTO config (key, value) VALUES ('next_task_id', '1');
INSERT OR IGNORE INTO config (key, value) VALUES ('next_project_id', '1')
            "#,
            |tx| {
                // One-time migration: Copy per-project credentials to global config
                let global_token: String = tx
                    .query_row(
                        "SELECT value FROM config WHERE key = 'github_token'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap_or_default();

                if global_token.is_empty() {
                    let source_project: Option<String> = tx.query_row(
                        "SELECT project_id FROM project_config WHERE key = 'github_token' AND value != '' LIMIT 1",
                        [],
                        |row| row.get(0),
                    ).ok();

                    if let Some(project_id) = source_project {
                        let value: String = tx
                            .query_row(
                                "SELECT value FROM project_config WHERE project_id = ?1 AND key = 'github_token'",
                                rusqlite::params![project_id],
                                |row| row.get(0),
                            )
                            .unwrap_or_default();
                        if !value.is_empty() {
                            tx.execute(
                                "UPDATE config SET value = ?1 WHERE key = 'github_token'",
                                rusqlite::params![value],
                            )
                            .map_err(rusqlite_migration::HookError::RusqliteError)?;
                        }
                    }
                }

                // One-time migration: Simplify kanban columns from 5 to 3
                tx.execute(
                    "UPDATE tasks SET status = 'backlog' WHERE status = 'todo'",
                    [],
                )
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
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
        M::up_with_hook(
            r#"
            "#,
            |tx| {
                // Only add columns if the table exists (for fresh databases)
                let table_exists: bool = tx.query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='agent_sessions'",
                    [],
                    |r| r.get(0),
                ).unwrap_or(false);

                if table_exists {
                    tx.execute(
                        "ALTER TABLE agent_sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'opencode'",
                        [],
                    ).ok();
                    tx.execute(
                        "ALTER TABLE agent_sessions ADD COLUMN claude_session_id TEXT",
                        [],
                    )
                    .ok();
                }

                // Only insert config if the table exists
                let config_exists: bool = tx.query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='config'",
                    [],
                    |r| r.get(0),
                ).unwrap_or(false);

                if config_exists {
                    tx.execute(
                        "INSERT OR IGNORE INTO config (key, value) VALUES ('ai_provider', 'opencode')",
                        [],
                    ).ok();
                }
                Ok(())
            },
        ),
        M::up_with_hook(r#""#, |tx| {
            let config_exists: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='config'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);

            if config_exists {
                tx.execute(
                        "UPDATE config SET value = 'claude-code' WHERE key = 'ai_provider' AND value = 'opencode'",
                        [],
                    ).map_err(rusqlite_migration::HookError::RusqliteError)?;
            }
            Ok(())
        }),
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
            "#,
        ),
        M::up_with_hook("", |tx| {
            let has_column: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'plan_text'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if has_column {
                tx.execute("ALTER TABLE tasks DROP COLUMN plan_text", [])
                    .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }
            Ok(())
        }),
        M::up_with_hook("", |tx| {
            let has_prompt: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'prompt'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if !has_prompt {
                tx.execute("ALTER TABLE tasks ADD COLUMN prompt TEXT", [])
                    .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }

            let has_summary: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'summary'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if !has_summary {
                tx.execute("ALTER TABLE tasks ADD COLUMN summary TEXT", [])
                    .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }

            tx.execute("UPDATE tasks SET prompt = title WHERE prompt IS NULL", [])
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
            Ok(())
        }),
        M::up_with_hook(r#""#, |tx| {
            let config_exists: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='config'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);

            if config_exists {
                tx.execute(
                    "INSERT OR IGNORE INTO config (key, value) VALUES ('task_id_prefix', '')",
                    [],
                )
                .map_err(rusqlite_migration::HookError::RusqliteError)?;

                use rand::Rng;
                let mut rng = rand::thread_rng();
                let prefix: String = (0..3)
                    .map(|_| {
                        let idx = rng.gen_range(0..26);
                        (b'A' + idx as u8) as char
                    })
                    .collect();

                tx.execute(
                    "UPDATE config SET value = ?1 WHERE key = 'task_id_prefix' AND value = ''",
                    rusqlite::params![prefix],
                )
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }
            Ok(())
        }),
        M::up_with_hook("", |tx| {
            let has_agent: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'agent'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if !has_agent {
                tx.execute("ALTER TABLE tasks ADD COLUMN agent TEXT", [])
                    .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }

            let has_permission_mode: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'permission_mode'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if !has_permission_mode {
                tx.execute("ALTER TABLE tasks ADD COLUMN permission_mode TEXT", [])
                    .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }

            Ok(())
        }),
        // V9: Copy global ai_provider to all existing projects' project_config
        M::up_with_hook("", |tx| {
            let has_table: bool = tx.query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='project_config'",
                [],
                |r| r.get(0),
            ).unwrap_or(false);

            if has_table {
                let global_provider: String = tx
                    .query_row(
                        "SELECT value FROM config WHERE key = 'ai_provider'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap_or_else(|_| "claude-code".to_string());

                tx.execute(
                    "INSERT OR IGNORE INTO project_config (project_id, key, value)
                     SELECT id, 'ai_provider', ?1 FROM projects",
                    rusqlite::params![global_provider],
                )
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }

            Ok(())
        }),
        // V10: Add draft column to pull_requests
        M::up_with_hook("", |tx| {
            let table_exists: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='pull_requests'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if table_exists {
                let has_draft: bool = tx
                    .query_row(
                        "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name = 'draft'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(false);
                if !has_draft {
                    tx.execute(
                        "ALTER TABLE pull_requests ADD COLUMN draft INTEGER NOT NULL DEFAULT 0",
                        [],
                    )
                    .map_err(rusqlite_migration::HookError::RusqliteError)?;
                }
            }
            Ok(())
        }),
        // V11: Drop unused agent_logs table
        M::up("DROP TABLE IF EXISTS agent_logs;"),
        // V12: Rename tasks.title → tasks.initial_prompt
        M::up("ALTER TABLE tasks RENAME COLUMN title TO initial_prompt;"),
        M::up(
            r#"
CREATE TABLE IF NOT EXISTS authored_prs (
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
    ci_status TEXT,
    ci_check_runs TEXT,
    review_status TEXT,
    mergeable INTEGER,
    mergeable_state TEXT,
    merged_at INTEGER,
    task_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_authored_prs_updated_at ON authored_prs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_authored_prs_repo ON authored_prs(repo_owner, repo_name);
CREATE INDEX IF NOT EXISTS idx_authored_prs_state ON authored_prs(state);

CREATE TABLE IF NOT EXISTS shepherd_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    event_context TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_shepherd_messages_project_created ON shepherd_messages(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS action_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'shepherd',
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    task_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    dismissed_at INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_action_items_project_status ON action_items(project_id, status);
            "#,
        ),
        // V14: Add is_queued for merge queue detection
        M::up(
            "ALTER TABLE pull_requests ADD COLUMN is_queued INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE authored_prs ADD COLUMN is_queued INTEGER NOT NULL DEFAULT 0;",
        ),
        M::up(
            r#"
CREATE TABLE IF NOT EXISTS action_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'shepherd',
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    task_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    dismissed_at INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_action_items_project_status ON action_items(project_id, status);
            "#,
        ),
        // V16: Backfill shepherd_messages for databases where V13 ran before it was added.
        M::up(
            r#"
CREATE TABLE IF NOT EXISTS shepherd_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    event_context TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_shepherd_messages_project_created ON shepherd_messages(project_id, created_at DESC);
            "#,
        ),
        M::up_with_hook("SELECT 1;", |tx| {
            for (table, column, sql) in [
                (
                    "pull_requests",
                    "mergeable",
                    "ALTER TABLE pull_requests ADD COLUMN mergeable INTEGER",
                ),
                (
                    "pull_requests",
                    "mergeable_state",
                    "ALTER TABLE pull_requests ADD COLUMN mergeable_state TEXT",
                ),
                (
                    "review_prs",
                    "mergeable",
                    "ALTER TABLE review_prs ADD COLUMN mergeable INTEGER",
                ),
                (
                    "review_prs",
                    "mergeable_state",
                    "ALTER TABLE review_prs ADD COLUMN mergeable_state TEXT",
                ),
                (
                    "authored_prs",
                    "mergeable",
                    "ALTER TABLE authored_prs ADD COLUMN mergeable INTEGER",
                ),
                (
                    "authored_prs",
                    "mergeable_state",
                    "ALTER TABLE authored_prs ADD COLUMN mergeable_state TEXT",
                ),
            ] {
                let has_table: bool = tx
                    .query_row(
                        &format!(
                            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='{}'",
                            table
                        ),
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(false);

                if !has_table {
                    continue;
                }

                let exists: bool = tx
                    .query_row(
                        &format!(
                            "SELECT COUNT(*) > 0 FROM pragma_table_info('{}') WHERE name = '{}'",
                            table, column
                        ),
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(false);

                if !exists {
                    tx.execute(sql, [])
                        .map_err(rusqlite_migration::HookError::RusqliteError)?;
                }
            }

            Ok(())
        }),
        M::up(
            r#"
CREATE TABLE IF NOT EXISTS task_workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id),
    workspace_path TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    kind TEXT NOT NULL,
    branch_name TEXT,
    provider_name TEXT NOT NULL,
    opencode_port INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_workspaces_status ON task_workspaces(status);
CREATE INDEX IF NOT EXISTS idx_task_workspaces_project ON task_workspaces(project_id, updated_at DESC);
            "#,
        ),
        M::up_with_hook("SELECT 1;", |tx| {
            let has_tasks_table: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='tasks'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);

            if has_tasks_table {
                for column in [
                    "jira_key",
                    "jira_title",
                    "jira_status",
                    "jira_assignee",
                    "jira_description",
                ] {
                    let exists: bool = tx
                        .query_row(
                            &format!(
                                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = '{}'",
                                column
                            ),
                            [],
                            |r| r.get(0),
                        )
                        .unwrap_or(false);
                    if exists {
                        tx.execute(&format!("ALTER TABLE tasks DROP COLUMN {}", column), [])
                            .map_err(rusqlite_migration::HookError::RusqliteError)?;
                    }
                }
            }

            let has_config_table: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='config'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if has_config_table {
                tx.execute(
                    "DELETE FROM config WHERE key LIKE 'jira_%' OR key IN ('custom_jql', 'filter_assigned_to_me', 'exclude_done_tickets')",
                    [],
                )
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }

            let has_project_config_table: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='project_config'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if has_project_config_table {
                tx.execute(
                    "DELETE FROM project_config WHERE key LIKE 'jira_%' OR key IN ('custom_jql', 'filter_assigned_to_me', 'exclude_done_tickets')",
                    [],
                )
                .map_err(rusqlite_migration::HookError::RusqliteError)?;
            }

            Ok(())
        }),
    ])
}

/// Detects existing databases (created before the migration system) and sets
/// user_version to skip V1 migration (which would be a no-op anyway since
/// tables already exist with IF NOT EXISTS).
pub(super) fn bootstrap_existing_db(conn: &Connection) -> Result<()> {
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

pub(super) fn ensure_tasks_columns(conn: &Connection) -> Result<()> {
    let has_tasks: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='tasks'",
        [],
        |r| r.get(0),
    )?;
    if !has_tasks {
        return Ok(());
    }

    for (col, backfill) in [
        ("prompt", true),
        ("summary", false),
        ("agent", false),
        ("permission_mode", false),
    ] {
        let exists: bool = conn.query_row(
            &format!(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = '{}'",
                col
            ),
            [],
            |r| r.get(0),
        )?;
        if !exists {
            conn.execute(&format!("ALTER TABLE tasks ADD COLUMN {} TEXT", col), [])?;
            if backfill {
                conn.execute(
                    "UPDATE tasks SET prompt = initial_prompt WHERE prompt IS NULL",
                    [],
                )?;
            }
        }
    }
    Ok(())
}

pub(super) fn ensure_mergeability_columns(conn: &Connection) -> Result<()> {
    for (table, column, sql) in [
        (
            "pull_requests",
            "mergeable",
            "ALTER TABLE pull_requests ADD COLUMN mergeable INTEGER",
        ),
        (
            "pull_requests",
            "mergeable_state",
            "ALTER TABLE pull_requests ADD COLUMN mergeable_state TEXT",
        ),
        (
            "review_prs",
            "mergeable",
            "ALTER TABLE review_prs ADD COLUMN mergeable INTEGER",
        ),
        (
            "review_prs",
            "mergeable_state",
            "ALTER TABLE review_prs ADD COLUMN mergeable_state TEXT",
        ),
        (
            "authored_prs",
            "mergeable",
            "ALTER TABLE authored_prs ADD COLUMN mergeable INTEGER",
        ),
        (
            "authored_prs",
            "mergeable_state",
            "ALTER TABLE authored_prs ADD COLUMN mergeable_state TEXT",
        ),
    ] {
        let has_table: bool = conn.query_row(
            &format!(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='{}'",
                table
            ),
            [],
            |r| r.get(0),
        )?;

        if !has_table {
            continue;
        }

        let exists: bool = conn.query_row(
            &format!(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('{}') WHERE name = '{}'",
                table, column
            ),
            [],
            |r| r.get(0),
        )?;

        if !exists {
            conn.execute(sql, [])?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn test_migrations_validate() {
        let migrations = get_migrations();
        migrations.validate().expect("migrations should be valid");
    }

    #[test]
    fn test_database_initialization() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join("test_openforge_mig.db");

        // Clean up if exists
        let _ = fs::remove_file(&db_path);

        // Create database
        let db = Database::new(db_path.clone()).expect("Failed to create database");

        // Verify tables exist by querying sqlite_master
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let table_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('tasks', 'agent_sessions', 'pull_requests', 'pr_comments', 'config', 'projects', 'project_config', 'worktrees', 'task_workspaces', 'review_prs', 'self_review_comments', 'agent_review_comments', 'authored_prs', 'shepherd_messages', 'action_items')",
                [],
                |row| row.get(0),
            )
            .expect("Failed to count tables");

        assert_eq!(table_count, 15, "All 15 tables should be created");

        let config_count: i32 = conn
            .query_row("SELECT COUNT(*) FROM config", [], |row| row.get(0))
            .expect("Failed to count config rows");

        assert_eq!(
            config_count, 9,
            "All 9 default config values should be inserted"
        );

        let jira_columns: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name IN ('jira_key', 'jira_title', 'jira_status', 'jira_assignee', 'jira_description')",
                [],
                |row| row.get(0),
            )
            .expect("Failed to count jira columns in tasks");
        assert_eq!(
            jira_columns, 0,
            "Fresh schema must not include jira columns in tasks table"
        );

        let jira_config_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM config WHERE key LIKE 'jira_%' OR key IN ('custom_jql', 'filter_assigned_to_me', 'exclude_done_tickets')",
                [],
                |row| row.get(0),
            )
            .expect("Failed to count jira-related config keys");
        assert_eq!(
            jira_config_count, 0,
            "Fresh schema must not seed jira-related config"
        );

        // Clean up
        drop(conn);
        drop(db);
        let _ = fs::remove_file(&db_path);
    }

    #[test]
    fn test_migration_copies_github_token_to_global() {
        let path = format!("/tmp/test_migration_copy_mig_{}.db", std::process::id());
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
            )
            .expect("create config table");
            // Insert a project with credentials
            conn.execute(
                "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                rusqlite::params!["proj-1", "Test Project", "/tmp/test", 1000, 1000],
            ).expect("insert project");
            conn.execute(
                "INSERT INTO project_config (project_id, key, value) VALUES (?, ?, ?)",
                rusqlite::params!["proj-1", "github_token", "ghp_testtoken"],
            )
            .expect("insert github_token");
        }

        // Now open with Database::new() which will run the migration hook
        let db = Database::new(PathBuf::from(&path)).expect("Failed to open DB");

        assert_eq!(
            db.get_config("github_token").unwrap(),
            Some("ghp_testtoken".to_string())
        );

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_migration_does_not_overwrite_existing_global() {
        let path = format!(
            "/tmp/test_migration_idempotent_mig_{}.db",
            std::process::id()
        );
        let _ = fs::remove_file(&path);

        {
            let db = Database::new(PathBuf::from(&path)).expect("Failed to create DB");
            db.set_config("github_token", "existing-token")
                .expect("set");
            let project = db
                .create_project("Test Project", "/tmp/test")
                .expect("Failed to create project");
            db.set_project_config(&project.id, "github_token", "project-token")
                .expect("set");
        }

        let db = Database::new(PathBuf::from(&path)).expect("Failed to reopen DB");
        assert_eq!(
            db.get_config("github_token").unwrap(),
            Some("existing-token".to_string())
        );

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_indexes_created_on_migration() {
        let path = format!("/tmp/test_indexes_mig_{}.db", std::process::id());
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
    fn test_bootstrap_existing_db() {
        let path =
            std::env::temp_dir().join(format!("test_bootstrap_mig_{}.db", std::process::id()));
        let _ = fs::remove_file(&path);

        // Create a raw database with the tasks table (simulating existing DB)
        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            conn.execute(
                "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
                [],
            ).expect("create tasks table");
            conn.execute(
                "CREATE TABLE pull_requests (
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
                )",
                [],
            )
            .expect("create pull_requests table");
            let uv: i32 = conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .unwrap();
            assert_eq!(uv, 0, "user_version should be 0 before bootstrap");
        }

        // Now open with Database::new() which should bootstrap
        let db = Database::new(path.clone()).expect("Database::new on existing db");
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        let uv: i32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert!(
            uv >= 1,
            "user_version should be >= 1 after bootstrap, got {}",
            uv
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_new_db_user_version() {
        let path = std::env::temp_dir().join(format!("test_uv_mig_{}.db", std::process::id()));
        let _ = fs::remove_file(&path);

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();
        let uv: i32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            uv, LATEST_USER_VERSION,
            "Fresh DB should have user_version={} after migrations, got {}",
            LATEST_USER_VERSION, uv
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_recreates_missing_action_items_table_for_upgraded_db() {
        let path = std::env::temp_dir().join(format!(
            "test_recreate_action_items_mig_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        {
            let db = Database::new(path.clone()).expect("Database::new");
            let conn = db.connection();
            let conn = conn.lock().unwrap();

            conn.execute("DROP TABLE action_items", [])
                .expect("drop action_items");
            conn.execute("PRAGMA user_version = 14", [])
                .expect("set pre-repair user_version");

            let uv: i32 = conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .expect("read user_version");
            assert_eq!(
                uv, 14,
                "fixture should simulate the pre-repair schema version"
            );
        }

        let db = Database::new(path.clone()).expect("Database::new should repair schema");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let has_action_items: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='action_items'",
                [],
                |r| r.get(0),
            )
            .expect("query sqlite_master");

        assert!(
            has_action_items,
            "Database::new should recreate missing action_items table for upgraded databases"
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_recreates_missing_action_items_table_from_v13_upgrade() {
        let path = std::env::temp_dir().join(format!(
            "test_recreate_action_items_v13_mig_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            conn.execute("PRAGMA user_version = 13", [])
                .expect("set v13 user_version");

            conn.execute(
                "CREATE TABLE projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    path TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )",
                [],
            )
            .expect("create projects table");

            conn.execute(
                "CREATE TABLE pull_requests (
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
                    merged_at INTEGER
                )",
                [],
            )
            .expect("create pull_requests table");

            conn.execute(
                "CREATE TABLE authored_prs (
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
                    ci_status TEXT,
                    ci_check_runs TEXT,
                    review_status TEXT,
                    merged_at INTEGER,
                    task_id TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )",
                [],
            )
            .expect("create authored_prs table");
        }

        let db = Database::new(path.clone()).expect("Database::new should repair v13 schema");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let has_action_items: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='action_items'",
                [],
                |r| r.get(0),
            )
            .expect("query sqlite_master for action_items");
        assert!(
            has_action_items,
            "V15 repair should create action_items from a v13 database"
        );

        let has_is_queued_pull_requests: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name = 'is_queued'",
                [],
                |r| r.get(0),
            )
            .expect("query pull_requests columns");
        assert!(
            has_is_queued_pull_requests,
            "V14 migration should still run before the action_items repair"
        );

        let has_is_queued_authored_prs: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('authored_prs') WHERE name = 'is_queued'",
                [],
                |r| r.get(0),
            )
            .expect("query authored_prs columns");
        assert!(
            has_is_queued_authored_prs,
            "V14 migration should add is_queued to authored_prs on the upgrade path"
        );

        let has_pull_request_mergeable: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name = 'mergeable'",
                [],
                |r| r.get(0),
            )
            .expect("query pull_requests mergeable column");
        assert!(
            has_pull_request_mergeable,
            "latest migration should add mergeable to pull_requests on the upgrade path"
        );
        let has_pull_request_mergeable_state: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('pull_requests') WHERE name = 'mergeable_state'",
                [],
                |r| r.get(0),
            )
            .expect("query pull_requests mergeable_state column");
        assert!(
            has_pull_request_mergeable_state,
            "latest migration should add mergeable_state to pull_requests on the upgrade path"
        );

        let has_review_prs: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='review_prs'",
                [],
                |r| r.get(0),
            )
            .expect("query sqlite_master for review_prs");
        if has_review_prs {
            let has_review_pr_mergeable: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM pragma_table_info('review_prs') WHERE name = 'mergeable'",
                    [],
                    |r| r.get(0),
                )
                .expect("query review_prs mergeable column");
            assert!(
                has_review_pr_mergeable,
                "latest migration should add mergeable to review_prs on the upgrade path"
            );
            let has_review_pr_mergeable_state: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM pragma_table_info('review_prs') WHERE name = 'mergeable_state'",
                    [],
                    |r| r.get(0),
                )
                .expect("query review_prs mergeable_state column");
            assert!(
                has_review_pr_mergeable_state,
                "latest migration should add mergeable_state to review_prs on the upgrade path"
            );
        }

        let has_authored_pr_mergeable: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('authored_prs') WHERE name = 'mergeable'",
                [],
                |r| r.get(0),
            )
            .expect("query authored_prs mergeable column");
        assert!(
            has_authored_pr_mergeable,
            "latest migration should add mergeable to authored_prs on the upgrade path"
        );
        let has_authored_pr_mergeable_state: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('authored_prs') WHERE name = 'mergeable_state'",
                [],
                |r| r.get(0),
            )
            .expect("query authored_prs mergeable_state column");
        assert!(
            has_authored_pr_mergeable_state,
            "latest migration should add mergeable_state to authored_prs on the upgrade path"
        );

        let uv: i32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .expect("read repaired user_version");
        assert_eq!(
            uv, LATEST_USER_VERSION,
            "V13 database should upgrade to the latest schema version"
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_migration_v6_adds_prompt_and_summary() {
        let path =
            std::env::temp_dir().join(format!("test_v6_columns_mig_{}.db", std::process::id()));
        let _ = fs::remove_file(&path);

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        // Check that prompt and summary columns exist via PRAGMA table_info
        let prompt_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'prompt'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);
        assert!(prompt_exists, "Column 'prompt' should exist in tasks table");

        let summary_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'summary'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);
        assert!(
            summary_exists,
            "Column 'summary' should exist in tasks table"
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_migration_v6_backfill() {
        let path =
            std::env::temp_dir().join(format!("test_v6_backfill_mig_{}.db", std::process::id()));
        let _ = fs::remove_file(&path);

        // Create a V5 database (without prompt/summary columns)
        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            // Set user_version to 5 to simulate V5 database
            conn.execute("PRAGMA user_version = 5", [])
                .expect("set user_version");
            // Create minimal V5 schema
            conn.execute(
                "CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL,
                    jira_key TEXT,
                    jira_status TEXT,
                    jira_assignee TEXT,
                    plan_text TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    project_id TEXT,
                    jira_title TEXT,
                    jira_description TEXT
                )",
                [],
            )
            .expect("create tasks table");
            conn.execute(
                "CREATE TABLE pull_requests (
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
                )",
                [],
            )
            .expect("create pull_requests table");
            // Insert a test task (V5 schema — no prompt/summary columns yet)
            conn.execute(
                "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                rusqlite::params!["T-999", "Test Task Title", "backlog", 1000, 1000],
            )
            .expect("insert test task");
        }

        // Now open with Database::new() which will run the V6 migration
        let db = Database::new(path.clone()).expect("Database::new on V5 db");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        // Verify the task's prompt was backfilled from title
        let prompt: String = conn
            .query_row("SELECT prompt FROM tasks WHERE id = 'T-999'", [], |r| {
                r.get(0)
            })
            .expect("Failed to query prompt");
        assert_eq!(
            prompt, "Test Task Title",
            "prompt should be backfilled from title"
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_task_id_prefix_seeded() {
        let path =
            std::env::temp_dir().join(format!("test_task_id_prefix_mig_{}.db", std::process::id()));
        let _ = fs::remove_file(&path);

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let prefix: String = conn
            .query_row(
                "SELECT value FROM config WHERE key = 'task_id_prefix'",
                [],
                |row| row.get(0),
            )
            .expect("task_id_prefix should exist in config");

        assert_eq!(
            prefix.len(),
            3,
            "task_id_prefix should be exactly 3 characters"
        );
        assert!(
            prefix.chars().all(|c| c.is_ascii_uppercase()),
            "task_id_prefix should contain only uppercase letters, got: {}",
            prefix
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_upgrade_removes_jira_schema_and_config() {
        let path = std::env::temp_dir().join(format!(
            "test_upgrade_removes_jira_schema_and_config_{}.db",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        {
            let conn = rusqlite::Connection::open(&path).expect("open raw db");
            conn.execute("PRAGMA user_version = 18", [])
                .expect("set user_version");
            conn.execute(
                "CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    initial_prompt TEXT NOT NULL,
                    status TEXT NOT NULL,
                    jira_key TEXT,
                    jira_title TEXT,
                    jira_status TEXT,
                    jira_assignee TEXT,
                    project_id TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    jira_description TEXT,
                    prompt TEXT,
                    summary TEXT,
                    agent TEXT,
                    permission_mode TEXT
                )",
                [],
            )
            .expect("create tasks table");
            conn.execute(
                "CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
                [],
            )
            .expect("create config table");
            conn.execute(
                "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
                [],
            )
            .expect("create projects table");
            conn.execute(
                "CREATE TABLE project_config (project_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(project_id, key))",
                [],
            )
            .expect("create project_config table");

            conn.execute(
                "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES ('P-1', 'Project', '/tmp/project', 1, 1)",
                [],
            )
            .expect("insert project");
            conn.execute(
                "INSERT INTO config (key, value) VALUES ('jira_api_token', 'token')",
                [],
            )
            .expect("insert jira_api_token");
            conn.execute(
                "INSERT INTO config (key, value) VALUES ('jira_base_url', 'https://example.atlassian.net')",
                [],
            )
            .expect("insert jira_base_url");
            conn.execute(
                "INSERT INTO project_config (project_id, key, value) VALUES ('P-1', 'jira_username', 'dev@example.com')",
                [],
            )
            .expect("insert project jira_username");
            conn.execute(
                "INSERT INTO project_config (project_id, key, value) VALUES ('P-1', 'jira_board_id', '123')",
                [],
            )
            .expect("insert project jira_board_id");
        }

        let db = Database::new(path.clone()).expect("Database::new");
        let conn = db.connection();
        let conn = conn.lock().unwrap();

        let jira_columns: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name IN ('jira_key', 'jira_title', 'jira_status', 'jira_assignee', 'jira_description')",
                [],
                |row| row.get(0),
            )
            .expect("count jira columns");
        assert_eq!(jira_columns, 0, "upgrade must remove jira columns");

        let jira_config_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM config WHERE key LIKE 'jira_%' OR key IN ('custom_jql', 'filter_assigned_to_me', 'exclude_done_tickets')",
                [],
                |row| row.get(0),
            )
            .expect("count jira config");
        assert_eq!(jira_config_count, 0, "upgrade must remove jira config keys");

        let jira_project_config_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_config WHERE key LIKE 'jira_%' OR key IN ('custom_jql', 'filter_assigned_to_me', 'exclude_done_tickets')",
                [],
                |row| row.get(0),
            )
            .expect("count jira project config");
        assert_eq!(
            jira_project_config_count, 0,
            "upgrade must remove jira project config keys"
        );

        drop(conn);
        drop(db);
        let _ = fs::remove_file(&path);
    }
}
