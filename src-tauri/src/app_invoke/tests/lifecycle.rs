use super::*;
use crate::app_invoke::{start_opencode_sse_bridge_for_app, ExistingSseBridge};

#[tokio::test]
async fn resume_startup_sessions_publishes_completion_event() {
    let (state, path) = test_state("app_invoke_resume_startup_sessions");
    let mut receiver = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    invoke_ok(&state, "resume_startup_sessions", json!({})).await;

    let received = receiver.recv().await.expect("startup completion event");
    assert_eq!(received.event_name, "startup-resume-complete");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn handles_agent_lifecycle_followups() {
    let (state, path) = test_state("app_invoke_agent_lifecycle_followups");
    let (pi_task_id, claude_task_id) = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project("Lifecycle Project", "/tmp/openforge-lifecycle")
            .expect("create project");
        let pi_task = db
            .create_task("pi task", "doing", Some(&project.id), None, None, None)
            .expect("create pi task");
        let claude_task = db
            .create_task("claude task", "doing", Some(&project.id), None, None, None)
            .expect("create claude task");
        db.create_agent_session(
            "session-pi",
            &pi_task.id,
            None,
            "implementing",
            "running",
            "pi",
        )
        .expect("create pi session");
        db.create_agent_session(
            "session-claude",
            &claude_task.id,
            None,
            "implementing",
            "running",
            "claude-code",
        )
        .expect("create claude session");
        (pi_task.id, claude_task.id)
    };

    let status = invoke_ok(
        &state,
        "get_session_status",
        json!({ "sessionId": "session-pi" }),
    )
    .await;
    assert_eq!(status["id"], "session-pi");
    invoke_ok(
        &state,
        "finalize_claude_session",
        json!({ "taskId": claude_task_id, "success": false }),
    )
    .await;
    invoke_ok(
        &state,
        "abort_implementation",
        json!({ "taskId": pi_task_id }),
    )
    .await;

    let db = crate::db::acquire_db(&state.db);
    assert_eq!(
        db.get_agent_session("session-claude")
            .expect("get claude")
            .expect("claude exists")
            .status,
        "interrupted"
    );
    assert_eq!(
        db.get_agent_session("session-pi")
            .expect("get pi")
            .expect("pi exists")
            .status,
        "interrupted"
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn start_implementation_reports_missing_task() {
    let (state, path) = test_state("app_invoke_start_implementation");

    let err = invoke(
        &state,
        "start_implementation",
        json!({ "taskId": "missing-task", "repoPath": "/tmp" }),
    )
    .await
    .expect_err("missing task should be rejected");

    assert_eq!(err.0, StatusCode::NOT_FOUND);
    assert!(err.1.contains("Task not found"));

    let _ = std::fs::remove_file(path);
}

// OpenCode SSE bridge lifecycle coverage lives with app-invoke lifecycle behavior.

#[tokio::test]
async fn test_start_opencode_sse_bridge_for_app_publishes_sidecar_events() {
    let (state, path) = test_state("app_opencode_bridge_sidecar_events");
    let task_id = {
        let db = state.db.lock().expect("db lock");
        let task = db
            .create_task("OpenCode sidecar bridge", "doing", None, None, None, None)
            .expect("create task");
        db.create_agent_session(
            "agent-session-1",
            &task.id,
            Some("oc-session-1"),
            "implementing",
            "running",
            "opencode",
        )
        .expect("create session");
        task.id
    };
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test OpenCode SSE server");
    let port = listener.local_addr().expect("local addr").port();
    let router = axum::Router::new().route(
        "/event",
        axum::routing::get(|| async {
            let payload = serde_json::json!({
                "type": "permission.asked",
                "properties": {
                    "sessionID": "oc-session-1",
                    "description": "Allow file write?"
                }
            })
            .to_string();
            axum::response::sse::Sse::new(futures::stream::iter([
                Ok::<_, std::convert::Infallible>(
                    axum::response::sse::Event::default()
                        .event("message")
                        .data(payload),
                ),
            ]))
        }),
    );
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    start_opencode_sse_bridge_for_app(
        &state,
        &task_id,
        Some("oc-session-1".to_string()),
        port,
        ExistingSseBridge::Error,
    )
    .await
    .expect("start bridge through app state");

    let event = tokio::time::timeout(std::time::Duration::from_secs(3), events.recv())
        .await
        .expect("app event timeout")
        .expect("app event");

    assert_eq!(event.event_name, "agent-event");
    assert_eq!(event.payload["task_id"], task_id);
    assert_eq!(event.payload["event_type"], "permission.asked");

    let session = state
        .db
        .lock()
        .expect("db lock")
        .get_agent_session("agent-session-1")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "paused");
    assert_eq!(
        session.checkpoint_data.as_deref().unwrap_or(""),
        event.payload["data"].as_str().unwrap_or("")
    );

    state
        .sse_bridge_manager
        .as_ref()
        .expect("bridge manager")
        .stop_bridge(&task_id)
        .await;
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_start_opencode_sse_bridge_for_app_is_idempotent_when_bridge_already_running() {
    let (state, path) = test_state("app_opencode_bridge_already_running");
    let task_id = {
        let db = state.db.lock().expect("db lock");
        let task = db
            .create_task(
                "OpenCode sidecar bridge idempotent",
                "doing",
                None,
                None,
                None,
                None,
            )
            .expect("create task");
        db.create_agent_session(
            "agent-session-1",
            &task.id,
            Some("oc-session-1"),
            "implementing",
            "running",
            "opencode",
        )
        .expect("create session");
        task.id
    };

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test OpenCode SSE server");
    let port = listener.local_addr().expect("local addr").port();
    let router = axum::Router::new().route(
        "/event",
        axum::routing::get(|| async {
            axum::response::sse::Sse::new(futures::stream::pending::<
                Result<axum::response::sse::Event, std::convert::Infallible>,
            >())
        }),
    );
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    start_opencode_sse_bridge_for_app(
        &state,
        &task_id,
        Some("oc-session-1".to_string()),
        port,
        ExistingSseBridge::Error,
    )
    .await
    .expect("first bridge start should succeed");

    let duplicate_start = start_opencode_sse_bridge_for_app(
        &state,
        &task_id,
        Some("oc-session-2".to_string()),
        port,
        ExistingSseBridge::Error,
    )
    .await;
    assert!(
        duplicate_start.is_err(),
        "non-resume bridge starts should still reject an already-running bridge"
    );

    let resume_start = start_opencode_sse_bridge_for_app(
        &state,
        &task_id,
        Some("oc-session-1".to_string()),
        port,
        ExistingSseBridge::TreatAsResumed,
    )
    .await;

    assert!(
        resume_start.is_ok(),
        "already-running bridge should be treated as a successful idempotent resume, got {resume_start:?}"
    );

    state
        .sse_bridge_manager
        .as_ref()
        .expect("bridge manager")
        .stop_bridge(&task_id)
        .await;
    let _ = std::fs::remove_file(path);
}
