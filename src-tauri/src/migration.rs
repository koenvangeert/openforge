use log::{error, info, warn};
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

pub fn run(new_app_data_dir: &Path) {
    run_with_dirs(dirs::home_dir(), dirs::data_dir(), new_app_data_dir);
}

fn run_with_dirs(home_dir: Option<PathBuf>, data_dir: Option<PathBuf>, new_app_data_dir: &Path) {
    if let Some(ref home) = home_dir {
        rename_if_needed(
            &home.join(crate::data_identity::legacy_home_dir_name()),
            &home.join(crate::data_identity::current_home_dir_name()),
            "home config",
        );
    }

    if let Some(ref data) = data_dir {
        rename_if_needed(
            &data.join(crate::data_identity::legacy_data_dir_name()),
            &data.join(crate::data_identity::current_data_dir_name()),
            "whisper models",
        );
    }

    if let Some(ref data) = data_dir {
        migrate_database(
            &data.join(crate::data_identity::legacy_app_identifier()),
            new_app_data_dir,
        );
    }

    rewrite_db_paths(new_app_data_dir, home_dir.as_deref());
}

fn rename_if_needed(old: &Path, new: &Path, label: &str) {
    if !old.exists() {
        return;
    }
    if new.exists() {
        warn!(
            "[migration] Skipping {}: both old ({:?}) and new ({:?}) exist",
            label, old, new
        );
        return;
    }
    match fs::rename(old, new) {
        Ok(()) => info!("[migration] Migrated {}: {:?} → {:?}", label, old, new),
        Err(e) => error!(
            "[migration] Failed to migrate {}: {:?} → {:?}: {}",
            label, old, new, e
        ),
    }
}

fn migrate_database(old_app_data: &Path, new_app_data: &Path) {
    if !old_app_data.exists() {
        return;
    }

    if let Err(e) = fs::create_dir_all(new_app_data) {
        error!("[migration] Failed to create new app data dir: {}", e);
        return;
    }

    rename_if_needed(
        &old_app_data.join(crate::data_identity::legacy_database_filename_for_build(
            false,
        )),
        &new_app_data.join(crate::data_identity::database_filename_for_build(false)),
        "production database",
    );
    rename_if_needed(
        &old_app_data.join(crate::data_identity::legacy_database_filename_for_build(
            true,
        )),
        &new_app_data.join(crate::data_identity::database_filename_for_build(true)),
        "development database",
    );

    let is_empty = fs::read_dir(old_app_data)
        .map(|mut entries| entries.next().is_none())
        .unwrap_or(false);
    if is_empty {
        let _ = fs::remove_dir(old_app_data);
    }
}

fn rewrite_db_paths(app_data_dir: &Path, home_dir: Option<&Path>) {
    let home = match home_dir {
        Some(h) => h,
        None => return,
    };

    let old_prefix = home
        .join(crate::data_identity::legacy_home_dir_name())
        .to_string_lossy()
        .to_string();
    let new_prefix = home
        .join(crate::data_identity::current_home_dir_name())
        .to_string_lossy()
        .to_string();

    let db_candidates = [
        crate::data_identity::database_filename_for_build(false),
        crate::data_identity::database_filename_for_build(true),
    ];
    for db_name in &db_candidates {
        let db_path = app_data_dir.join(db_name);
        if !db_path.exists() {
            continue;
        }

        let conn = match Connection::open(&db_path) {
            Ok(c) => c,
            Err(e) => {
                error!(
                    "[migration] Failed to open {:?} for path rewrite: {}",
                    db_path, e
                );
                continue;
            }
        };

        let like_pattern = format!("{}%", old_prefix);

        let has_worktrees = conn
            .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='worktrees'")
            .and_then(|mut s| s.exists([]))
            .unwrap_or(false);

        if has_worktrees {
            match conn.execute(
                "UPDATE worktrees SET worktree_path = REPLACE(worktree_path, ?1, ?2) WHERE worktree_path LIKE ?3",
                rusqlite::params![old_prefix, new_prefix, like_pattern],
            ) {
                Ok(n) if n > 0 => info!("[migration] Rewrote {} worktree path(s) in {:?}", n, db_name),
                Ok(_) => {}
                Err(e) => error!("[migration] Failed to rewrite worktree paths in {:?}: {}", db_name, e),
            }
        }

        let has_task_workspaces = conn
            .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_workspaces'")
            .and_then(|mut s| s.exists([]))
            .unwrap_or(false);

        if has_task_workspaces {
            match conn.execute(
                "UPDATE task_workspaces SET workspace_path = REPLACE(workspace_path, ?1, ?2) WHERE workspace_path LIKE ?3",
                rusqlite::params![old_prefix, new_prefix, like_pattern],
            ) {
                Ok(n) if n > 0 => info!("[migration] Rewrote {} task workspace path(s) in {:?}", n, db_name),
                Ok(_) => {}
                Err(e) => error!("[migration] Failed to rewrite task workspace paths in {:?}: {}", db_name, e),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn setup_temp_dirs(test_name: &str) -> (PathBuf, PathBuf, PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("openforge_migration_test_{}", test_name));
        let _ = fs::remove_dir_all(&base);
        let home = base.join("home");
        let data = base.join("data");
        let new_app = base.join("new_app");
        fs::create_dir_all(&home).unwrap();
        fs::create_dir_all(&data).unwrap();
        (base, home, data, new_app)
    }

    fn cleanup(base: &Path) {
        let _ = fs::remove_dir_all(base);
    }

    fn old_home_dir_name() -> &'static str {
        crate::data_identity::legacy_home_dir_name()
    }

    fn new_home_dir_name() -> &'static str {
        crate::data_identity::current_home_dir_name()
    }

    fn old_data_dir_name() -> &'static str {
        crate::data_identity::legacy_data_dir_name()
    }

    fn new_data_dir_name() -> &'static str {
        crate::data_identity::current_data_dir_name()
    }

    fn old_app_identifier() -> &'static str {
        crate::data_identity::legacy_app_identifier()
    }

    fn old_db_prod() -> &'static str {
        crate::data_identity::legacy_database_filename_for_build(false)
    }

    fn old_db_dev() -> &'static str {
        crate::data_identity::legacy_database_filename_for_build(true)
    }

    fn new_db_prod() -> &'static str {
        crate::data_identity::database_filename_for_build(false)
    }

    fn new_db_dev() -> &'static str {
        crate::data_identity::database_filename_for_build(true)
    }

    #[test]
    fn migrates_home_config_dir() {
        let (base, home, data, new_app) = setup_temp_dirs("home_config");
        let old_dir = home.join(old_home_dir_name());
        fs::create_dir_all(old_dir.join("pids")).unwrap();
        fs::write(old_dir.join("settings.json"), "{}").unwrap();

        run_with_dirs(Some(home.clone()), Some(data), &new_app);

        let new_dir = home.join(new_home_dir_name());
        assert!(!old_dir.exists());
        assert!(new_dir.join("pids").is_dir());
        assert!(new_dir.join("settings.json").is_file());
        cleanup(&base);
    }

    #[test]
    fn skips_home_config_when_new_dir_already_exists() {
        let (base, home, data, new_app) = setup_temp_dirs("skip_home");
        let old_dir = home.join(old_home_dir_name());
        let new_dir = home.join(new_home_dir_name());
        fs::create_dir_all(&old_dir).unwrap();
        fs::write(old_dir.join("old.txt"), "old").unwrap();
        fs::create_dir_all(&new_dir).unwrap();
        fs::write(new_dir.join("new.txt"), "new").unwrap();

        run_with_dirs(Some(home), Some(data), &new_app);

        assert!(old_dir.join("old.txt").is_file());
        assert!(new_dir.join("new.txt").is_file());
        assert!(!new_dir.join("old.txt").exists());
        cleanup(&base);
    }

    #[test]
    fn noop_when_nothing_to_migrate() {
        let (base, home, data, new_app) = setup_temp_dirs("noop");

        run_with_dirs(Some(home.clone()), Some(data.clone()), &new_app);

        assert!(!home.join(new_home_dir_name()).exists());
        assert!(!data.join(new_data_dir_name()).exists());
        assert!(!new_app.exists());
        cleanup(&base);
    }

    #[test]
    fn migrates_whisper_models_dir() {
        let (base, home, data, new_app) = setup_temp_dirs("whisper");
        let old_dir = data.join(old_data_dir_name());
        fs::create_dir_all(old_dir.join("models")).unwrap();
        fs::write(old_dir.join("models/ggml-small.bin"), "model").unwrap();

        run_with_dirs(Some(home), Some(data.clone()), &new_app);

        let new_dir = data.join(new_data_dir_name());
        assert!(!old_dir.exists());
        assert!(new_dir.join("models/ggml-small.bin").is_file());
        cleanup(&base);
    }

    #[test]
    fn migrates_database_files() {
        let (base, home, data, new_app) = setup_temp_dirs("db_files");
        let old_app = data.join(old_app_identifier());
        fs::create_dir_all(&old_app).unwrap();
        fs::write(old_app.join(old_db_prod()), "prod-data").unwrap();
        fs::write(old_app.join(old_db_dev()), "dev-data").unwrap();

        run_with_dirs(Some(home), Some(data), &new_app);

        assert!(new_app.join(new_db_prod()).is_file());
        assert!(new_app.join(new_db_dev()).is_file());
        assert_eq!(
            fs::read_to_string(new_app.join(new_db_prod())).unwrap(),
            "prod-data"
        );
        assert_eq!(
            fs::read_to_string(new_app.join(new_db_dev())).unwrap(),
            "dev-data"
        );
        cleanup(&base);
    }

    #[test]
    fn removes_old_app_data_dir_when_empty_after_migration() {
        let (base, home, data, new_app) = setup_temp_dirs("empty_cleanup");
        let old_app = data.join(old_app_identifier());
        fs::create_dir_all(&old_app).unwrap();
        fs::write(old_app.join(old_db_prod()), "data").unwrap();

        run_with_dirs(Some(home), Some(data), &new_app);

        assert!(!old_app.exists());
        cleanup(&base);
    }

    #[test]
    fn keeps_old_app_data_dir_when_extra_files_remain() {
        let (base, home, data, new_app) = setup_temp_dirs("extra_files");
        let old_app = data.join(old_app_identifier());
        fs::create_dir_all(&old_app).unwrap();
        fs::write(old_app.join(old_db_prod()), "data").unwrap();
        fs::write(old_app.join("unknown.log"), "other stuff").unwrap();

        run_with_dirs(Some(home), Some(data), &new_app);

        assert!(old_app.exists());
        assert!(old_app.join("unknown.log").is_file());
        assert!(!old_app.join(old_db_prod()).exists());
        cleanup(&base);
    }

    #[test]
    fn skips_db_when_target_already_exists() {
        let (base, home, data, new_app) = setup_temp_dirs("skip_db");
        let old_app = data.join(old_app_identifier());
        fs::create_dir_all(&old_app).unwrap();
        fs::write(old_app.join(old_db_prod()), "old-data").unwrap();
        fs::create_dir_all(&new_app).unwrap();
        fs::write(new_app.join(new_db_prod()), "new-data").unwrap();

        run_with_dirs(Some(home), Some(data), &new_app);

        assert_eq!(
            fs::read_to_string(new_app.join(new_db_prod())).unwrap(),
            "new-data"
        );
        assert!(old_app.join(old_db_prod()).is_file());
        cleanup(&base);
    }

    #[test]
    fn rewrites_openforge_managed_workspace_paths_in_db() {
        let (base, home, _data, new_app) = setup_temp_dirs("rewrite_paths");
        fs::create_dir_all(&new_app).unwrap();

        let db_path = new_app.join(new_db_dev());
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE worktrees (
                id INTEGER PRIMARY KEY,
                task_id TEXT, project_id TEXT, repo_path TEXT,
                worktree_path TEXT NOT NULL,
                branch_name TEXT,
                status TEXT, created_at INTEGER, updated_at INTEGER
            );
            CREATE TABLE task_workspaces (
                id INTEGER PRIMARY KEY,
                task_id TEXT NOT NULL UNIQUE,
                project_id TEXT NOT NULL,
                workspace_path TEXT NOT NULL,
                repo_path TEXT NOT NULL,
                kind TEXT NOT NULL,
                branch_name TEXT,
                provider_name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
        )
        .unwrap();

        let old_base = home.join(old_home_dir_name());
        conn.execute(
            "INSERT INTO worktrees (task_id, worktree_path, status) VALUES (?1, ?2, 'active')",
            rusqlite::params![
                "T-1",
                format!("{}/worktrees/repo/review-pr-42", old_base.display())
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO worktrees (task_id, worktree_path, status) VALUES (?1, ?2, 'active')",
            rusqlite::params!["T-2", "/unrelated/path/somewhere"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO task_workspaces (task_id, project_id, workspace_path, repo_path, kind, provider_name, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'git_worktree', 'opencode', 'active', 1, 1)",
            rusqlite::params![
                "T-1",
                "P-1",
                format!("{}/worktrees/repo/review-pr-42", old_base.display()),
                "/source/repo"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO task_workspaces (task_id, project_id, workspace_path, repo_path, kind, provider_name, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'local', 'opencode', 'active', 1, 1)",
            rusqlite::params!["T-2", "P-2", "/unrelated/path/somewhere", "/unrelated/repo"],
        )
        .unwrap();
        drop(conn);

        rewrite_db_paths(&new_app, Some(&home));

        let conn = Connection::open(&db_path).unwrap();
        let new_base = home.join(new_home_dir_name());

        let path1: String = conn
            .query_row(
                "SELECT worktree_path FROM worktrees WHERE task_id = 'T-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            path1,
            format!("{}/worktrees/repo/review-pr-42", new_base.display())
        );

        let path2: String = conn
            .query_row(
                "SELECT worktree_path FROM worktrees WHERE task_id = 'T-2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(path2, "/unrelated/path/somewhere");

        let (task_id, project_id, workspace_path, repo_path): (String, String, String, String) = conn
            .query_row(
                "SELECT task_id, project_id, workspace_path, repo_path FROM task_workspaces WHERE task_id = 'T-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(task_id, "T-1");
        assert_eq!(project_id, "P-1");
        assert_eq!(
            workspace_path,
            format!("{}/worktrees/repo/review-pr-42", new_base.display())
        );
        assert_eq!(repo_path, "/source/repo");

        let unrelated_workspace_path: String = conn
            .query_row(
                "SELECT workspace_path FROM task_workspaces WHERE task_id = 'T-2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(unrelated_workspace_path, "/unrelated/path/somewhere");

        cleanup(&base);
    }

    #[test]
    fn rewrite_noop_when_no_old_paths() {
        let (base, home, _data, new_app) = setup_temp_dirs("rewrite_noop");
        fs::create_dir_all(&new_app).unwrap();

        let db_path = new_app.join(new_db_dev());
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE worktrees (
                id INTEGER PRIMARY KEY,
                task_id TEXT, worktree_path TEXT NOT NULL, status TEXT
            )",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO worktrees (task_id, worktree_path, status) VALUES ('T-1', '/some/other/path', 'active')",
            [],
        ).unwrap();
        drop(conn);

        rewrite_db_paths(&new_app, Some(&home));

        let conn = Connection::open(&db_path).unwrap();
        let path: String = conn
            .query_row(
                "SELECT worktree_path FROM worktrees WHERE task_id = 'T-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(path, "/some/other/path");

        cleanup(&base);
    }
}
