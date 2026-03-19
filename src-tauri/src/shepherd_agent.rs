use log::error;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::time::sleep;

use tauri::{AppHandle, Emitter, Manager};

use crate::db::Database;
use crate::opencode_client::OpenCodeClient;
use crate::providers::Provider;
use crate::pty_manager::PtyManager;
use crate::server_manager::ServerManager;
use crate::shepherd_events::ShepherdEventCollector;
use crate::shepherd_prompt::{build_event_summary_prompt, build_shepherd_system_prompt, ProjectSnapshot, SnapshotTask, SnapshotActionItem};
use crate::sse_bridge::SseBridgeManager;

#[derive(Debug, Clone)]
pub struct ShepherdSession {
    pub project_id: String,
    pub task_id: String,
    opencode_session_id: Option<String>,
    agent: Option<String>,
    model: Option<crate::opencode_client::PromptModel>,
}

pub struct ShepherdManager {
    app: Option<AppHandle>,
    active: Option<ShepherdSession>,
    message_log: Mutex<Vec<String>>,
}

impl ShepherdManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app: Some(app),
            active: None,
            message_log: Mutex::new(Vec::new()),
        }
    }

    pub async fn start_shepherd(
        &mut self,
        project_id: &str,
        db: &Arc<Mutex<Database>>,
    ) -> Result<(), String> {
        if self.active.is_some() {
            return Err("Shepherd session is already running".to_string());
        }

        let app = self
            .app
            .as_ref()
            .ok_or_else(|| "ShepherdManager app handle not configured".to_string())?;

        let (project, agent, model_str, initial_prompt) = {
            let db_guard = db
                .lock()
                .map_err(|e| format!("database lock error: {}", e))?;

            let project = db_guard
                .get_project(project_id)
                .map_err(|e| format!("Failed to load project {}: {}", project_id, e))?
                .ok_or_else(|| format!("Project {} not found", project_id))?;

            let agent = db_guard
                .get_project_config(project_id, "shepherd_agent")
                .ok()
                .flatten();

            let model_str = db_guard
                .get_project_config(project_id, "shepherd_model")
                .ok()
                .flatten();

            let initial_prompt = db_guard
                .get_project_config(project_id, "shepherd_initial_prompt")
                .ok()
                .flatten();

            (project, agent, model_str, initial_prompt)
        };

        let model = model_str.as_deref().and_then(parse_model_string);

        let provider = Provider::from_name(
            "opencode",
            app.state::<PtyManager>().inner().clone(),
            app.state::<ServerManager>().inner().clone(),
            app.state::<SseBridgeManager>().inner().clone(),
        )?;

        let task_id = shepherd_task_id(project_id);
        let prompt = build_shepherd_system_prompt(&project.name, project_id, initial_prompt.as_deref());
        let result = provider
            .start(
                &task_id,
                Path::new(&project.path),
                &prompt,
                agent.as_deref(),
                None,
                model.as_ref(),
                app,
            )
            .await?;

        if let Some(ref session_id) = result.opencode_session_id {
            if result.port > 0 {
                let pty_mgr = app.state::<PtyManager>().inner().clone();
                pty_mgr
                    .spawn_pty(&task_id, result.port, session_id, 80, 24, app.clone())
                    .await
                    .map_err(|e| format!("Failed to spawn shepherd PTY: {}", e))?;
            }
        }

        self.active = Some(ShepherdSession {
            project_id: project_id.to_string(),
            task_id,
            opencode_session_id: result.opencode_session_id,
            agent,
            model,
        });

        Ok(())
    }

    pub async fn stop_shepherd(&mut self) -> Result<(), String> {
        let Some(active) = self.active.clone() else {
            return Ok(());
        };

        let app = self
            .app
            .as_ref()
            .ok_or_else(|| "ShepherdManager app handle not configured".to_string())?;

        let pty_mgr = app.state::<PtyManager>().inner().clone();
        let _ = pty_mgr.kill_pty(&active.task_id).await;

        let server_mgr = app.state::<ServerManager>().inner().clone();
        let _ = server_mgr.stop_server(&active.task_id).await;

        let sse_mgr = app.state::<SseBridgeManager>().inner().clone();
        sse_mgr.stop_bridge(&active.task_id).await;

        self.active = None;
        Ok(())
    }

    pub async fn send_message(&self, content: &str) -> Result<(), String> {
        let active = self
            .active
            .clone()
            .ok_or_else(|| "Shepherd session is not running".to_string())?;

        let app = self
            .app
            .as_ref()
            .ok_or_else(|| "ShepherdManager app handle not configured".to_string())?;

        send_message_for_session(app, &active, content).await?;

        let mut guard = self
            .message_log
            .lock()
            .map_err(|e| format!("shepherd message log lock error: {}", e))?;
        guard.push(content.to_string());

        Ok(())
    }

    pub fn is_running(&self) -> bool {
        self.active.is_some()
    }

    #[cfg(test)]
    pub fn active_project_id(&self) -> Option<&str> {
        self.active.as_ref().map(|session| session.project_id.as_str())
    }

    pub fn active_session(&self) -> Option<ShepherdSession> {
        self.active.clone()
    }
}

pub(crate) fn shepherd_task_id(project_id: &str) -> String {
    format!("shepherd-{}", project_id)
}

async fn send_message_for_session(
    app: &AppHandle,
    active: &ShepherdSession,
    content: &str,
) -> Result<(), String> {
    let _ = app.emit("shepherd-status-changed", "thinking");

    send_to_opencode_provider(
        app,
        &active.task_id,
        active.opencode_session_id.as_deref(),
        active.agent.as_deref(),
        active.model.as_ref(),
        content,
    )
    .await?;

    let response =
        capture_opencode_response(app, &active.task_id, active.opencode_session_id.as_deref())
            .await?;

    persist_and_emit_shepherd_message(app, &active.project_id, &response)?;
    let _ = app.emit("shepherd-status-changed", "idle");

    Ok(())
}

async fn send_to_opencode_provider(
    app: &AppHandle,
    task_id: &str,
    opencode_session_id: Option<&str>,
    agent: Option<&str>,
    model: Option<&crate::opencode_client::PromptModel>,
    content: &str,
) -> Result<(), String> {
    let session_id = opencode_session_id
        .ok_or_else(|| "Shepherd OpenCode session ID missing".to_string())?;
    let server_mgr = app.state::<ServerManager>().inner().clone();
    let port = server_mgr
        .get_server_port(task_id)
        .await
        .ok_or_else(|| format!("No running OpenCode server found for Shepherd task {}", task_id))?;

    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    client
        .prompt_async(
            session_id,
            content.to_string(),
            agent.map(str::to_string),
            model.cloned(),
        )
        .await
        .map_err(|e| format!("Failed to send Shepherd prompt to OpenCode: {}", e))
}

fn parse_model_string(s: &str) -> Option<crate::opencode_client::PromptModel> {
    let parts: Vec<&str> = s.splitn(2, '/').collect();
    if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
        Some(crate::opencode_client::PromptModel {
            provider_id: parts[0].to_string(),
            model_id: parts[1].to_string(),
        })
    } else {
        None
    }
}

async fn capture_opencode_response(
    app: &AppHandle,
    task_id: &str,
    opencode_session_id: Option<&str>,
) -> Result<String, String> {
    let session_id = opencode_session_id
        .ok_or_else(|| "Shepherd OpenCode session ID missing".to_string())?;
    let server_mgr = app.state::<ServerManager>().inner().clone();
    let port = server_mgr
        .get_server_port(task_id)
        .await
        .ok_or_else(|| format!("No running OpenCode server found for Shepherd task {}", task_id))?;
    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));

    let before = client
        .get_session_messages(session_id)
        .await
        .ok()
        .and_then(|msgs| extract_assistant_text_from_opencode_messages(&msgs));

    for _ in 0..45 {
        sleep(Duration::from_secs(1)).await;
        let messages = client
            .get_session_messages(session_id)
            .await
            .map_err(|e| format!("Failed to fetch Shepherd OpenCode messages: {}", e))?;
        let latest = extract_assistant_text_from_opencode_messages(&messages);

        if latest.is_some() && latest != before {
            return Ok(latest.unwrap_or_default());
        }
    }

    Err("Timed out waiting for Shepherd OpenCode response".to_string())
}

fn persist_and_emit_shepherd_message(
    app: &AppHandle,
    project_id: &str,
    content: &str,
) -> Result<(), String> {
    let db_state = app.state::<Arc<Mutex<Database>>>();
    let db = db_state
        .lock()
        .map_err(|e| format!("database lock error: {}", e))?;
    let row = db
        .insert_shepherd_message(project_id, "shepherd", content, None)
        .map_err(|e| format!("Failed to persist shepherd response: {}", e))?;

    app.emit(
        "shepherd-message",
        serde_json::json!({
            "id": row.id,
            "project_id": row.project_id,
            "role": row.role,
            "content": row.content,
            "event_context": row.event_context,
            "created_at": row.created_at,
        }),
    )
    .map_err(|e| format!("Failed to emit shepherd-message: {}", e))
}

fn extract_assistant_text_from_opencode_messages(messages: &[serde_json::Value]) -> Option<String> {
    for message in messages.iter().rev() {
        let role = message.get("role").and_then(|v| v.as_str()).unwrap_or_default();
        if role != "assistant" {
            continue;
        }

        let parts = message.get("parts")?.as_array()?;
        let text = parts
            .iter()
            .filter(|part| part.get("type").and_then(|v| v.as_str()) == Some("text"))
            .filter_map(|part| part.get("text").and_then(|v| v.as_str()))
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();

        if !text.is_empty() {
            return Some(text);
        }
    }

    None
}

fn build_snapshot_from_db(app: &AppHandle, project_id: &str) -> ProjectSnapshot {
    let db_state = app.state::<Arc<Mutex<Database>>>();
    let db = match db_state.lock() {
        Ok(guard) => guard,
        Err(e) => {
            error!("[shepherd] database lock poisoned in snapshot builder: {}", e);
            return ProjectSnapshot::default();
        }
    };

    let attention = db.get_project_attention_for_project(project_id).ok().flatten();

    let doing_tasks = db
        .get_tasks_for_project_by_state(project_id, "doing")
        .unwrap_or_default()
        .into_iter()
        .map(|t| SnapshotTask {
            id: t.id,
            prompt: t.initial_prompt,
            session_status: None,
        })
        .collect();

    let work_queue = db
        .get_work_queue_tasks_for_project(project_id)
        .unwrap_or_default()
        .into_iter()
        .map(|t| SnapshotTask {
            id: t.task.id,
            prompt: t.task.initial_prompt,
            session_status: t.session_status,
        })
        .collect();

    let active_action_items = db
        .get_active_action_items(project_id, 20)
        .unwrap_or_default()
        .into_iter()
        .map(|a| SnapshotActionItem {
            id: a.id,
            title: a.title,
            task_id: a.task_id,
        })
        .collect();

    ProjectSnapshot {
        needs_input: attention.as_ref().map_or(0, |a| a.needs_input),
        running_agents: attention.as_ref().map_or(0, |a| a.running_agents),
        ci_failures: attention.as_ref().map_or(0, |a| a.ci_failures),
        unaddressed_comments: attention.as_ref().map_or(0, |a| a.unaddressed_comments),
        completed_agents: attention.as_ref().map_or(0, |a| a.completed_agents),
        doing_tasks,
        work_queue,
        active_action_items,
    }
}

pub fn resolve_startup_project_id(db: &Database) -> Result<Option<String>, String> {
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

pub async fn start_shepherd_if_enabled(app: &AppHandle, project_id: &str) -> Result<(), String> {
    let is_enabled = {
        let db_state = app.state::<Arc<Mutex<Database>>>();
        let db = db_state
            .lock()
            .map_err(|e| format!("database lock error: {}", e))?;
        db.get_project_config(project_id, "task_shepherd_enabled")
            .map_err(|e| format!("Failed to read shepherd setting: {}", e))?
            .is_some_and(|v| v == "true")
    };

    if !is_enabled {
        return Ok(());
    }

    let db_state = app.state::<Arc<Mutex<Database>>>().inner().clone();
    let shepherd_state = app.state::<Arc<tokio::sync::Mutex<ShepherdManager>>>().inner().clone();

    let mut manager = shepherd_state.lock().await;

    if manager.is_running() {
        return Ok(());
    }

    manager.start_shepherd(project_id, &db_state).await
}

pub async fn shepherd_flush_loop(app: AppHandle) {
    let notify = app.state::<Arc<tokio::sync::Notify>>();

    loop {
        notify.notified().await;

        let debounce = {
            let collector_state = app.state::<Arc<Mutex<ShepherdEventCollector>>>();
            let collector = match collector_state.lock() {
                Ok(guard) => guard,
                Err(_) => continue,
            };
            collector.debounce_remaining()
        };

        if !debounce.is_zero() {
            sleep(debounce).await;
        }

        let events = {
            let collector_state = app.state::<Arc<Mutex<ShepherdEventCollector>>>();
            let mut collector = match collector_state.lock() {
                Ok(guard) => guard,
                Err(e) => {
                    error!("[shepherd] collector lock error: {}", e);
                    continue;
                }
            };

            if collector.is_empty() {
                continue;
            }

            collector.flush()
        };

        let active_session = {
            let shepherd_state = app.state::<Arc<tokio::sync::Mutex<ShepherdManager>>>();
            let manager = shepherd_state.lock().await;

            if !manager.is_running() {
                continue;
            }

            manager.active_session()
        };

        let Some(active_session) = active_session else {
            continue;
        };

        let snapshot = build_snapshot_from_db(&app, &active_session.project_id);
        let prompt = build_event_summary_prompt(&events, &snapshot);
        if prompt.is_empty() {
            continue;
        }

        if let Err(e) = send_message_for_session(&app, &active_session, &prompt).await {
            error!("[shepherd] failed to send message to provider: {}", e);
            let _ = app.emit("shepherd-status-changed", "error");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::make_test_db;

    #[test]
    fn test_shepherd_manager_state() {
        let mut manager = ShepherdManager {
            app: None,
            active: None,
            message_log: Mutex::new(Vec::new()),
        };

        assert!(!manager.is_running());
        assert_eq!(manager.active_project_id(), None);

        manager.active = Some(ShepherdSession {
            project_id: "P-1".to_string(),
            task_id: shepherd_task_id("P-1"),
            opencode_session_id: None,
            agent: None,
            model: None,
        });

        assert!(manager.is_running());
        assert_eq!(manager.active_project_id(), Some("P-1"));
        assert_eq!(
            manager.active.as_ref().map(|s| s.task_id.as_str()),
            Some("shepherd-P-1")
        );
    }

    #[test]
    fn test_shepherd_resolve_startup_project_id_uses_config() {
        let (db, path) = make_test_db("shepherd_startup_project");

        let project = db
            .create_project("Startup Project", "/tmp/startup-project")
            .expect("create project");
        db.set_config("active_project_id", &project.id)
            .expect("set active project config");

        let resolved = resolve_startup_project_id(&db).expect("resolve startup project");
        assert_eq!(resolved, Some(project.id.clone()));

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_shepherd_resolve_startup_project_id_falls_back_to_first_project() {
        let (db, path) = make_test_db("shepherd_startup_fallback_project");

        let first = db
            .create_project("First Project", "/tmp/first-project")
            .expect("create first project");
        db.create_project("Second Project", "/tmp/second-project")
            .expect("create second project");

        let resolved = resolve_startup_project_id(&db).expect("resolve startup project");
        assert_eq!(resolved, Some(first.id));

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_shepherd_resolve_startup_project_id_none_when_no_projects() {
        let (db, path) = make_test_db("shepherd_startup_no_projects");

        let resolved = resolve_startup_project_id(&db).expect("resolve startup project");
        assert_eq!(resolved, None);

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn test_stop_shepherd_when_not_running_is_ok() {
        let mut manager = ShepherdManager {
            app: None,
            active: None,
            message_log: Mutex::new(Vec::new()),
        };

        let result = manager.stop_shepherd().await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_assistant_text_from_opencode_messages_returns_latest_assistant_text() {
        let messages = vec![
            serde_json::json!({
                "role": "user",
                "parts": [{ "type": "text", "text": "hello" }]
            }),
            serde_json::json!({
                "role": "assistant",
                "parts": [{ "type": "text", "text": "First response" }]
            }),
            serde_json::json!({
                "role": "assistant",
                "parts": [{ "type": "text", "text": "Latest response" }]
            }),
        ];

        let extracted = extract_assistant_text_from_opencode_messages(&messages);
        assert_eq!(extracted, Some("Latest response".to_string()));
    }

    #[test]
    fn test_parse_model_string_valid() {
        let parsed = parse_model_string("anthropic/claude-sonnet");
        assert!(parsed.is_some());
        let model = parsed.unwrap();
        assert_eq!(model.provider_id, "anthropic");
        assert_eq!(model.model_id, "claude-sonnet");
    }

    #[test]
    fn test_parse_model_string_invalid() {
        assert!(parse_model_string("").is_none());
        assert!(parse_model_string("anthropic").is_none());
        assert!(parse_model_string("/claude-sonnet").is_none());
        assert!(parse_model_string("anthropic/").is_none());
        assert!(parse_model_string("/").is_none());
    }

}
