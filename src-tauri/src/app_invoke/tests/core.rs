use super::*;

#[tokio::test]
async fn handles_config_projects_tasks_and_unmatched_commands() {
    let (state, path) = test_state("app_invoke_config_projects_tasks");

    invoke_ok(
        &state,
        "set_config",
        json!({ "key": "theme", "value": "dark" }),
    )
    .await;
    assert_eq!(
        invoke_ok(&state, "get_config", json!({ "key": "theme" })).await,
        "dark"
    );

    let project = invoke_ok(
        &state,
        "create_project",
        json!({ "name": "Open Forge", "path": "/tmp/openforge" }),
    )
    .await;
    assert_eq!(project["name"], "Open Forge");
    let project_id = project["id"].as_str().expect("project id");

    let task = invoke_ok(
        &state,
        "create_task",
        json!({
            "initialPrompt": "Plan migration",
            "status": "backlog",
            "projectId": project_id,
            "permissionMode": null,
        }),
    )
    .await;
    assert_eq!(task["initial_prompt"], "Plan migration");
    assert_eq!(task["agent"], serde_json::Value::Null);
    let task_id = task["id"].as_str().expect("task id");

    let tasks = invoke_ok(&state, "get_tasks", serde_json::Value::Null).await;
    assert_eq!(tasks.as_array().expect("tasks").len(), 1);

    let attention = invoke_ok(&state, "get_project_attention", serde_json::Value::Null).await;
    assert_eq!(attention.as_array().expect("attention rows").len(), 0);
    assert_eq!(
        invoke_ok(&state, "get_app_mode", serde_json::Value::Null).await,
        "dev"
    );
    invoke_ok(&state, "get_git_branch", serde_json::Value::Null).await;
    assert!(
        invoke_ok(&state, "get_latest_session", json!({ "taskId": task_id }))
            .await
            .is_null()
    );
    assert_eq!(
        invoke_ok(
            &state,
            "get_latest_sessions",
            json!({ "taskIds": [task_id] })
        )
        .await
        .as_array()
        .expect("latest sessions")
        .len(),
        0
    );

    invoke_ok(
        &state,
        "update_task_status",
        json!({ "id": task_id, "status": "doing" }),
    )
    .await;
    assert_eq!(
        crate::db::acquire_db(&state.db)
            .get_task(task_id)
            .expect("get updated task")
            .expect("updated task exists")
            .status,
        "doing"
    );

    invoke_ok(&state, "delete_task", json!({ "id": task_id })).await;
    assert!(crate::db::acquire_db(&state.db)
        .get_task(task_id)
        .expect("get deleted task")
        .is_none());

    let done_task = {
        let db = crate::db::acquire_db(&state.db);
        db.create_task("Done task", "done", Some(project_id), None, None)
            .expect("create done task")
    };
    assert_eq!(
        invoke_ok(
            &state,
            "clear_done_tasks",
            json!({ "projectId": project_id })
        )
        .await,
        1
    );
    assert!(crate::db::acquire_db(&state.db)
        .get_task(&done_task.id)
        .expect("get cleared task")
        .is_none());

    invoke_ok(&state, "delete_project", json!({ "id": project_id })).await;

    let unsupported = invoke(
        &state,
        "unsupported_desktop_command",
        serde_json::Value::Null,
    )
    .await
    .expect_err("unsupported command should be rejected");
    assert_eq!(unsupported.0, StatusCode::NOT_IMPLEMENTED);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn create_task_ignores_legacy_agent_payload() {
    let (state, path) = test_state("app_invoke_create_task_ignores_agent");
    let project = invoke_ok(
        &state,
        "create_project",
        json!({ "name": "Open Forge", "path": "/tmp/openforge" }),
    )
    .await;
    let project_id = project["id"].as_str().expect("project id");

    let task = invoke_ok(
        &state,
        "create_task",
        json!({
            "initialPrompt": "No selected agent",
            "status": "backlog",
            "projectId": project_id,
            "agent": "legacy-selected-agent",
            "permissionMode": "default",
        }),
    )
    .await;

    assert_eq!(task["agent"], serde_json::Value::Null);
    assert_eq!(task["permission_mode"], "default");

    let task_id = task["id"].as_str().expect("task id");
    let persisted = crate::db::acquire_db(&state.db)
        .get_task(task_id)
        .expect("get task")
        .expect("task exists");
    assert_eq!(persisted.agent, None);
    assert_eq!(persisted.permission_mode.as_deref(), Some("default"));

    let _ = std::fs::remove_file(path);
}

async fn task_workspace_value(
    task_id: &str,
    state: &crate::http_server::AppState,
) -> serde_json::Value {
    invoke_ok(state, "get_task_workspace", json!({ "taskId": task_id })).await
}

#[tokio::test]
async fn task_workspace_legacy_worktree_fallback_carries_workspace_data_only() {
    let (state, path) = test_state("app_invoke_task_workspace_legacy_fallback");
    let task_id = {
        let db = state.db.lock().expect("db lock");
        let project = db
            .create_project("Open Forge", "/tmp/openforge")
            .expect("create project");
        let task = db
            .create_task(
                "Legacy worktree task",
                "doing",
                Some(&project.id),
                None,
                None,
            )
            .expect("create task");
        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/openforge",
            "/tmp/openforge-worktree",
            "feature/electron",
        )
        .expect("create worktree");
        db.create_agent_session(
            "ses-legacy",
            &task.id,
            None,
            "implement",
            "running",
            "opencode",
        )
        .expect("create session");
        task.id
    };

    let workspace = task_workspace_value(&task_id, &state).await;
    assert_eq!(workspace["task_id"], task_id);
    assert_eq!(workspace["workspace_path"], "/tmp/openforge-worktree");
    assert_eq!(workspace["provider_name"], "opencode");
    assert_eq!(workspace.get("opencode_port"), None);
    assert_eq!(workspace["kind"], "git_worktree");
    assert_eq!(workspace["branch_name"], "feature/electron");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn task_workspace_prefers_task_workspace_over_legacy_worktree() {
    let (state, path) = test_state("app_invoke_task_workspace_prefers_new_model");
    let task_id = {
        let db = state.db.lock().expect("db lock");
        let project = db
            .create_project("Open Forge", "/tmp/openforge")
            .expect("create project");
        let task = db
            .create_task(
                "Task workspace task",
                "doing",
                Some(&project.id),
                None,
                None,
            )
            .expect("create task");
        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/openforge",
            "/tmp/legacy-worktree",
            "feature/legacy",
        )
        .expect("create worktree");
        db.create_task_workspace_record(
            &task.id,
            &project.id,
            "/tmp/task-workspace",
            "/tmp/openforge",
            "repository",
            None,
            "pi",
        )
        .expect("create task workspace");
        task.id
    };

    let workspace = task_workspace_value(&task_id, &state).await;
    assert_eq!(workspace["task_id"], task_id);
    assert_eq!(workspace["workspace_path"], "/tmp/task-workspace");
    assert_eq!(workspace["provider_name"], "pi");
    assert_eq!(workspace["kind"], "repository");
    assert_eq!(workspace["branch_name"], serde_json::Value::Null);

    let _ = std::fs::remove_file(path);
}
