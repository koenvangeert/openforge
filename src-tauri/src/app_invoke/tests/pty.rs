use super::*;

#[tokio::test]
async fn handles_commands_that_do_not_require_spawn() {
    let (state, path) = test_state("app_invoke_pty_commands");

    assert!(
        invoke_ok(&state, "get_pty_buffer", json!({ "taskId": "T-404" }))
            .await
            .is_null()
    );
    assert!(invoke_ok(
        &state,
        "pty_kill_shells_for_task",
        json!({ "taskId": "T-404" }),
    )
    .await
    .is_null());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn spawns_without_backend_app_emitter() {
    let (state, path) = test_state("app_invoke_pty_spawn_without_app");

    let instance_id = invoke_ok(
        &state,
        "pty_spawn_shell",
        json!({ "taskId": "T-1", "cwd": "/tmp", "cols": 80, "rows": 24, "terminalIndex": 1 }),
    )
    .await;
    assert!(instance_id.as_u64().expect("instance id") > 0);

    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();
    state
        .pty_manager
        .as_ref()
        .expect("pty manager")
        .write_pty("T-1-shell-1", b"printf sidecar-pty-ready\\n\n")
        .await
        .expect("write shell command");
    let _ = state
        .pty_manager
        .as_ref()
        .expect("pty manager")
        .kill_shells_for_task("T-1")
        .await;
    let mut saw_output = false;
    let mut saw_exit = false;
    for _ in 0..8 {
        let Ok(event) =
            tokio::time::timeout(std::time::Duration::from_secs(2), events.recv()).await
        else {
            break;
        };
        let event = event.expect("event should be available");
        saw_output |= event.event_name == "pty-output-T-1-shell-1";
        saw_exit |= event.event_name == "pty-exit-T-1-shell-1";
        if saw_output && saw_exit {
            break;
        }
    }
    assert!(saw_output, "sidecar should publish PTY output events");
    if !saw_exit {
        let _ = state
            .pty_manager
            .as_ref()
            .expect("pty manager")
            .kill_shells_for_task("T-1")
            .await;
    }
    assert!(saw_exit, "sidecar should publish PTY exit events");
    let _ = std::fs::remove_file(path);
}
