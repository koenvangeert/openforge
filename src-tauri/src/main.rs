// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent_lifecycle;
mod app_events;
mod app_invoke;
mod backend_runtime;
mod builtin_plugins;
mod claude_hooks;
mod cli_installer;
pub mod command_discovery;
mod data_identity;
mod db;
mod diff_parser;
mod git_worktree;
mod github_client;
mod github_poller;
mod github_runtime;
mod http_server;
mod migration;
mod opencode_client;
mod opencode_plugin;
mod pi_extension;
mod plugin_host;
mod plugin_installation;
mod plugin_platform;
mod plugin_rpc;
mod provider_runtime;
pub mod providers;
mod pty_manager;
pub mod review_parser;
mod runtime_checks;
mod secure_store;
mod self_review_runtime;
mod startup_resume;
mod user_environment;
mod whisper_manager;
use log::{info, warn};
use pty_manager::PtyManager;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use whisper_manager::{WhisperManager, WhisperModelSize};

// ============================================================================
// ============================================================================
// Main
// ============================================================================

fn database_filename() -> &'static str {
    data_identity::database_filename()
}

fn current_unix_timestamp_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_secs() as i64
}

fn initialize_database(app_data_dir: &Path) -> db::Database {
    migration::run(app_data_dir);
    let db_path = app_data_dir.join(database_filename());

    info!(
        "Initializing database at: {:?} (mode: {})",
        db_path,
        if cfg!(debug_assertions) {
            "dev"
        } else {
            "prod"
        }
    );

    db::Database::new(db_path).expect("Failed to initialize database")
}

fn migrate_github_token_to_secure_store(database: &db::Database) {
    let db_token = match database.get_config("github_token") {
        Ok(Some(token)) if !token.is_empty() => token,
        Ok(_) => return,
        Err(error) => {
            warn!("[startup] Failed to read persisted GitHub token: {}", error);
            return;
        }
    };

    match secure_store::get_secret("github_token") {
        Ok(Some(existing)) if !existing.is_empty() => {
            if let Err(error) = database.set_config("github_token", "") {
                warn!(
                    "[startup] Failed to clear migrated GitHub token from SQLite: {}",
                    error
                );
            }
            return;
        }
        Ok(_) => {}
        Err(error) => {
            warn!("[startup] Failed to check secure GitHub token: {}", error);
            return;
        }
    }

    match secure_store::set_secret("github_token", &db_token) {
        Ok(()) => {
            if let Err(error) = database.set_config("github_token", "") {
                warn!(
                    "[startup] Failed to clear migrated GitHub token from SQLite: {}",
                    error
                );
            }
        }
        Err(error) => warn!(
            "[startup] Failed to migrate GitHub token to secure storage: {}",
            error
        ),
    }
}

fn run_database_startup_maintenance(database: &db::Database) {
    migrate_github_token_to_secure_store(database);
}

fn sidecar_app_data_dir() -> Result<PathBuf, String> {
    let override_dir = std::env::var_os(data_identity::app_data_dir_env());
    sidecar_app_data_dir_from_override(override_dir)
}

fn sidecar_app_data_dir_from_override(
    override_dir: Option<std::ffi::OsString>,
) -> Result<PathBuf, String> {
    let app_data_dir = match override_dir {
        Some(path) if !path.is_empty() => PathBuf::from(path),
        Some(_) | None => {
            let data_dir = dirs::data_dir()
                .ok_or_else(|| "failed to resolve user data directory".to_string())?;
            data_dir.join(data_identity::app_data_identifier())
        }
    };
    std::fs::create_dir_all(&app_data_dir).map_err(|error| {
        format!(
            "failed to create app data directory {}: {error}",
            app_data_dir.display()
        )
    })?;
    Ok(app_data_dir)
}

fn sidecar_resource_dir() -> Result<PathBuf, String> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from))
        .ok_or_else(|| "failed to resolve backend resource directory".to_string())
}

fn run_electron_sidecar() -> Result<(), Box<dyn std::error::Error>> {
    let app_data_dir = sidecar_app_data_dir().map_err(std::io::Error::other)?;
    let resource_dir = sidecar_resource_dir().map_err(std::io::Error::other)?;
    let database = initialize_database(&app_data_dir);
    let stale_running_session_cutoff = current_unix_timestamp_seconds();
    run_database_startup_maintenance(&database);
    if let Err(e) = cli_installer::install_openforge_cli() {
        warn!("[startup] Failed to install OpenForge CLI: {}", e);
    }

    let whisper_model_pref = database
        .get_config("whisper_model_size")
        .ok()
        .flatten()
        .and_then(|s| WhisperModelSize::from_str(&s))
        .unwrap_or(WhisperModelSize::Small);

    let db_arc = Arc::new(Mutex::new(database));
    let pty_manager = PtyManager::new();
    let whisper_manager = Arc::new(WhisperManager::with_active_model(whisper_model_pref));
    let sidecar_readiness = http_server::SidecarReadinessState::new();
    let (http_ready_tx, http_ready_rx) = tokio::sync::oneshot::channel::<()>();
    let app = http_server::electron_sidecar_app_handle(app_data_dir.clone(), resource_dir.clone());
    app.manage(db_arc.clone());
    app.manage(pty_manager.clone());
    app.manage(github_client::GitHubClient::new());

    println!(
        "[electron-sidecar] using database {}",
        app_data_dir.join(database_filename()).display()
    );

    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(async move {
            tokio::spawn(startup_resume::resume_task_sessions(
                app.clone(),
                http_ready_rx,
                sidecar_readiness.clone(),
                stale_running_session_cutoff,
            ));

            http_server::start_http_sidecar_server(
                app,
                db_arc,
                pty_manager,
                whisper_manager,
                sidecar_readiness,
                http_ready_tx,
            )
            .await
        })
}

fn main() {
    if let Err(error) = run_electron_sidecar() {
        eprintln!("[electron-sidecar] failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::sidecar_app_data_dir_from_override;

    #[test]
    fn sidecar_app_data_dir_uses_override_and_creates_dir() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let isolated_dir = temp_dir.path().join("isolated-openforge-data");

        let resolved =
            sidecar_app_data_dir_from_override(Some(isolated_dir.clone().into_os_string()))
                .expect("sidecar app data dir");

        assert_eq!(resolved, isolated_dir);
        assert!(resolved.is_dir());
    }
}
