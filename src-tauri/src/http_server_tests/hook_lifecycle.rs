use super::*;

#[tokio::test]
async fn test_pi_agent_status_changes_publish_to_app_event_stream() {
    let (state, path) = test_state("pi_agent_status_publishes_app_event");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();
    let task_id = {
        let db = state.db.lock().expect("db lock");
        let task = db
            .create_task("Pi task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session("ses-pi", &task.id, None, "implement", "completed", "pi")
            .expect("create session");
        db.update_agent_session(
            "ses-pi",
            "implement",
            "completed",
            Some(r#"{"pty_instance_id":7}"#),
            None,
        )
        .expect("set checkpoint");
        task.id
    };

    let response = pi_agent_start_handler(
        State(state),
        Json(PiAgentLifecyclePayload {
            task_id: task_id.clone(),
            pty_instance_id: 7,
        }),
    )
    .await
    .expect("handler response");

    assert_eq!(response.0["status"], "ok");
    let event = events.recv().await.expect("app event");
    assert_eq!(event.event_name, "agent-status-changed");
    assert_eq!(event.payload["task_id"], task_id);
    assert_eq!(event.payload["status"], "running");
    assert_eq!(event.payload["provider"], "pi");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_pi_agent_end_hook_marks_running_pi_session_completed() {
    let (state, path) = test_state("http_pi_agent_end_completed");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Task A", "doing", Some(&project.id), None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-pi-running",
            &task.id,
            None,
            "implementing",
            "running",
            "pi",
        )
        .expect("create pi session");
        db.update_agent_session(
            "ses-pi-running",
            "implementing",
            "running",
            Some(r#"{"pty_instance_id":42}"#),
            None,
        )
        .expect("store pty instance");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/hooks/pi-agent-end")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"{}","pty_instance_id":42}}"#,
                    task_id
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-pi-running")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "completed");
    assert_eq!(
        session.checkpoint_data,
        Some(r#"{"pty_instance_id":42}"#.to_string())
    );
    assert!(session.error_message.is_none());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_pi_agent_start_hook_marks_completed_pi_session_running() {
    let (state, path) = test_state("http_pi_agent_start_running");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Task A", "doing", Some(&project.id), None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-pi-completed",
            &task.id,
            None,
            "implementing",
            "completed",
            "pi",
        )
        .expect("create pi session");
        db.update_agent_session(
            "ses-pi-completed",
            "implementing",
            "completed",
            Some(r#"{"pty_instance_id":42}"#),
            None,
        )
        .expect("store pty instance");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/hooks/pi-agent-start")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"{}","pty_instance_id":42}}"#,
                    task_id
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-pi-completed")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "running");
    assert_eq!(
        session.checkpoint_data,
        Some(r#"{"pty_instance_id":42}"#.to_string())
    );
    assert!(session.error_message.is_none());

    let _ = std::fs::remove_file(path);
}

#[test]
fn test_pi_status_update_emits_when_matching_session_already_has_target_status() {
    let (state, path) = test_state("http_pi_agent_start_idempotent_running");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Task A", "doing", Some(&project.id), None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-pi-running",
            &task.id,
            None,
            "implementing",
            "running",
            "pi",
        )
        .expect("create pi session");
        db.update_agent_session(
            "ses-pi-running",
            "implementing",
            "running",
            Some(r#"{"pty_instance_id":42}"#),
            None,
        )
        .expect("store pty instance");
        task.id
    };

    let status_update = update_pi_session_status_for_pty(
        &state,
        &task_id,
        42,
        "running",
        &["completed", "paused", "interrupted", "running"],
    );

    assert_eq!(status_update, Some("running".to_string()));
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-pi-running")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "running");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_pi_agent_start_hook_ignores_stale_pty_instance() {
    let (state, path) = test_state("http_pi_agent_start_stale_instance");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Task A", "doing", Some(&project.id), None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-pi-completed",
            &task.id,
            None,
            "implementing",
            "completed",
            "pi",
        )
        .expect("create pi session");
        db.update_agent_session(
            "ses-pi-completed",
            "implementing",
            "completed",
            Some(r#"{"pty_instance_id":99}"#),
            None,
        )
        .expect("store pty instance");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/hooks/pi-agent-start")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"{}","pty_instance_id":42}}"#,
                    task_id
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-pi-completed")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "completed");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_pi_agent_end_hook_ignores_stale_pty_instance() {
    let (state, path) = test_state("http_pi_agent_end_stale_instance");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Task A", "doing", Some(&project.id), None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-pi-running",
            &task.id,
            None,
            "implementing",
            "running",
            "pi",
        )
        .expect("create pi session");
        db.update_agent_session(
            "ses-pi-running",
            "implementing",
            "running",
            Some(r#"{"pty_instance_id":99}"#),
            None,
        )
        .expect("store pty instance");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/hooks/pi-agent-end")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"{}","pty_instance_id":42}}"#,
                    task_id
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-pi-running")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "running");

    let _ = std::fs::remove_file(path);
}

#[test]
fn test_pre_tool_use_transitions_from_non_running_to_running() {
    assert_eq!(
        map_hook_to_status("pre-tool-use", "paused"),
        Some("running".to_string())
    );
    assert_eq!(
        map_hook_to_status("pre-tool-use", "completed"),
        Some("running".to_string())
    );
    assert_eq!(
        map_hook_to_status("pre-tool-use", "failed"),
        Some("running".to_string())
    );
    assert_eq!(
        map_hook_to_status("pre-tool-use", "interrupted"),
        Some("running".to_string())
    );
}

#[test]
fn test_pre_tool_use_no_op_when_already_running() {
    assert_eq!(map_hook_to_status("pre-tool-use", "running"), None);
}

#[test]
fn test_post_tool_use_transitions_from_non_running_to_running() {
    assert_eq!(
        map_hook_to_status("post-tool-use", "paused"),
        Some("running".to_string())
    );
    assert_eq!(
        map_hook_to_status("post-tool-use", "completed"),
        Some("running".to_string())
    );
}

#[test]
fn test_post_tool_use_no_op_when_already_running() {
    assert_eq!(map_hook_to_status("post-tool-use", "running"), None);
}

#[test]
fn test_stop_always_maps_to_completed() {
    assert_eq!(
        map_hook_to_status("stop", "running"),
        Some("completed".to_string())
    );
    assert_eq!(
        map_hook_to_status("stop", "paused"),
        Some("completed".to_string())
    );
    assert_eq!(
        map_hook_to_status("stop", "completed"),
        Some("completed".to_string())
    );
}

#[test]
fn test_session_end_always_maps_to_completed() {
    assert_eq!(
        map_hook_to_status("session-end", "running"),
        Some("completed".to_string())
    );
    assert_eq!(
        map_hook_to_status("session-end", "paused"),
        Some("completed".to_string())
    );
}

#[test]
fn test_notification_produces_no_status_change() {
    assert_eq!(map_hook_to_status("notification", "running"), None);
    assert_eq!(map_hook_to_status("notification", "paused"), None);
}

#[test]
fn test_notification_permission_maps_running_to_paused() {
    assert_eq!(
        map_hook_to_status("notification-permission", "running"),
        Some("paused".to_string())
    );
}

#[test]
fn test_notification_permission_no_op_when_not_running() {
    assert_eq!(
        map_hook_to_status("notification-permission", "paused"),
        None
    );
    assert_eq!(
        map_hook_to_status("notification-permission", "completed"),
        None
    );
    assert_eq!(
        map_hook_to_status("notification-permission", "interrupted"),
        None
    );
}

#[test]
fn test_unknown_event_type_produces_no_status_change() {
    assert_eq!(map_hook_to_status("unknown-event", "running"), None);
    assert_eq!(map_hook_to_status("", "running"), None);
}

#[test]
fn test_claude_hook_payload_deserialize_with_claude_task_id() {
    let json = r#"{"session_id": "sess-123", "tool_name": "bash", "CLAUDE_TASK_ID": "task-456"}"#;
    let payload: ClaudeHookPayload = serde_json::from_str(json).expect("Failed to deserialize");
    assert_eq!(payload.session_id, Some("sess-123".to_string()));
    assert_eq!(payload.tool_name, Some("bash".to_string()));
    assert_eq!(payload.claude_task_id, Some("task-456".to_string()));
    assert!(payload.tool_input.is_none());
    assert!(payload.transcript_path.is_none());
}

#[test]
fn test_claude_hook_payload_deserialize_with_claude_task_id_lowercase() {
    let json = r#"{"session_id": "sess-789", "claude_task_id": "task-999"}"#;
    let payload: ClaudeHookPayload = serde_json::from_str(json).expect("Failed to deserialize");
    assert_eq!(payload.session_id, Some("sess-789".to_string()));
    assert_eq!(payload.claude_task_id, Some("task-999".to_string()));
}

#[test]
fn test_claude_hook_payload_deserialize_all_fields() {
    let json = r#"{
            "session_id": "sess-123",
            "tool_name": "bash",
            "tool_input": {"cmd": "ls -la"},
            "transcript_path": "/path/to/transcript",
            "CLAUDE_TASK_ID": "task-456"
        }"#;
    let payload: ClaudeHookPayload = serde_json::from_str(json).expect("Failed to deserialize");
    assert_eq!(payload.session_id, Some("sess-123".to_string()));
    assert_eq!(payload.tool_name, Some("bash".to_string()));
    assert!(payload.tool_input.is_some());
    assert_eq!(
        payload.transcript_path,
        Some("/path/to/transcript".to_string())
    );
    assert_eq!(payload.claude_task_id, Some("task-456".to_string()));
}

#[test]
fn test_claude_hook_payload_deserialize_missing_task_id() {
    let json = r#"{"session_id": "sess-123", "tool_name": "bash"}"#;
    let payload: ClaudeHookPayload = serde_json::from_str(json).expect("Failed to deserialize");
    assert_eq!(payload.session_id, Some("sess-123".to_string()));
    assert!(payload.claude_task_id.is_none());
}

#[test]
fn test_claude_hook_payload_deserialize_empty_object() {
    let json = r#"{}"#;
    let payload: ClaudeHookPayload = serde_json::from_str(json).expect("Failed to deserialize");
    assert!(payload.session_id.is_none());
    assert!(payload.tool_name.is_none());
    assert!(payload.tool_input.is_none());
    assert!(payload.transcript_path.is_none());
    assert!(payload.claude_task_id.is_none());
}

#[test]
fn test_claude_hook_payload_deserialize_malformed_json() {
    let json = r#"{"session_id": "sess-123", invalid json}"#;
    let result: Result<ClaudeHookPayload, _> = serde_json::from_str(json);
    assert!(result.is_err(), "Should fail with malformed JSON");
}

#[test]
fn test_claude_hook_payload_creation() {
    let payload = ClaudeHookPayload {
        session_id: Some("sess-123".to_string()),
        tool_name: Some("bash".to_string()),
        tool_input: Some(serde_json::json!({"cmd": "ls"})),
        transcript_path: Some("/path".to_string()),
        claude_task_id: Some("task-456".to_string()),
    };
    assert_eq!(payload.session_id, Some("sess-123".to_string()));
    assert_eq!(payload.claude_task_id, Some("task-456".to_string()));
}

#[test]
fn test_map_hook_to_status_full_lifecycle() {
    let mut status = "started".to_string();

    if let Some(s) = map_hook_to_status("pre-tool-use", &status) {
        status = s;
    }
    assert_eq!(status, "running");

    if let Some(s) = map_hook_to_status("pre-tool-use", &status) {
        status = s;
    }
    assert_eq!(status, "running", "Already running — no change");

    if let Some(s) = map_hook_to_status("post-tool-use", &status) {
        status = s;
    }
    assert_eq!(status, "running", "post-tool-use when running — no change");

    // Permission prompt pauses the session
    if let Some(s) = map_hook_to_status("notification-permission", &status) {
        status = s;
    }
    assert_eq!(
        status, "paused",
        "notification-permission transitions running→paused"
    );

    // Tool use resumes from paused
    if let Some(s) = map_hook_to_status("pre-tool-use", &status) {
        status = s;
    }
    assert_eq!(
        status, "running",
        "Resumed: pre-tool-use transitions paused→running"
    );

    if let Some(s) = map_hook_to_status("stop", &status) {
        status = s;
    }
    assert_eq!(status, "completed");

    if let Some(s) = map_hook_to_status("pre-tool-use", &status) {
        status = s;
    }
    assert_eq!(
        status, "running",
        "Resumed: pre-tool-use transitions completed→running"
    );

    if let Some(s) = map_hook_to_status("session-end", &status) {
        status = s;
    }
    assert_eq!(status, "completed");
}

#[test]
fn opencode_status_events_preserve_payload_semantics_without_idle_completion() {
    assert_eq!(
        opencode_status_from_event("session.status", Some("busy")),
        Some((
            "running",
            &["completed", "paused", "interrupted", "running"] as &[_]
        ))
    );
    assert_eq!(
        opencode_status_from_event("session.status", Some("retry")),
        Some((
            "running",
            &["completed", "paused", "interrupted", "running"] as &[_]
        ))
    );
    assert_eq!(
        opencode_status_from_event("session.status", Some("error")),
        Some(("failed", &["running", "paused"] as &[_]))
    );
    assert_eq!(
        opencode_status_from_event("session.status", Some("idle")),
        None
    );
    assert_eq!(opencode_status_from_event("session.idle", None), None);
}

#[tokio::test]
async fn opencode_hook_stores_session_id_and_does_not_complete_on_idle_status() {
    let (state, path) = test_state("opencode_hook_idle_no_complete");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let task = db
            .create_task("OpenCode task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-opencode-running",
            &task.id,
            None,
            "implementing",
            "running",
            "opencode",
        )
        .expect("create opencode session");
        db.update_agent_session(
            "ses-opencode-running",
            "implementing",
            "running",
            Some(r#"{"pty_instance_id":77}"#),
            None,
        )
        .expect("store pty instance");
        task.id
    };

    let _ = opencode_event_handler(
        State(state.clone()),
        Json(OpenCodePluginEventPayload {
            task_id: task_id.clone(),
            pty_instance_id: 77,
            event_type: "session.status".to_string(),
            session_id: Some("oc-session-77".to_string()),
            status_type: Some("idle".to_string()),
        }),
    )
    .await
    .expect("handler response");

    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-opencode-running")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "running");
    assert_eq!(
        session.opencode_session_id,
        Some("oc-session-77".to_string())
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn opencode_hook_marks_error_status_failed() {
    let (state, path) = test_state("opencode_hook_error_failed");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let task = db
            .create_task("OpenCode task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-opencode-error",
            &task.id,
            None,
            "implementing",
            "running",
            "opencode",
        )
        .expect("create opencode session");
        db.update_agent_session(
            "ses-opencode-error",
            "implementing",
            "running",
            Some(r#"{"pty_instance_id":78}"#),
            None,
        )
        .expect("store pty instance");
        task.id
    };

    let _ = opencode_event_handler(
        State(state.clone()),
        Json(OpenCodePluginEventPayload {
            task_id: task_id.clone(),
            pty_instance_id: 78,
            event_type: "session.status".to_string(),
            session_id: None,
            status_type: Some("error".to_string()),
        }),
    )
    .await
    .expect("handler response");

    let session = state
        .db
        .lock()
        .expect("lock db")
        .get_agent_session("ses-opencode-error")
        .expect("get session")
        .expect("session exists");
    assert_eq!(session.status, "failed");

    let _ = std::fs::remove_file(path);
}
