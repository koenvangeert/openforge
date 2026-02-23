// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod opencode_client;
mod jira_client;
mod jira_sync;
mod github_client;
mod github_poller;
mod git_worktree;
mod server_manager;
mod sse_bridge;
mod pty_manager;
mod agent_coordinator;
mod diff_parser;
mod whisper_manager;
mod commands;

use std::sync::Mutex;
use tauri::{Manager, Emitter};
use jira_client::JiraClient;
use github_client::GitHubClient;
use opencode_client::OpenCodeClient;
use pty_manager::PtyManager;
use whisper_manager::WhisperManager;

// ============================================================================
// Startup: Resume OpenCode Servers
// ============================================================================

async fn resume_task_servers(app: tauri::AppHandle) {
    let worktrees = {
        let db = app.state::<Mutex<db::Database>>();
        let db_lock = db.lock().unwrap();
        match db_lock.get_resumable_worktrees() {
            Ok(wts) => wts,
            Err(e) => {
                eprintln!("[startup] Failed to get resumable worktrees: {}", e);
                return;
            }
        }
    };

    if worktrees.is_empty() {
        return;
    }

    println!("[startup] Resuming OpenCode servers for {} task(s)", worktrees.len());

    let server_mgr = app.state::<server_manager::ServerManager>();
    let sse_mgr = app.state::<sse_bridge::SseBridgeManager>();

    for worktree in worktrees {
        let worktree_path = std::path::Path::new(&worktree.worktree_path);
        if !worktree_path.exists() {
            eprintln!(
                "[startup] Worktree path missing for task {}, skipping: {}",
                worktree.task_id, worktree.worktree_path
            );
            continue;
        }

        match server_mgr.spawn_server(&worktree.task_id, worktree_path).await {
            Ok(port) => {
                {
                    let db = app.state::<Mutex<db::Database>>();
                    let db_lock = db.lock().unwrap();
                    if let Err(e) = db_lock.update_worktree_server(&worktree.task_id, port as i64, 0) {
                        eprintln!(
                            "[startup] Failed to update worktree server for {}: {}",
                            worktree.task_id, e
                        );
                    }
                }

                if let Err(e) = sse_mgr
                    .start_bridge(app.clone(), worktree.task_id.clone(), None, port)
                    .await
                {
                    eprintln!(
                        "[startup] Failed to start SSE bridge for {}: {}",
                        worktree.task_id, e
                    );
                }

                let _ = app.emit(
                    "server-resumed",
                    serde_json::json!({
                        "task_id": worktree.task_id,
                        "port": port,
                    }),
                );

                println!(
                    "[startup] Resumed server for task {} on port {}",
                    worktree.task_id, port
                );
            }
            Err(e) => {
                eprintln!(
                    "[startup] Failed to spawn server for task {}: {}",
                    worktree.task_id, e
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

    ctrlc::set_handler(|| std::process::exit(0)).ok();

    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            let db_path = app_data_dir.join("ai_command_center.db");

            println!("Initializing database at: {:?}", db_path);

            let database = db::Database::new(db_path).expect("Failed to initialize database");

            match database.mark_running_sessions_interrupted() {
                Ok(count) if count > 0 => {
                    println!("[startup] Marked {} stale running sessions as interrupted", count);
                }
                Ok(_) => {}
                Err(e) => {
                    eprintln!("[startup] Failed to mark stale sessions: {}", e);
                }
            }

            match database.clear_stale_worktree_servers() {
                Ok(count) if count > 0 => {
                    println!("[startup] Cleared stale server info from {} worktree(s)", count);
                }
                Ok(_) => {}
                Err(e) => {
                    eprintln!("[startup] Failed to clear stale worktree servers: {}", e);
                }
            }

            app.manage(Mutex::new(database));

            println!("Database initialized successfully");

            let jira_client = JiraClient::new();
            let github_client = GitHubClient::new();

            let opencode_client = OpenCodeClient::with_base_url("http://127.0.0.1:4096".to_string());

            let server_manager = server_manager::ServerManager::new();
            let sse_bridge_manager = sse_bridge::SseBridgeManager::new();
            let pty_manager = PtyManager::new();
            let whisper_manager = WhisperManager::new();

            app.manage(opencode_client);
            app.manage(jira_client);
            app.manage(github_client);
            app.manage(server_manager);
            app.manage(sse_bridge_manager);
            app.manage(pty_manager);
            app.manage(whisper_manager);

            if let Err(e) = server_manager::ServerManager::new().cleanup_stale_pids() {
                eprintln!("Failed to cleanup stale server PIDs: {}", e);
            }

            if let Err(e) = PtyManager::new().cleanup_stale_pids() {
                eprintln!("Failed to cleanup stale PTY PIDs: {}", e);
            }

            println!("Server manager initialized");

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                jira_sync::start_jira_sync(app_handle).await;
            });

            println!("JIRA sync task started");

            let app_handle_github = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                github_poller::start_github_poller(app_handle_github).await;
            });

            println!("GitHub poller task started");

            let app_handle_resume = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                resume_task_servers(app_handle_resume).await;
            });

            println!("Server resume task started");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::opencode::get_opencode_status,
            commands::opencode::get_agents,
            commands::opencode::create_session,
            commands::opencode::send_prompt,
            commands::tasks::get_tasks,
            commands::tasks::get_task_detail,
            commands::tasks::create_task,
            commands::tasks::update_task,
            commands::tasks::update_task_status,
            commands::tasks::delete_task,
            commands::tasks::clear_done_tasks,
            commands::projects::create_project,
            commands::projects::get_projects,
            commands::projects::update_project,
            commands::projects::delete_project,
            commands::projects::get_project_config,
            commands::projects::set_project_config,
            commands::projects::get_tasks_for_project,
            commands::projects::get_worktree_for_task,
            commands::orchestration::start_implementation,
            commands::orchestration::run_action,
            commands::orchestration::abort_implementation,
            commands::jira::refresh_jira_info,
            commands::github::force_github_sync,
            commands::github::get_pull_requests,
            commands::github::get_pr_comments,
            commands::github::mark_comment_addressed,
            commands::agents::get_session_status,
            commands::agents::abort_session,
            commands::agents::get_agent_logs,
            commands::agents::get_latest_session,
            commands::agents::get_latest_sessions,
            commands::agents::get_session_output,
            commands::github::open_url,
            commands::config::get_config,
            commands::config::set_config,
            commands::config::check_opencode_installed,
            commands::review::get_github_username,
            commands::review::fetch_review_prs,
            commands::review::get_review_prs,
            commands::review::get_pr_file_diffs,
            commands::review::get_file_content,
            commands::review::get_file_at_ref,
            commands::review::get_review_comments,
            commands::review::get_pr_overview_comments,
            commands::review::submit_pr_review,
            commands::pty::pty_spawn,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            commands::self_review::get_task_diff,
            commands::self_review::get_task_file_contents,
            commands::self_review::add_self_review_comment,
            commands::self_review::get_active_self_review_comments,
            commands::self_review::get_archived_self_review_comments,
            commands::self_review::delete_self_review_comment,
            commands::self_review::archive_self_review_comments,
            commands::opencode::list_opencode_commands,
            commands::opencode::search_opencode_files,
            commands::whisper::transcribe_audio,
            commands::whisper::get_whisper_model_status,
            commands::whisper::download_whisper_model,
            commands::opencode::list_opencode_agents,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
