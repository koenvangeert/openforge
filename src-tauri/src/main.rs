// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod claude_hooks;
pub mod command_discovery;
mod commands;
mod db;
mod diff_parser;
mod git_worktree;
mod github_client;
mod github_poller;
mod http_server;
mod jira_client;
mod jira_sync;
mod mcp_installer;
mod migration;
mod opencode_client;
pub mod providers;
mod pty_manager;
pub mod review_parser;
mod review_prompt;
mod secure_store;
mod server_manager;
mod sse_bridge;
mod whisper_manager;
use github_client::GitHubClient;
use jira_client::JiraClient;
use log::{debug, error, info, warn};
use opencode_client::OpenCodeClient;
use pty_manager::PtyManager;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use whisper_manager::{WhisperManager, WhisperModelSize};

#[cfg(not(test))]
fn tauri_context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

#[cfg(test)]
fn tauri_context() -> tauri::Context<tauri::Wry> {
    panic!("unit tests should use tauri::test::mock_context instead of the production Tauri context")
}

// ============================================================================
// Startup: Resume OpenCode Servers
// ============================================================================

#[derive(Debug, Clone)]
struct ResumeTarget {
    task_id: String,
    project_id: String,
    repo_path: String,
    workspace_path: String,
    kind: String,
    branch_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ResumeSessionPersistence {
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

async fn resolve_resume_session_persistence(
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

fn load_resume_targets(db: &db::Database) -> rusqlite::Result<Vec<ResumeTarget>> {
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
    app: tauri::AppHandle,
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
                    restore_resumed_session_state(
                        &db_lock,
                        latest_session.as_ref(),
                        &target,
                        provider_name,
                        result.port,
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

                // Mark Claude sessions as interrupted on failure
                if provider_name == "claude-code" {
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

async fn start_project_root_server(app: &tauri::AppHandle, project_id: &str) -> Result<(), String> {
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

fn restore_resumed_session_state(
    db: &db::Database,
    latest_session: Option<&db::AgentSessionRow>,
    target: &ResumeTarget,
    provider_name: &str,
    port: u16,
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
        let persisted_status = if provider_name == "opencode" {
            match resume_persistence {
                ResumeSessionPersistence::LeaveExisting => None,
                ResumeSessionPersistence::Running => Some("running"),
                ResumeSessionPersistence::Completed => Some("completed"),
            }
        } else if matches!(session.status.as_str(), "interrupted" | "running") {
            Some("running")
        } else {
            None
        };

        if let Some(status) = persisted_status {
            let checkpoint_data = if status == "running" {
                session.checkpoint_data.as_deref()
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

fn main() {
    // Fix PATH for macOS GUI apps launched from Finder/Dock.
    // Without this, ~/.opencode/bin and other user PATH entries are missing.
    #[cfg(desktop)]
    let _ = fix_path_env::fix();

    // ctrlc handler is set up after app is built so it can trigger proper cleanup

    let log_plugin = {
        let mut builder = tauri_plugin_log::Builder::new()
            .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
            .max_file_size(10_000_000)
            .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5));

        if cfg!(debug_assertions) {
            builder = builder
                .level(log::LevelFilter::Warn)
                .level_for("openforge", log::LevelFilter::Debug)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: None,
                    }),
                ]);
        } else {
            builder = builder
                .level(log::LevelFilter::Warn)
                .level_for("openforge", log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: None,
                    }),
                ]);
        }

        builder.build()
    };

    let app = tauri::Builder::default()
        .plugin(log_plugin)
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            migration::run(&app_data_dir);

            let db_filename = if cfg!(debug_assertions) {
                "openforge_dev.db"
            } else {
                "openforge.db"
            };
            let db_path = app_data_dir.join(db_filename);

            info!(
                "Initializing database at: {:?} (mode: {})",
                db_path,
                if cfg!(debug_assertions) {
                    "dev"
                } else {
                    "prod"
                }
            );

            let database = db::Database::new(db_path).expect("Failed to initialize database");

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

            if let Err(e) = mcp_installer::install_mcp_server() {
                warn!("[startup] Failed to install MCP server: {}", e);
            }
            let whisper_model_pref = database
                .get_config("whisper_model_size")
                .ok()
                .flatten()
                .and_then(|s| WhisperModelSize::from_str(&s))
                .unwrap_or(WhisperModelSize::Small);

            let db_arc = Arc::new(Mutex::new(database));

            let (http_ready_tx, http_ready_rx) = tokio::sync::oneshot::channel::<()>();
            let app_handle_http = app.handle().clone();
            let db_for_http = db_arc.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) =
                    http_server::start_http_server(app_handle_http, db_for_http, http_ready_tx)
                        .await
                {
                    error!("[http_server] Failed to start: {}", e);
                }
            });
            debug!("HTTP server task started");

            let port =
                std::env::var("AI_COMMAND_CENTER_PORT").unwrap_or_else(|_| "17422".to_string());
            if let Err(e) = mcp_installer::configure_opencode_mcp(&port) {
                warn!("[startup] Failed to configure OpenCode MCP: {}", e);
            }
            if let Err(e) = mcp_installer::configure_claude_mcp(&port) {
                warn!("[startup] Failed to configure Claude Code MCP: {}", e);
            }

            let hooks_port = claude_hooks::get_http_server_port();
            match claude_hooks::generate_hooks_settings(hooks_port) {
                Ok(path) => info!("Claude hooks settings generated at: {:?}", path),
                Err(e) => warn!("Failed to generate Claude hooks settings: {}", e),
            }

            app.manage(db_arc.clone());

            info!("Database initialized successfully");
            let jira_client = JiraClient::new();
            let github_client = GitHubClient::new();
            let opencode_client =
                OpenCodeClient::with_base_url("http://127.0.0.1:4096".to_string());
            let server_manager = server_manager::ServerManager::new();
            let sse_bridge_manager = sse_bridge::SseBridgeManager::new();
            let pty_manager = PtyManager::new();
            let whisper_manager = WhisperManager::with_active_model(whisper_model_pref);

            app.manage(opencode_client);
            app.manage(jira_client);
            app.manage(github_client);
            app.manage(server_manager);
            app.manage(sse_bridge_manager);
            app.manage(pty_manager);
            app.manage(whisper_manager);
            app.manage(Arc::new(tokio::sync::Notify::new()));

            if let Err(e) = server_manager::ServerManager::new().cleanup_stale_pids() {
                warn!("Failed to cleanup stale server PIDs: {}", e);
            }

            if let Err(e) = PtyManager::new().cleanup_stale_pids() {
                warn!("Failed to cleanup stale PTY PIDs: {}", e);
            }

            info!("Server manager initialized");

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                jira_sync::start_jira_sync(app_handle).await;
            });

            debug!("JIRA sync task started");

            let app_handle_github = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                github_poller::start_github_poller(app_handle_github).await;
            });

            debug!("GitHub poller task started");

            let app_handle_resume = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                resume_task_servers(app_handle_resume, http_ready_rx).await;
            });

            debug!("Server resume task started");

            let app_handle_root_server = app.handle().clone();
            let db_for_root_server = db_arc.clone();
            tauri::async_runtime::spawn(async move {
                let startup_project_id = {
                    match db_for_root_server.lock() {
                        Ok(db) => match resolve_startup_project_id(&db) {
                            Ok(project_id) => project_id,
                            Err(e) => {
                                warn!("[startup] Failed to resolve root server project: {}", e);
                                None
                            }
                        },
                        Err(e) => {
                            error!(
                                "[startup] database lock error during root server startup: {}",
                                e
                            );
                            None
                        }
                    }
                };

                if let Some(project_id) = startup_project_id {
                    if let Err(e) =
                        start_project_root_server(&app_handle_root_server, &project_id).await
                    {
                        warn!(
                            "[startup] root OpenCode server auto-start failed for {}: {}",
                            project_id, e
                        );
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::opencode::get_agents,
            commands::opencode::create_session,
            commands::opencode::send_prompt,
            commands::tasks::get_tasks,
            commands::tasks::get_task_detail,
            commands::tasks::create_task,
            commands::tasks::update_task,
            commands::tasks::update_task_initial_prompt_and_summary,
            commands::tasks::update_task_status,
            commands::tasks::delete_task,
            commands::tasks::clear_done_tasks,
            commands::tasks::get_work_queue_tasks,
            commands::projects::create_project,
            commands::projects::get_projects,
            commands::projects::update_project,
            commands::projects::delete_project,
            commands::projects::get_project_config,
            commands::projects::set_project_config,
            commands::projects::get_tasks_for_project,
            commands::projects::get_worktree_for_task,
            commands::projects::get_task_workspace,
            commands::projects::get_project_attention,
            commands::orchestration::start_implementation,
            commands::orchestration::abort_implementation,
            commands::orchestration::finalize_claude_session,
            commands::jira::refresh_jira_info,
            commands::github::force_github_sync,
            commands::github::get_pull_requests,
            commands::github::get_pr_comments,
            commands::github::mark_comment_addressed,
            commands::github::merge_pull_request,
            commands::agents::get_session_status,
            commands::agents::abort_session,
            commands::agents::get_latest_session,
            commands::agents::get_latest_sessions,
            commands::agents::get_session_output,
            commands::github::open_url,
            commands::config::get_config,
            commands::config::set_config,
            commands::config::check_opencode_installed,
            commands::config::get_app_mode,
            commands::config::get_git_branch,
            commands::config::check_claude_installed,
            commands::review::get_github_username,
            commands::authored_prs::fetch_authored_prs,
            commands::authored_prs::get_authored_prs,
            commands::review::fetch_review_prs,
            commands::review::get_review_prs,
            commands::review::get_pr_file_diffs,
            commands::review::get_file_content,
            commands::review::get_file_at_ref,
            commands::review::get_review_comments,
            commands::review::get_pr_overview_comments,
            commands::review::submit_pr_review,
            commands::review::mark_review_pr_viewed,
            commands::pty::pty_spawn,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            commands::pty::get_pty_buffer,
            commands::pty::pty_spawn_shell,
            commands::pty::pty_kill_shells_for_task,
            commands::pty::get_running_pty_task_ids,
            commands::self_review::get_task_diff,
            commands::self_review::get_task_commits,
            commands::self_review::get_task_file_contents,
            commands::self_review::get_task_batch_file_contents,
            commands::self_review::get_commit_diff,
            commands::self_review::get_commit_file_contents,
            commands::self_review::get_commit_batch_file_contents,
            commands::self_review::add_self_review_comment,
            commands::self_review::get_active_self_review_comments,
            commands::self_review::get_archived_self_review_comments,
            commands::self_review::delete_self_review_comment,
            commands::self_review::archive_self_review_comments,
            commands::opencode::list_opencode_commands,
            commands::opencode::list_opencode_skills,
            commands::opencode::save_skill_content,
            commands::opencode::search_opencode_files,
            commands::whisper::transcribe_audio,
            commands::whisper::get_whisper_model_status,
            commands::whisper::download_whisper_model,
            commands::whisper::get_all_whisper_model_statuses,
            commands::whisper::set_whisper_model,
            commands::opencode::list_opencode_agents,
            commands::opencode::list_opencode_models,
            commands::agent_review::start_agent_review,
            commands::agent_review::get_agent_review_comments,
            commands::agent_review::update_agent_review_comment_status,
            commands::agent_review::dismiss_all_agent_review_comments,
            commands::agent_review::abort_agent_review,
        ])
        .build(tauri_context())
        .expect("error while building tauri application");

    // Fix Ctrl+C to route through Tauri's exit path so RunEvent::Exit fires
    let ctrlc_handle = app.handle().clone();
    ctrlc::set_handler(move || {
        info!("[shutdown] Ctrl+C received, triggering exit...");
        ctrlc_handle.exit(0);
    })
    .ok();

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            info!("[shutdown] App exit triggered, cleaning up...");
            let sse_mgr = app_handle.state::<sse_bridge::SseBridgeManager>();
            let server_mgr = app_handle.state::<server_manager::ServerManager>();
            let pty_mgr = app_handle.state::<pty_manager::PtyManager>();

            tauri::async_runtime::block_on(async {
                info!("[shutdown] Killing all PTY sessions...");

                pty_mgr.kill_all().await;

                info!("[shutdown] Stopping all SSE bridges...");
                sse_mgr.stop_all().await;

                info!("[shutdown] Stopping all OpenCode servers...");
                if let Err(e) = server_mgr.stop_all().await {
                    error!("[shutdown] Error stopping servers: {}", e);
                }

                info!("[shutdown] Cleanup complete");
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        load_resume_targets, opencode_resume_persistence, restore_resumed_session_state,
        should_start_project_root_server, ResumeSessionPersistence, ResumeTarget,
    };
    use crate::db::test_helpers::make_test_db;
    use crate::opencode_client::SessionStatusInfo;
    use std::collections::HashMap;
    use std::fs;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    #[test]
    fn test_mock_builder_does_not_require_frontend_dist_assets() {
        let app = mock_builder().build(mock_context(noop_assets()));

        assert!(app.is_ok(), "mock builder should not require frontendDist assets");
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
                None,
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
    fn load_resume_targets_prefers_task_workspaces_and_falls_back_to_worktrees() {
        let (db, path) = make_test_db("load_resume_targets");

        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");

        let task_with_workspace = db
            .create_task(
                "Workspace-backed",
                "doing",
                None,
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
                None,
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
