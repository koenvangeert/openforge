use crate::{db, http_server, providers, pty_manager::PtyManager};
use log::{debug, error, info, warn};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

// ============================================================================
// Startup: Resume Agent Sessions
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

fn startup_resume_database_lock_message(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}: database lock error: {error}")
}

pub(crate) async fn resume_task_sessions(
    app: crate::backend_runtime::AppHandle,
    http_ready: tokio::sync::oneshot::Receiver<()>,
    sidecar_readiness: http_server::SidecarReadinessState,
    stale_running_session_cutoff: i64,
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
        let db_lock = match db.lock() {
            Ok(db_lock) => db_lock,
            Err(e) => {
                let message = startup_resume_database_lock_message(
                    "failed to get resumable task workspaces",
                    e,
                );
                error!("[startup] {message}");
                sidecar_readiness.mark_startup_resume_degraded(message);
                let _ = app.emit("startup-resume-complete", ());
                return;
            }
        };
        match load_resume_targets(&db_lock) {
            Ok(targets) => targets,
            Err(e) => {
                error!("[startup] Failed to get resumable task workspaces: {}", e);
                sidecar_readiness.mark_startup_resume_degraded(format!(
                    "failed to get resumable task workspaces: {e}"
                ));
                let _ = app.emit("startup-resume-complete", ());
                return;
            }
        }
    };

    if resume_targets.is_empty() {
        mark_unresumed_running_sessions_interrupted(&app, stale_running_session_cutoff);
        sidecar_readiness.mark_startup_resume_complete();
        let _ = app.emit("startup-resume-complete", ());
        return;
    }

    sidecar_readiness.mark_startup_resume_running(resume_targets.len());

    info!(
        "[startup] Resuming agent sessions for {} task(s)",
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
            let db_lock = match db.lock() {
                Ok(db_lock) => db_lock,
                Err(e) => {
                    let message = startup_resume_database_lock_message(
                        &format!("failed to load latest session for task {}", target.task_id),
                        e,
                    );
                    error!("[startup] {message}");
                    sidecar_readiness.record_startup_resume_failure(message);
                    let _ = app.emit(
                        "session-resumed",
                        serde_json::json!({
                            "task_id": target.task_id,
                            "workspace_path": target.workspace_path,
                        }),
                    );
                    continue;
                }
            };
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

        let start_context = providers::ProviderStartContext::new(Some(app.clone()), None);

        match provider
            .resume(
                &target.task_id,
                session_ref,
                workspace_path,
                None,
                None,
                None,
                None,
                &start_context,
            )
            .await
        {
            Ok(result) => {
                {
                    let db = app.state::<Arc<Mutex<db::Database>>>();
                    match db.lock() {
                        Ok(db_lock) => {
                            if provider_name == "pi" {
                                if let (Some(session), Some(pi_session_id)) =
                                    (latest_session.as_ref(), result.pi_session_id.as_deref())
                                {
                                    if session.pi_session_id.as_deref() != Some(pi_session_id) {
                                        if let Err(e) = db_lock
                                            .set_agent_session_pi_id(&session.id, pi_session_id)
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
                                result.pty_instance_id,
                            );
                        }
                        Err(e) => {
                            let message = startup_resume_database_lock_message(
                                &format!(
                                    "failed to persist resumed session state for task {}",
                                    target.task_id
                                ),
                                e,
                            );
                            error!("[startup] {message}");
                            sidecar_readiness.record_startup_resume_failure(message);
                        }
                    };
                }

                let _ = app.emit(
                    "session-resumed",
                    serde_json::json!({
                        "task_id": target.task_id,
                        "workspace_path": target.workspace_path,
                    }),
                );

                sidecar_readiness.record_startup_resume_success();

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
                sidecar_readiness.record_startup_resume_failure(format!(
                    "failed to resume {provider_name} for task {}: {e}",
                    target.task_id
                ));

                // Mark provider sessions as interrupted on failure for providers that do not
                // have an external status source to reconcile against after startup.
                if matches!(provider_name, "claude-code" | "pi" | "opencode") {
                    if let Some(ref session) = latest_session {
                        let db = app.state::<Arc<Mutex<db::Database>>>();
                        match db.lock() {
                            Ok(db_lock) => {
                                let _ = db_lock.update_agent_session(
                                    &session.id,
                                    &session.stage,
                                    "interrupted",
                                    None,
                                    Some("App restarted"),
                                );
                            }
                            Err(e) => {
                                let message = startup_resume_database_lock_message(
                                    &format!(
                                        "failed to mark resumed session interrupted for task {}",
                                        target.task_id
                                    ),
                                    e,
                                );
                                warn!("[startup] {message}");
                                sidecar_readiness.record_startup_resume_failure(message);
                            }
                        };
                    }
                }

                let _ = app.emit(
                    "session-resumed",
                    serde_json::json!({
                        "task_id": target.task_id,
                        "workspace_path": target.workspace_path,
                    }),
                );
            }
        }
    }

    mark_unresumed_running_sessions_interrupted(&app, stale_running_session_cutoff);
    sidecar_readiness.mark_startup_resume_complete();
    let _ = app.emit("startup-resume-complete", ());
    info!("[startup] Resume complete, emitted startup-resume-complete event");
}

fn mark_unresumed_running_sessions_interrupted(
    app: &crate::backend_runtime::AppHandle,
    stale_running_session_cutoff: i64,
) {
    let db = app.state::<Arc<Mutex<db::Database>>>();
    let db_lock = match db.lock() {
        Ok(db_lock) => db_lock,
        Err(e) => {
            warn!(
                "[startup] Failed to mark unresumed running sessions: database lock error: {}",
                e
            );
            return;
        }
    };

    match db_lock.mark_running_sessions_interrupted_before(stale_running_session_cutoff) {
        Ok(count) if count > 0 => {
            info!(
                "[startup] Marked {} unresumed running sessions as interrupted",
                count
            );
        }
        Ok(_) => {}
        Err(e) => {
            warn!("[startup] Failed to mark stale sessions: {}", e);
        }
    }
}

pub(crate) fn restore_resumed_session_state(
    db: &db::Database,
    latest_session: Option<&db::AgentSessionRow>,
    target: &ResumeTarget,
    provider_name: &str,
    pty_instance_id: Option<u64>,
) {
    if let Err(e) = db.upsert_task_workspace_record(
        &target.task_id,
        &target.project_id,
        &target.workspace_path,
        &target.repo_path,
        &target.kind,
        target.branch_name.as_deref(),
        provider_name,
        "active",
    ) {
        warn!(
            "[startup] Failed to update task workspace for {}: {}",
            target.task_id, e
        );
    }

    if let Some(session) = latest_session {
        let pty_checkpoint_data = pty_instance_id.map(|id| {
            serde_json::json!({
                "pty_instance_id": id,
            })
            .to_string()
        });

        let persisted_status = if matches!(session.status.as_str(), "interrupted" | "running") {
            Some("running")
        } else if matches!(provider_name, "pi" | "opencode")
            && pty_checkpoint_data.is_some()
            && matches!(session.status.as_str(), "completed" | "paused")
        {
            Some(session.status.as_str())
        } else {
            None
        };

        if let Some(status) = persisted_status {
            let checkpoint_data =
                if status == "running" || matches!(provider_name, "pi" | "opencode") {
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

#[cfg(test)]
mod tests {
    use super::{
        load_resume_targets, restore_resumed_session_state, resume_task_sessions, ResumeTarget,
    };
    use crate::app_events::{AppEventError, AppEventId, EmitReceipt, RustAppEventAdapter};
    use crate::db::test_helpers::make_test_db;
    use std::fs;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct RecordingEventAdapter {
        events: Mutex<Vec<String>>,
    }

    impl RustAppEventAdapter for RecordingEventAdapter {
        fn emit(
            &self,
            event_name: &str,
            _payload: serde_json::Value,
        ) -> Result<EmitReceipt, AppEventError> {
            self.events
                .lock()
                .expect("recording event adapter lock poisoned")
                .push(event_name.to_string());
            Ok(EmitReceipt {
                id: AppEventId {
                    epoch: "test".to_string(),
                    seq: 1,
                },
            })
        }
    }

    #[tokio::test]
    async fn resume_task_sessions_reports_degraded_readiness_when_initial_database_lock_is_poisoned(
    ) {
        let (db, path) = make_test_db("resume_task_sessions_poisoned_initial_lock");
        let db = Arc::new(Mutex::new(db));
        let poison_db = Arc::clone(&db);
        let _ = std::thread::spawn(move || {
            let _guard = poison_db.lock().expect("lock test database before panic");
            panic!("poison test database lock");
        })
        .join();

        let app = crate::backend_runtime::AppHandle::new();
        app.manage(Arc::clone(&db));
        let event_adapter = Arc::new(RecordingEventAdapter::default());
        app.set_app_event_adapter(event_adapter.clone());
        let sidecar_readiness = crate::http_server::SidecarReadinessState::new();
        let (http_ready_tx, http_ready_rx) = tokio::sync::oneshot::channel();
        http_ready_tx.send(()).expect("send http ready signal");

        resume_task_sessions(app, http_ready_rx, sidecar_readiness.clone(), 0).await;

        let startup_resume = sidecar_readiness.startup_resume();
        assert_eq!(startup_resume.phase, "degraded");
        assert!(sidecar_readiness
            .degraded()
            .iter()
            .any(|state| state.area == "startupResume"
                && state.message.contains("database lock error")));
        assert!(event_adapter
            .events
            .lock()
            .expect("read recorded events")
            .iter()
            .any(|event| event == "startup-resume-complete"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn restore_resumed_session_state_marks_interrupted_opencode_session_running_like_other_tty_providers(
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

        restore_resumed_session_state(&db, Some(&session), &target, "opencode", None);

        let restored = db
            .get_latest_session_for_ticket(&task.id)
            .expect("get restored session failed")
            .expect("missing restored session");
        assert_eq!(restored.status, "running");
        assert_eq!(restored.stage, "implement");
        assert_eq!(restored.error_message, None);

        let workspace = db
            .get_task_workspace_for_task(&task.id)
            .expect("get task workspace failed")
            .expect("missing task workspace");
        assert_eq!(workspace.workspace_path, "/tmp/test-repo/.worktrees/T-100");
        assert_eq!(workspace.kind, "git_worktree");

        drop(db);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn restore_resumed_opencode_session_becomes_running_after_tty_resume() {
        let (db, path) = make_test_db("restore_resumed_opencode_tty_running");

        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task(
                "Resume OpenCode TTY",
                "doing",
                Some(&project.id),
                Some("Resume OpenCode TTY"),
                Some("opencode"),
            )
            .expect("create task failed");
        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/test-repo/.worktrees/T-201",
            "t-201",
        )
        .expect("create worktree failed");
        db.create_agent_session(
            "ses-oc-201",
            &task.id,
            Some("oc-ses-201"),
            "implement",
            "running",
            "opencode",
        )
        .expect("create opencode session failed");
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
            workspace_path: "/tmp/test-repo/.worktrees/T-201".to_string(),
            kind: "git_worktree".to_string(),
            branch_name: Some("t-201".to_string()),
        };

        restore_resumed_session_state(&db, Some(&session), &target, "opencode", Some(42));

        let restored = db
            .get_agent_session("ses-oc-201")
            .expect("get restored opencode session failed")
            .expect("missing restored opencode session");
        assert_eq!(restored.status, "running");
        assert_eq!(
            restored.checkpoint_data,
            Some(r#"{"pty_instance_id":42}"#.to_string())
        );
        assert_eq!(restored.error_message, None);

        drop(db);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn restore_resumed_opencode_session_refreshes_checkpoint_for_completed_session() {
        let (db, path) = make_test_db("restore_resumed_opencode_completed_checkpoint");

        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task(
                "Resume completed OpenCode",
                "doing",
                Some(&project.id),
                Some("Resume completed OpenCode"),
                Some("opencode"),
            )
            .expect("create task failed");
        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/test-repo/.worktrees/T-202",
            "t-202",
        )
        .expect("create worktree failed");
        db.create_agent_session(
            "ses-oc-202",
            &task.id,
            Some("oc-ses-202"),
            "implement",
            "completed",
            "opencode",
        )
        .expect("create opencode session failed");
        db.update_agent_session(
            "ses-oc-202",
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
            workspace_path: "/tmp/test-repo/.worktrees/T-202".to_string(),
            kind: "git_worktree".to_string(),
            branch_name: Some("t-202".to_string()),
        };

        restore_resumed_session_state(&db, Some(&session), &target, "opencode", Some(42));

        let restored = db
            .get_agent_session("ses-oc-202")
            .expect("get restored opencode session failed")
            .expect("missing restored opencode session");
        assert_eq!(restored.status, "completed");
        assert_eq!(
            restored.checkpoint_data,
            Some(r#"{"pty_instance_id":42}"#.to_string())
        );

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

        restore_resumed_session_state(&db, Some(&session), &target, "pi", Some(42));

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
            .create_task("Workspace-backed", "doing", Some(&project.id), None, None)
            .expect("create workspace-backed task failed");
        let task_with_legacy_worktree = db
            .create_task("Legacy worktree", "doing", Some(&project.id), None, None)
            .expect("create legacy worktree task failed");

        db.upsert_task_workspace_record(
            &task_with_workspace.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/test-repo",
            "project_dir",
            None,
            "opencode",
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
