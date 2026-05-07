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
mod server_manager;
mod sse_bridge;
mod user_environment;
mod whisper_manager;
use log::{debug, error, info, warn};
use opencode_client::OpenCodeClient;
use pty_manager::PtyManager;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use whisper_manager::{WhisperManager, WhisperModelSize};

// ============================================================================
// Startup: Resume OpenCode Servers
// ============================================================================

#[derive(Debug, Clone)]
pub(crate) struct ResumeTarget {
    pub(crate) task_id: String,
    pub(crate) project_id: String,
    pub(crate) repo_path: String,
    pub(crate) workspace_path: String,
    pub(crate) kind: String,
    pub(crate) branch_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ResumeSessionPersistence {
    LeaveExisting,
    Running,
    Completed,
}

fn opencode_resume_persistence(
    opencode_session_id: Option<&str>,
    statuses: &HashMap<String, opencode_client::SessionStatusInfo>,
) -> ResumeSessionPersistence {
    let Some(session_id) = opencode_session_id else {
        return ResumeSessionPersistence::LeaveExisting;
    };

    match statuses
        .get(session_id)
        .map(|status| status.status_type.as_str())
    {
        Some("busy") | Some("retry") => ResumeSessionPersistence::Running,
        Some("idle") => ResumeSessionPersistence::Completed,
        _ => ResumeSessionPersistence::LeaveExisting,
    }
}

pub(crate) async fn resolve_resume_session_persistence(
    provider_name: &str,
    latest_session: Option<&db::AgentSessionRow>,
    port: u16,
) -> ResumeSessionPersistence {
    if provider_name != "opencode" {
        return ResumeSessionPersistence::Running;
    }

    let Some(session) = latest_session else {
        return ResumeSessionPersistence::LeaveExisting;
    };

    let Some(opencode_session_id) = session.opencode_session_id.as_deref() else {
        return ResumeSessionPersistence::LeaveExisting;
    };

    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));

    for attempt in 1..=3 {
        match client.get_all_session_statuses().await {
            Ok(statuses) => {
                return opencode_resume_persistence(Some(opencode_session_id), &statuses);
            }
            Err(e) => {
                warn!(
                    "[startup] Failed to fetch OpenCode session status for {} on attempt {}: {}",
                    session.ticket_id, attempt, e
                );
                tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
            }
        }
    }

    ResumeSessionPersistence::LeaveExisting
}

pub(crate) fn load_resume_targets(db: &db::Database) -> rusqlite::Result<Vec<ResumeTarget>> {
    let mut targets: Vec<ResumeTarget> = db
        .get_resumable_task_workspaces()?
        .into_iter()
        .map(|workspace| ResumeTarget {
            task_id: workspace.task_id,
            project_id: workspace.project_id,
            repo_path: workspace.repo_path,
            workspace_path: workspace.workspace_path,
            kind: workspace.kind,
            branch_name: workspace.branch_name,
        })
        .collect();

    let existing_task_ids: HashSet<String> = targets
        .iter()
        .map(|target| target.task_id.clone())
        .collect();

    for worktree in db.get_resumable_worktrees()? {
        if existing_task_ids.contains(&worktree.task_id) {
            continue;
        }

        targets.push(ResumeTarget {
            task_id: worktree.task_id,
            project_id: worktree.project_id,
            repo_path: worktree.repo_path,
            workspace_path: worktree.worktree_path,
            kind: "git_worktree".to_string(),
            branch_name: Some(worktree.branch_name),
        });
    }

    Ok(targets)
}

async fn resume_task_servers(
    app: crate::backend_runtime::AppHandle,
    http_ready: tokio::sync::oneshot::Receiver<()>,
) {
    // Wait for the HTTP server to be listening so Claude Code hooks don't get connection-refused
    match http_ready.await {
        Ok(()) => debug!("[startup] HTTP server ready, proceeding with session resume"),
        Err(_) => {
            warn!("[startup] HTTP server ready channel dropped — resuming anyway (hooks may fail)");
        }
    }

    let resume_targets = {
        let db = app.state::<Arc<Mutex<db::Database>>>();
        let db_lock = db.lock().unwrap();
        match load_resume_targets(&db_lock) {
            Ok(targets) => targets,
            Err(e) => {
                error!("[startup] Failed to get resumable task workspaces: {}", e);
                let _ = app.emit("startup-resume-complete", ());
                return;
            }
        }
    };

    if resume_targets.is_empty() {
        let _ = app.emit("startup-resume-complete", ());
        return;
    }

    info!(
        "[startup] Resuming servers for {} task(s)",
        resume_targets.len()
    );

    for target in resume_targets {
        let workspace_path = std::path::Path::new(&target.workspace_path);
        if !workspace_path.exists() {
            warn!(
                "[startup] Workspace path missing for task {}, skipping: {}",
                target.task_id, target.workspace_path
            );
            continue;
        }

        // Look up the latest session to determine which provider to use
        let latest_session = {
            let db = app.state::<Arc<Mutex<db::Database>>>();
            let db_lock = db.lock().unwrap();
            db_lock
                .get_latest_session_for_ticket(&target.task_id)
                .ok()
                .flatten()
        };
        let provider_name = latest_session
            .as_ref()
            .map(|s| s.provider.as_str())
            .unwrap_or("claude-code");

        // Build a dummy session for the case where no session exists in the DB.
        // ClaudeCodeProvider uses claude_session_id=None → spawns with --continue.
        let dummy_session;
        let session_ref: &db::AgentSessionRow = match &latest_session {
            Some(s) => s,
            None => {
                dummy_session = db::AgentSessionRow {
                    id: String::new(),
                    ticket_id: target.task_id.clone(),
                    opencode_session_id: None,
                    stage: "implementing".to_string(),
                    status: "running".to_string(),
                    checkpoint_data: None,
                    error_message: None,
                    created_at: 0,
                    updated_at: 0,
                    provider: provider_name.to_string(),
                    claude_session_id: None,
                    pi_session_id: None,
                };
                &dummy_session
            }
        };

        let provider = match providers::Provider::from_name(
            provider_name,
            app.state::<PtyManager>().inner().clone(),
            app.state::<server_manager::ServerManager>().inner().clone(),
            app.state::<sse_bridge::SseBridgeManager>().inner().clone(),
        ) {
            Ok(p) => p,
            Err(e) => {
                warn!(
                    "[startup] Unknown provider for task {}: {}",
                    target.task_id, e
                );
                continue;
            }
        };

        match provider
            .resume(
                &target.task_id,
                session_ref,
                workspace_path,
                None,
                None,
                None,
                None,
                &app,
            )
            .await
        {
            Ok(result) => {
                {
                    let resume_persistence = resolve_resume_session_persistence(
                        provider_name,
                        latest_session.as_ref(),
                        result.port,
                    )
                    .await;

                    let db = app.state::<Arc<Mutex<db::Database>>>();
                    let db_lock = db.lock().unwrap();

                    if provider_name == "pi" {
                        if let (Some(session), Some(pi_session_id)) =
                            (latest_session.as_ref(), result.pi_session_id.as_deref())
                        {
                            if session.pi_session_id.as_deref() != Some(pi_session_id) {
                                if let Err(e) =
                                    db_lock.set_agent_session_pi_id(&session.id, pi_session_id)
                                {
                                    warn!(
                                        "[startup] Failed to persist resumed Pi session id for {}: {}",
                                        target.task_id, e
                                    );
                                }
                            }
                        }
                    }

                    restore_resumed_session_state(
                        &db_lock,
                        latest_session.as_ref(),
                        &target,
                        provider_name,
                        result.port,
                        result.pty_instance_id,
                        resume_persistence,
                    );
                }

                let _ = app.emit(
                    "server-resumed",
                    serde_json::json!({
                        "task_id": target.task_id,
                        "port": result.port,
                        "workspace_path": target.workspace_path,
                    }),
                );

                info!(
                    "[startup] Resumed {} for task {} (port {})",
                    provider_name, target.task_id, result.port
                );
            }
            Err(e) => {
                error!(
                    "[startup] Failed to resume {} for task {}: {}",
                    provider_name, target.task_id, e
                );

                // Mark provider sessions as interrupted on failure for providers that do not
                // have an external status source to reconcile against after startup.
                if matches!(provider_name, "claude-code" | "pi") {
                    if let Some(ref session) = latest_session {
                        let db = app.state::<Arc<Mutex<db::Database>>>();
                        let db_lock = db.lock().unwrap();
                        let _ = db_lock.update_agent_session(
                            &session.id,
                            &session.stage,
                            "interrupted",
                            None,
                            Some("App restarted"),
                        );
                    }
                }

                let _ = app.emit(
                    "server-resumed",
                    serde_json::json!({
                        "task_id": target.task_id,
                        "port": 0,
                        "workspace_path": target.workspace_path,
                    }),
                );
            }
        }
    }

    let _ = app.emit("startup-resume-complete", ());
    info!("[startup] Resume complete, emitted startup-resume-complete event");
}

fn should_start_project_root_server(
    provider: &str,
    project_path: Option<&str>,
    existing_port: Option<u16>,
) -> bool {
    provider == "opencode" && project_path.is_some() && existing_port.is_none()
}

async fn start_project_root_server(
    app: &crate::backend_runtime::AppHandle,
    project_id: &str,
) -> Result<(), String> {
    let (provider, project_path) = {
        let db = app.state::<Arc<Mutex<db::Database>>>();
        let db_lock = db
            .lock()
            .map_err(|e| format!("database lock error: {}", e))?;
        let provider = db_lock.resolve_ai_provider(project_id);
        let project_path = db_lock
            .get_project(project_id)
            .map_err(|e| format!("Failed to load project {}: {}", project_id, e))?
            .map(|project| project.path);

        (provider, project_path)
    };

    let discovery_task_id = server_manager::discovery_server_task_id(project_id);
    let server_mgr = app.state::<server_manager::ServerManager>();
    let existing_port = server_mgr.get_server_port(&discovery_task_id).await;

    if !should_start_project_root_server(&provider, project_path.as_deref(), existing_port) {
        return Ok(());
    }

    let project_path = project_path.ok_or_else(|| format!("Project {} has no path", project_id))?;

    server_mgr
        .spawn_server(&discovery_task_id, std::path::Path::new(&project_path))
        .await
        .map(|_| ())
        .map_err(|e| format!("Failed to start root OpenCode server: {}", e))
}

fn resolve_startup_project_id(db: &db::Database) -> Result<Option<String>, String> {
    if let Some(project_id) = db
        .get_config("active_project_id")
        .map_err(|e| format!("Failed to read active project config: {}", e))?
        .filter(|id| !id.is_empty())
    {
        return Ok(Some(project_id));
    }

    let projects = db
        .get_all_projects()
        .map_err(|e| format!("Failed to load projects: {}", e))?;

    Ok(projects.first().map(|project| project.id.clone()))
}

pub(crate) fn restore_resumed_session_state(
    db: &db::Database,
    latest_session: Option<&db::AgentSessionRow>,
    target: &ResumeTarget,
    provider_name: &str,
    port: u16,
    pty_instance_id: Option<u64>,
    resume_persistence: ResumeSessionPersistence,
) {
    if let Err(e) = db.upsert_task_workspace_record(
        &target.task_id,
        &target.project_id,
        &target.workspace_path,
        &target.repo_path,
        &target.kind,
        target.branch_name.as_deref(),
        provider_name,
        if provider_name == "claude-code" {
            None
        } else {
            Some(port as i64)
        },
        "active",
    ) {
        warn!(
            "[startup] Failed to update task workspace for {}: {}",
            target.task_id, e
        );
    }

    if provider_name != "claude-code" && target.kind == "git_worktree" {
        if let Err(e) = db.update_worktree_server(&target.task_id, port as i64, 0) {
            warn!(
                "[startup] Failed to update worktree server for {}: {}",
                target.task_id, e
            );
        }
    }

    if let Some(session) = latest_session {
        let pty_checkpoint_data = pty_instance_id.map(|id| {
            serde_json::json!({
                "pty_instance_id": id,
            })
            .to_string()
        });

        let persisted_status = if provider_name == "opencode" {
            match resume_persistence {
                ResumeSessionPersistence::LeaveExisting => None,
                ResumeSessionPersistence::Running => Some("running"),
                ResumeSessionPersistence::Completed => Some("completed"),
            }
        } else if matches!(session.status.as_str(), "interrupted" | "running") {
            Some("running")
        } else if provider_name == "pi"
            && pty_checkpoint_data.is_some()
            && matches!(session.status.as_str(), "completed" | "paused")
        {
            Some(session.status.as_str())
        } else {
            None
        };

        if let Some(status) = persisted_status {
            let checkpoint_data = if status == "running" || provider_name == "pi" {
                pty_checkpoint_data
                    .as_deref()
                    .or(session.checkpoint_data.as_deref())
            } else {
                None
            };

            if let Err(e) =
                db.update_agent_session(&session.id, &session.stage, status, checkpoint_data, None)
            {
                warn!(
                    "[startup] Failed to restore session {} for task {}: {}",
                    session.id, target.task_id, e
                );
            }
        }
    }
}
// ============================================================================
// Main
// ============================================================================

fn database_filename() -> &'static str {
    data_identity::database_filename()
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

    match database.mark_running_sessions_interrupted() {
        Ok(count) if count > 0 => {
            info!(
                "[startup] Marked {} stale running sessions as interrupted",
                count
            );
        }
        Ok(_) => {}
        Err(e) => {
            warn!("[startup] Failed to mark stale sessions: {}", e);
        }
    }

    match database.clear_stale_worktree_servers() {
        Ok(count) if count > 0 => {
            info!(
                "[startup] Cleared stale server info from {} worktree(s)",
                count
            );
        }
        Ok(_) => {}
        Err(e) => {
            warn!("[startup] Failed to clear stale worktree servers: {}", e);
        }
    }

    match database.clear_stale_task_workspace_ports() {
        Ok(count) if count > 0 => {
            info!(
                "[startup] Cleared stale server info from {} task workspace(s)",
                count
            );
        }
        Ok(_) => {}
        Err(e) => {
            warn!(
                "[startup] Failed to clear stale task workspace ports: {}",
                e
            );
        }
    }
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
    let server_manager = server_manager::ServerManager::new();
    let sse_bridge_manager = sse_bridge::SseBridgeManager::new();
    let whisper_manager = Arc::new(WhisperManager::with_active_model(whisper_model_pref));
    let (http_ready_tx, http_ready_rx) = tokio::sync::oneshot::channel::<()>();
    let app = http_server::electron_sidecar_app_handle(app_data_dir.clone(), resource_dir.clone());
    app.manage(db_arc.clone());
    app.manage(pty_manager.clone());
    app.manage(server_manager.clone());
    app.manage(sse_bridge_manager.clone());
    app.manage(github_client::GitHubClient::new());

    println!(
        "[electron-sidecar] using database {}",
        app_data_dir.join(database_filename()).display()
    );

    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(async move {
            tokio::spawn(resume_task_servers(app.clone(), http_ready_rx));

            let startup_project_id = {
                let db_lock = db_arc
                    .lock()
                    .map_err(|e| std::io::Error::other(format!("database lock error: {e}")))?;
                resolve_startup_project_id(&db_lock).map_err(std::io::Error::other)?
            };
            if let Some(project_id) = startup_project_id {
                let root_server_app = app.clone();
                tokio::spawn(async move {
                    if let Err(error) =
                        start_project_root_server(&root_server_app, &project_id).await
                    {
                        warn!(
                            "[startup] Failed to start project root server for {}: {}",
                            project_id, error
                        );
                    }
                });
            }

            http_server::start_http_sidecar_server(
                app,
                db_arc,
                pty_manager,
                server_manager,
                sse_bridge_manager,
                whisper_manager,
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
    use super::{
        load_resume_targets, opencode_resume_persistence, restore_resumed_session_state,
        should_start_project_root_server, sidecar_app_data_dir_from_override,
        ResumeSessionPersistence, ResumeTarget,
    };
    use crate::db::test_helpers::make_test_db;
    use crate::opencode_client::SessionStatusInfo;
    use std::collections::HashMap;
    use std::fs;

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

    #[test]
    fn test_should_start_project_root_server_for_opencode_project() {
        assert!(should_start_project_root_server(
            "opencode",
            Some("/tmp/project"),
            None
        ));
    }

    #[test]
    fn test_should_not_start_project_root_server_for_claude_project() {
        assert!(!should_start_project_root_server(
            "claude-code",
            Some("/tmp/project"),
            None
        ));
    }

    #[test]
    fn test_should_not_start_project_root_server_without_project_path() {
        assert!(!should_start_project_root_server("opencode", None, None));
    }

    #[test]
    fn test_should_not_start_project_root_server_when_already_running() {
        assert!(!should_start_project_root_server(
            "opencode",
            Some("/tmp/project"),
            Some(4100)
        ));
    }

    #[test]
    fn opencode_resume_persistence_marks_busy_status_running() {
        let statuses = HashMap::from([(
            "oc-ses-100".to_string(),
            SessionStatusInfo {
                status_type: "busy".to_string(),
            },
        )]);

        assert_eq!(
            opencode_resume_persistence(Some("oc-ses-100"), &statuses),
            ResumeSessionPersistence::Running
        );
    }

    #[test]
    fn opencode_resume_persistence_marks_idle_status_completed() {
        let statuses = HashMap::from([(
            "oc-ses-100".to_string(),
            SessionStatusInfo {
                status_type: "idle".to_string(),
            },
        )]);

        assert_eq!(
            opencode_resume_persistence(Some("oc-ses-100"), &statuses),
            ResumeSessionPersistence::Completed
        );
    }

    #[test]
    fn restore_resumed_session_state_keeps_interrupted_opencode_session_without_confirmed_running_status(
    ) {
        let (db, path) = make_test_db("restore_resumed_session_state");

        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");

        let task = db
            .create_task(
                "Resume me",
                "backlog",
                Some(&project.id),
                Some("Resume me"),
                None,
                None,
            )
            .expect("create task failed");
        db.update_task_status(&task.id, "doing")
            .expect("update task status failed");
        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/test-repo/.worktrees/T-100",
            "t-100",
        )
        .expect("create worktree failed");
        db.create_agent_session(
            "ses-100",
            &task.id,
            Some("oc-ses-100"),
            "implement",
            "running",
            "opencode",
        )
        .expect("create agent session failed");
        db.mark_running_sessions_interrupted()
            .expect("mark interrupted failed");

        let session = db
            .get_latest_session_for_ticket(&task.id)
            .expect("get latest session failed")
            .expect("missing latest session");
        assert_eq!(session.status, "interrupted");

        let target = ResumeTarget {
            task_id: task.id.clone(),
            project_id: project.id.clone(),
            repo_path: "/tmp/test-repo".to_string(),
            workspace_path: "/tmp/test-repo/.worktrees/T-100".to_string(),
            kind: "git_worktree".to_string(),
            branch_name: Some("t-100".to_string()),
        };

        restore_resumed_session_state(
            &db,
            Some(&session),
            &target,
            "opencode",
            4312,
            None,
            ResumeSessionPersistence::LeaveExisting,
        );

        let restored = db
            .get_latest_session_for_ticket(&task.id)
            .expect("get restored session failed")
            .expect("missing restored session");
        assert_eq!(restored.status, "interrupted");
        assert_eq!(restored.stage, "implement");
        assert_eq!(
            restored.error_message,
            Some("Session interrupted by app restart".to_string())
        );

        let worktree = db
            .get_worktree_for_task(&task.id)
            .expect("get worktree failed")
            .expect("missing worktree");
        assert_eq!(worktree.opencode_port, Some(4312));

        let workspace = db
            .get_task_workspace_for_task(&task.id)
            .expect("get task workspace failed")
            .expect("missing task workspace");
        assert_eq!(workspace.workspace_path, "/tmp/test-repo/.worktrees/T-100");
        assert_eq!(workspace.opencode_port, Some(4312));
        assert_eq!(workspace.kind, "git_worktree");

        drop(db);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn restore_resumed_pi_session_refreshes_checkpoint_for_completed_session() {
        let (db, path) = make_test_db("restore_resumed_pi_completed_checkpoint");

        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task(
                "Resume Pi",
                "doing",
                Some(&project.id),
                Some("Resume Pi"),
                Some("pi"),
                None,
            )
            .expect("create task failed");
        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/test-repo/.worktrees/T-200",
            "t-200",
        )
        .expect("create worktree failed");
        db.create_agent_session("ses-pi-200", &task.id, None, "implement", "completed", "pi")
            .expect("create pi session failed");
        db.set_agent_session_pi_id("ses-pi-200", "pi-ses-200")
            .expect("set pi session id failed");
        db.update_agent_session(
            "ses-pi-200",
            "implement",
            "completed",
            Some(r#"{"pty_instance_id":41}"#),
            None,
        )
        .expect("seed old checkpoint failed");

        let session = db
            .get_latest_session_for_ticket(&task.id)
            .expect("get latest session failed")
            .expect("missing latest session");
        let target = ResumeTarget {
            task_id: task.id.clone(),
            project_id: project.id.clone(),
            repo_path: "/tmp/test-repo".to_string(),
            workspace_path: "/tmp/test-repo/.worktrees/T-200".to_string(),
            kind: "git_worktree".to_string(),
            branch_name: Some("t-200".to_string()),
        };

        restore_resumed_session_state(
            &db,
            Some(&session),
            &target,
            "pi",
            0,
            Some(42),
            ResumeSessionPersistence::Running,
        );

        let restored = db
            .get_agent_session("ses-pi-200")
            .expect("get restored pi session failed")
            .expect("missing restored pi session");
        assert_eq!(restored.status, "completed");
        assert_eq!(
            restored.checkpoint_data,
            Some(r#"{"pty_instance_id":42}"#.to_string())
        );

        drop(db);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn load_resume_targets_prefers_task_workspaces_and_falls_back_to_worktrees() {
        let (db, path) = make_test_db("load_resume_targets");

        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");

        let task_with_workspace = db
            .create_task(
                "Workspace-backed",
                "doing",
                Some(&project.id),
                None,
                None,
                None,
            )
            .expect("create workspace-backed task failed");
        let task_with_legacy_worktree = db
            .create_task(
                "Legacy worktree",
                "doing",
                Some(&project.id),
                None,
                None,
                None,
            )
            .expect("create legacy worktree task failed");

        db.upsert_task_workspace_record(
            &task_with_workspace.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/test-repo",
            "project_dir",
            None,
            "opencode",
            Some(4001),
            "active",
        )
        .expect("upsert task workspace failed");

        db.create_worktree_record(
            &task_with_legacy_worktree.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/test-repo/.worktrees/legacy",
            "legacy-branch",
        )
        .expect("create legacy worktree failed");

        db.create_agent_session(
            "ses-workspace",
            &task_with_workspace.id,
            Some("oc-workspace"),
            "implement",
            "running",
            "opencode",
        )
        .expect("create workspace session failed");
        db.create_agent_session(
            "ses-legacy",
            &task_with_legacy_worktree.id,
            Some("oc-legacy"),
            "implement",
            "running",
            "opencode",
        )
        .expect("create legacy session failed");

        let targets = load_resume_targets(&db).expect("load resume targets failed");
        assert_eq!(targets.len(), 2);
        assert!(targets
            .iter()
            .any(|target| target.task_id == task_with_workspace.id
                && target.workspace_path == "/tmp/test-repo"));
        assert!(targets
            .iter()
            .any(|target| target.task_id == task_with_legacy_worktree.id
                && target.workspace_path == "/tmp/test-repo/.worktrees/legacy"));

        drop(db);
        let _ = fs::remove_file(path);
    }
}
