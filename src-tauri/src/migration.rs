use log::{error, info, warn};
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

const OLD_HOME_DIR_NAME: &str = ".ai-command-center";
const NEW_HOME_DIR_NAME: &str = ".openforge";

const OLD_DATA_DIR_NAME: &str = "ai-command-center";
const NEW_DATA_DIR_NAME: &str = "openforge";

const OLD_APP_IDENTIFIER: &str = "com.opencode.ai-command-center";

const OLD_DB_PROD: &str = "ai_command_center.db";
const OLD_DB_DEV: &str = "ai_command_center_dev.db";
const NEW_DB_PROD: &str = "openforge.db";
const NEW_DB_DEV: &str = "openforge_dev.db";

pub fn run(new_app_data_dir: &Path) {
    run_with_dirs(dirs::home_dir(), dirs::data_dir(), new_app_data_dir);
}

fn run_with_dirs(home_dir: Option<PathBuf>, data_dir: Option<PathBuf>, new_app_data_dir: &Path) {
    if let Some(ref home) = home_dir {
        rename_if_needed(
            &home.join(OLD_HOME_DIR_NAME),
            &home.join(NEW_HOME_DIR_NAME),
            "home config",
        );
    }

    if let Some(ref data) = data_dir {
        rename_if_needed(
            &data.join(OLD_DATA_DIR_NAME),
            &data.join(NEW_DATA_DIR_NAME),
            "whisper models",
        );
    }

    if let Some(ref data) = data_dir {
        migrate_database(&data.join(OLD_APP_IDENTIFIER), new_app_data_dir);
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
        &old_app_data.join(OLD_DB_PROD),
        &new_app_data.join(NEW_DB_PROD),
        "production database",
    );
    rename_if_needed(
        &old_app_data.join(OLD_DB_DEV),
        &new_app_data.join(NEW_DB_DEV),
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

    let old_prefix = home.join(OLD_HOME_DIR_NAME).to_string_lossy().to_string();
    let new_prefix = home.join(NEW_HOME_DIR_NAME).to_string_lossy().to_string();

    let db_candidates = [NEW_DB_PROD, NEW_DB_DEV];
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

        let has_worktrees = conn
            .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='worktrees'")
            .and_then(|mut s| s.exists([]))
            .unwrap_or(false);

        if !has_worktrees {
            continue;
        }

        match conn.execute(
            "UPDATE worktrees SET worktree_path = REPLACE(worktree_path, ?1, ?2) WHERE worktree_path LIKE ?3",
            rusqlite::params![old_prefix, new_prefix, format!("{}%", old_prefix)],
        ) {
            Ok(n) if n > 0 => info!("[migration] Rewrote {} worktree path(s) in {:?}", n, db_name),
            Ok(_) => {}
            Err(e) => error!("[migration] Failed to rewrite worktree paths in {:?}: {}", db_name, e),
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

    #[test]
    fn migrates_home_config_dir() {
        let (base, home, data, new_app) = setup_temp_dirs("home_config");
        let old_dir = home.join(OLD_HOME_DIR_NAME);
        fs::create_dir_all(old_dir.join("pids")).unwrap();
        fs::write(old_dir.join("settings.json"), "{}").unwrap();

        run_with_dirs(Some(home.clone()), Some(data), &new_app);

        let new_dir = home.join(NEW_HOME_DIR_NAME);
        assert!(!old_dir.exists());
        assert!(new_dir.join("pids").is_dir());
        assert!(new_dir.join("settings.json").is_file());
        cleanup(&base);
    }

    #[test]
    fn skips_home_config_when_new_dir_already_exists() {
        let (base, home, data, new_app) = setup_temp_dirs("skip_home");
        let old_dir = home.join(OLD_HOME_DIR_NAME);
        let new_dir = home.join(NEW_HOME_DIR_NAME);
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

        assert!(!home.join(NEW_HOME_DIR_NAME).exists());
        assert!(!data.join(NEW_DATA_DIR_NAME).exists());
        assert!(!new_app.exists());
        cleanup(&base);
    }

    #[test]
    fn migrates_whisper_models_dir() {
        let (base, home, data, new_app) = setup_temp_dirs("whisper");
        let old_dir = data.join(OLD_DATA_DIR_NAME);
        fs::create_dir_all(old_dir.join("models")).unwrap();
        fs::write(old_dir.join("models/ggml-small.bin"), "model").unwrap();

        run_with_dirs(Some(home), Some(data.clone()), &new_app);

        let new_dir = data.join(NEW_DATA_DIR_NAME);
        assert!(!old_dir.exists());
        assert!(new_dir.join("models/ggml-small.bin").is_file());
        cleanup(&base);
    }

    #[test]
    fn migrates_database_files() {
        let (base, home, data, new_app) = setup_temp_dirs("db_files");
        let old_app = data.join(OLD_APP_IDENTIFIER);
        fs::create_dir_all(&old_app).unwrap();
        fs::write(old_app.join(OLD_DB_PROD), "prod-data").unwrap();
        fs::write(old_app.join(OLD_DB_DEV), "dev-data").unwrap();

        run_with_dirs(Some(home), Some(data), &new_app);

        assert!(new_app.join(NEW_DB_PROD).is_file());
        assert!(new_app.join(NEW_DB_DEV).is_file());
        assert_eq!(
            fs::read_to_string(new_app.join(NEW_DB_PROD)).unwrap(),
            "prod-data"
        );
        assert_eq!(
            fs::read_to_string(new_app.join(NEW_DB_DEV)).unwrap(),
            "dev-data"
        );
        cleanup(&base);
    }

    #[test]
    fn removes_old_app_data_dir_when_empty_after_migration() {
        let (base, home, data, new_app) = setup_temp_dirs("empty_cleanup");
        let old_app = data.join(OLD_APP_IDENTIFIER);
        fs::create_dir_all(&old_app).unwrap();
        fs::write(old_app.join(OLD_DB_PROD), "data").unwrap();

        run_with_dirs(Some(home), Some(data), &new_app);

        assert!(!old_app.exists());
        cleanup(&base);
    }

    #[test]
    fn keeps_old_app_data_dir_when_extra_files_remain() {
        let (base, home, data, new_app) = setup_temp_dirs("extra_files");
        let old_app = data.join(OLD_APP_IDENTIFIER);
        fs::create_dir_all(&old_app).unwrap();
        fs::write(old_app.join(OLD_DB_PROD), "data").unwrap();
        fs::write(old_app.join("unknown.log"), "other stuff").unwrap();

        run_with_dirs(Some(home), Some(data), &new_app);

        assert!(old_app.exists());
        assert!(old_app.join("unknown.log").is_file());
        assert!(!old_app.join(OLD_DB_PROD).exists());
        cleanup(&base);
    }

    #[test]
    fn skips_db_when_target_already_exists() {
        let (base, home, data, new_app) = setup_temp_dirs("skip_db");
        let old_app = data.join(OLD_APP_IDENTIFIER);
        fs::create_dir_all(&old_app).unwrap();
        fs::write(old_app.join(OLD_DB_PROD), "old-data").unwrap();
        fs::create_dir_all(&new_app).unwrap();
        fs::write(new_app.join(NEW_DB_PROD), "new-data").unwrap();

        run_with_dirs(Some(home), Some(data), &new_app);

        assert_eq!(
            fs::read_to_string(new_app.join(NEW_DB_PROD)).unwrap(),
            "new-data"
        );
        assert!(old_app.join(OLD_DB_PROD).is_file());
        cleanup(&base);
    }

    #[test]
    fn rewrites_worktree_paths_in_db() {
        let (base, home, _data, new_app) = setup_temp_dirs("rewrite_paths");
        fs::create_dir_all(&new_app).unwrap();

        let db_path = new_app.join(NEW_DB_DEV);
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE worktrees (
                id INTEGER PRIMARY KEY,
                task_id TEXT, project_id TEXT, repo_path TEXT,
                worktree_path TEXT NOT NULL,
                branch_name TEXT, opencode_port INTEGER, opencode_pid INTEGER,
                status TEXT, created_at INTEGER, updated_at INTEGER
            )",
        )
        .unwrap();

        let old_base = home.join(OLD_HOME_DIR_NAME);
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
        drop(conn);

        rewrite_db_paths(&new_app, Some(&home));

        let conn = Connection::open(&db_path).unwrap();
        let new_base = home.join(NEW_HOME_DIR_NAME);

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

        cleanup(&base);
    }

    #[test]
    fn rewrite_noop_when_no_old_paths() {
        let (base, home, _data, new_app) = setup_temp_dirs("rewrite_noop");
        fs::create_dir_all(&new_app).unwrap();

        let db_path = new_app.join(NEW_DB_DEV);
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
