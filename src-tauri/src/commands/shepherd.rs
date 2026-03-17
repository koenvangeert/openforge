use std::sync::{Arc, Mutex};
use tauri::State;
use crate::db::{Database, ShepherdMessageRow};
use crate::shepherd_agent::ShepherdManager;
use crate::shepherd_events::{
    map_agent_completed, map_agent_checkpoint, map_agent_errored, map_agent_started,
    map_ci_status_changed, map_new_pr_comment, map_review_status_changed, map_task_created,
    map_task_deleted, map_task_moved, ShepherdEventCollector,
};
use crate::shepherd_prompt::ShepherdEvent;

#[tauri::command]
pub async fn get_shepherd_messages(
    db: State<'_, Arc<Mutex<Database>>>,
    project_id: String,
    limit: i64,
) -> Result<Vec<ShepherdMessageRow>, String> {
    if !(1..=100).contains(&limit) {
        return Err("limit must be between 1 and 100".to_string());
    }
    let db = db.lock().map_err(|e| format!("database lock error: {}", e))?;
    db.get_shepherd_messages(&project_id, limit)
        .map_err(|e| format!("failed to get shepherd messages: {}", e))
}

#[tauri::command]
pub async fn clear_shepherd_messages(
    db: State<'_, Arc<Mutex<Database>>>,
    project_id: String,
) -> Result<(), String> {
    let db = db.lock().map_err(|e| format!("database lock error: {}", e))?;
    db.clear_shepherd_messages(&project_id)
        .map_err(|e| format!("failed to clear shepherd messages: {}", e))
}

#[tauri::command]
pub async fn insert_shepherd_message(
    db: State<'_, Arc<Mutex<Database>>>,
    project_id: String,
    role: String,
    content: String,
) -> Result<ShepherdMessageRow, String> {
    let db = db.lock().map_err(|e| format!("database lock error: {}", e))?;
    db.insert_shepherd_message(&project_id, &role, &content, None)
        .map_err(|e| format!("failed to insert shepherd message: {}", e))
}

#[tauri::command]
pub async fn send_shepherd_message(
    db: State<'_, Arc<Mutex<Database>>>,
    shepherd: State<'_, Arc<tokio::sync::Mutex<ShepherdManager>>>,
    project_id: String,
    content: String,
) -> Result<(), String> {
    if content.is_empty() || content.len() > 10_000 {
        return Err("content must be between 1 and 10000 characters".to_string());
    }
    {
        let db = db.lock().map_err(|e| format!("database lock error: {}", e))?;
        db.insert_shepherd_message(&project_id, "user", &content, None)
            .map_err(|e| format!("failed to persist shepherd message: {}", e))?;
    }
    let manager = shepherd.lock().await;
    if manager.is_running() {
        manager.send_message(&content).await
            .map_err(|e| format!("failed to send message to shepherd: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn start_shepherd(
    db: State<'_, Arc<Mutex<Database>>>,
    shepherd: State<'_, Arc<tokio::sync::Mutex<ShepherdManager>>>,
    project_id: String,
) -> Result<(), String> {
    let db_arc = db.inner().clone();
    let mut manager = shepherd.lock().await;
    manager.start_shepherd(&project_id, &db_arc).await
}

#[tauri::command]
pub async fn stop_shepherd(
    shepherd: State<'_, Arc<tokio::sync::Mutex<ShepherdManager>>>,
) -> Result<(), String> {
    let mut manager = shepherd.lock().await;
    manager.stop_shepherd().await
}

#[tauri::command]
pub async fn get_shepherd_status(
    shepherd: State<'_, Arc<tokio::sync::Mutex<ShepherdManager>>>,
) -> Result<String, String> {
    let manager = shepherd.lock().await;
    if manager.is_running() {
        Ok("idle".to_string())
    } else {
        Ok("disabled".to_string())
    }
}

#[tauri::command]
pub async fn notify_shepherd_event(
    collector: State<'_, Arc<Mutex<ShepherdEventCollector>>>,
    notify: State<'_, Arc<tokio::sync::Notify>>,
    event_type: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    let Some(event) = map_event(&event_type, &payload) else {
        return Ok(());
    };

    {
        let mut collector = collector
            .lock()
            .map_err(|e| format!("shepherd collector lock error: {}", e))?;
        collector.push(event);
    }

    notify.notify_one();
    Ok(())
}

fn map_event(event_type: &str, payload: &serde_json::Value) -> Option<ShepherdEvent> {
    match event_type {
        "ci-status-changed" => map_ci_status_changed(payload),
        "action-complete" => {
            let task_id = payload.get("task_id")?.as_str()?;
            if is_shepherd_task_id(task_id) {
                None
            } else {
                map_agent_completed(payload)
            }
        }
        "review-status-changed" => map_review_status_changed(payload),
        "new-pr-comment" => map_new_pr_comment(payload),
        "task-created" => map_task_created(payload),
        "task-moved" => map_task_moved(payload),
        "task-deleted" => map_task_deleted(payload),
        "agent-started" => map_agent_started(payload),
        "agent-errored" => map_agent_errored(payload),
        "agent-checkpoint" => map_agent_checkpoint(payload),
        _ => None,
    }
}

fn is_shepherd_task_id(task_id: &str) -> bool {
    task_id.starts_with("shepherd-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_event_ci_status_changed() {
        let payload = serde_json::json!({
            "task_id": "T-1",
            "pr_id": 99,
            "ci_status": "failure"
        });

        let event = map_event("ci-status-changed", &payload).expect("event should map");
        match event {
            ShepherdEvent::CiStatusChanged {
                task_id,
                pr_id,
                status,
            } => {
                assert_eq!(task_id, "T-1");
                assert_eq!(pr_id, 99);
                assert_eq!(status, "failure");
            }
            _ => panic!("expected ci status changed event"),
        }
    }

    #[test]
    fn test_map_event_unknown_type_returns_none() {
        let payload = serde_json::json!({"task_id": "T-1"});
        assert!(map_event("unknown-event", &payload).is_none());
    }

    #[test]
    fn test_map_event_invalid_payload_returns_none() {
        let payload = serde_json::json!({"task_id": "T-1"});
        assert!(map_event("ci-status-changed", &payload).is_none());
    }

    #[test]
    fn test_map_event_action_complete() {
        let payload = serde_json::json!({"task_id": "T-106"});
        let event = map_event("action-complete", &payload).expect("event should map");
        match event {
            ShepherdEvent::AgentCompleted { task_id } => {
                assert_eq!(task_id, "T-106");
            }
            _ => panic!("expected AgentCompleted event"),
        }
    }

    #[test]
    fn test_map_event_action_complete_ignores_shepherd_task() {
        let payload = serde_json::json!({"task_id": "shepherd-P-1"});
        assert!(map_event("action-complete", &payload).is_none());
    }

    #[test]
    fn test_map_event_task_created() {
        let payload = serde_json::json!({"task_id": "T-100"});
        let event = map_event("task-created", &payload).expect("event should map");
        match event {
            ShepherdEvent::TaskCreated { task_id } => {
                assert_eq!(task_id, "T-100");
            }
            _ => panic!("expected TaskCreated event"),
        }
    }

    #[test]
    fn test_map_event_task_moved() {
        let payload = serde_json::json!({"task_id": "T-101"});
        let event = map_event("task-moved", &payload).expect("event should map");
        match event {
            ShepherdEvent::TaskMoved { task_id } => {
                assert_eq!(task_id, "T-101");
            }
            _ => panic!("expected TaskMoved event"),
        }
    }

    #[test]
    fn test_map_event_task_deleted() {
        let payload = serde_json::json!({"task_id": "T-102"});
        let event = map_event("task-deleted", &payload).expect("event should map");
        match event {
            ShepherdEvent::TaskDeleted { task_id } => {
                assert_eq!(task_id, "T-102");
            }
            _ => panic!("expected TaskDeleted event"),
        }
    }

    #[test]
    fn test_map_event_agent_started() {
        let payload = serde_json::json!({"task_id": "T-103"});
        let event = map_event("agent-started", &payload).expect("event should map");
        match event {
            ShepherdEvent::AgentStarted { task_id } => {
                assert_eq!(task_id, "T-103");
            }
            _ => panic!("expected AgentStarted event"),
        }
    }

    #[test]
    fn test_map_event_agent_errored() {
        let payload = serde_json::json!({"task_id": "T-104"});
        let event = map_event("agent-errored", &payload).expect("event should map");
        match event {
            ShepherdEvent::AgentErrored { task_id } => {
                assert_eq!(task_id, "T-104");
            }
            _ => panic!("expected AgentErrored event"),
        }
    }

    #[test]
    fn test_map_event_agent_checkpoint() {
        let payload = serde_json::json!({"task_id": "T-105"});
        let event = map_event("agent-checkpoint", &payload).expect("event should map");
        match event {
            ShepherdEvent::AgentCheckpoint { task_id } => {
                assert_eq!(task_id, "T-105");
            }
            _ => panic!("expected AgentCheckpoint event"),
        }
    }
}
