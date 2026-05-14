use super::*;

#[tokio::test]
async fn test_get_projects_handler_returns_all_projects() {
    let (state, path) = test_state("http_get_projects_handler_returns_projects");
    {
        let db = state.db.lock().expect("lock db");
        db.create_project("Project A", "/tmp/project-a")
            .expect("create project a");
        db.create_project("Project B", "/tmp/project-b")
            .expect("create project b");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/projects")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    let projects = json.as_array().expect("array response");
    assert_eq!(projects.len(), 2);
    assert!(projects.iter().any(|project| {
        project["id"] == "P-1"
            && project["name"] == "Project A"
            && project["path"] == "/tmp/project-a"
    }));
    assert!(projects.iter().any(|project| {
        project["id"] == "P-2"
            && project["name"] == "Project B"
            && project["path"] == "/tmp/project-b"
    }));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_tasks_handler_returns_tasks_for_project() {
    let (state, path) = test_state("http_get_tasks_handler_returns_tasks");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.create_task("Task A", "backlog", Some(&project.id), None, None)
            .expect("create task a");
        db.create_task("Task B", "doing", Some(&project.id), None, None)
            .expect("create task b");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/tasks?project_id=P-1")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    let tasks = json.as_array().expect("array response");
    assert_eq!(tasks.len(), 2);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_create_task_handler_persists_dependency_ids() {
    let (state, path) = test_state("http_create_task_handler_dependencies");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("Prerequisite", "done", Some(&project.id), None, None)
            .expect("create prerequisite");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/create_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"initial_prompt":"Dependent","project_id":"P-1","depends_on":["T-1"]}"#,
                ))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-2")
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.depends_on, vec!["T-1".to_string()]);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_create_task_handler_persists_labels() {
    let (state, path) = test_state("http_create_task_handler_labels");
    {
        let db = state.db.lock().expect("lock db");
        db.create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/create_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"initial_prompt":"Labelled task","project_id":"P-1","labels":["bug","ui"]}"#,
                ))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-1")
        .expect("get task")
        .expect("task exists");
    let label_names: Vec<_> = task
        .labels
        .iter()
        .map(|label| label.name.as_str())
        .collect();
    assert_eq!(label_names, vec!["bug", "ui"]);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_task_label_handlers_list_add_and_remove_labels() {
    let (state, path) = test_state("http_task_label_handlers");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("Task", "backlog", Some(&project.id), None, None)
            .expect("create task");
    }

    let router = create_router(state.clone());
    let add_response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/add_task_label")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-1","label":"bug"}"#))
                .expect("build add request"),
        )
        .await
        .expect("add request should succeed");

    assert_eq!(add_response.status(), StatusCode::OK);
    let add_json = response_body_json(add_response).await;
    assert_eq!(add_json["task_id"], "T-1");
    assert_eq!(add_json["status"], "updated");
    assert_eq!(add_json["label"]["name"], "bug");
    let label_id = add_json["label"]["id"].as_i64().expect("label id");

    let list_response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/task/T-1/labels")
                .method("GET")
                .body(Body::empty())
                .expect("build list request"),
        )
        .await
        .expect("list request should succeed");

    assert_eq!(list_response.status(), StatusCode::OK);
    let list_json = response_body_json(list_response).await;
    assert_eq!(list_json["task_id"], "T-1");
    assert_eq!(list_json["labels"][0]["name"], "bug");

    let remove_response = router
        .oneshot(
            Request::builder()
                .uri("/remove_task_label")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"T-1","label_id":{label_id}}}"#
                )))
                .expect("build remove request"),
        )
        .await
        .expect("remove request should succeed");

    assert_eq!(remove_response.status(), StatusCode::OK);
    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-1")
        .expect("get task")
        .expect("task exists");
    assert!(task.labels.is_empty());

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_set_task_dependencies_handler_replaces_dependencies() {
    let (state, path) = test_state("http_set_task_dependencies_handler");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("First", "done", Some(&project.id), None, None)
            .expect("create first");
        db.create_task("Second", "done", Some(&project.id), None, None)
            .expect("create second");
        let dependent = db
            .create_task("Dependent", "backlog", Some(&project.id), None, None)
            .expect("create dependent");
        db.add_task_dependency(&dependent.id, "T-1")
            .expect("seed dependency");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/set_task_dependencies")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-3","depends_on":["T-2"]}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["task_id"], "T-3");
    assert_eq!(json["status"], "updated");

    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-3")
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.depends_on, vec!["T-2".to_string()]);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_add_task_dependency_handler_appends_dependency() {
    let (state, path) = test_state("http_add_task_dependency_handler");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("First", "done", Some(&project.id), None, None)
            .expect("create first");
        db.create_task("Dependent", "backlog", Some(&project.id), None, None)
            .expect("create dependent");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/add_task_dependency")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"task_id":"T-2","depends_on":"T-1"}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-2")
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.depends_on, vec!["T-1".to_string()]);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_link_task_chain_handler_links_atomically() {
    let (state, path) = test_state("http_link_task_chain_handler");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.set_config("task_id_prefix", "T")
            .expect("set task prefix");
        db.create_task("First", "done", Some(&project.id), None, None)
            .expect("create first");
        db.create_task("Second", "backlog", Some(&project.id), None, None)
            .expect("create second");
        db.create_task("Third", "backlog", Some(&project.id), None, None)
            .expect("create third");
    }

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/link_task_chain")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"chain":["T-1","T-2","T-3"]}"#))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["links"][0]["task_id"], "T-2");
    assert_eq!(json["links"][0]["depends_on"], "T-1");
    assert_eq!(json["links"][1]["task_id"], "T-3");
    assert_eq!(json["links"][1]["depends_on"], "T-2");

    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task("T-3")
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.depends_on, vec!["T-2".to_string()]);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_tasks_handler_filters_by_state() {
    let (state, path) = test_state("http_get_tasks_handler_filters_by_state");
    {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.create_task("Task backlog", "backlog", Some(&project.id), None, None)
            .expect("create backlog task");
        db.create_task("Task doing", "doing", Some(&project.id), None, None)
            .expect("create doing task");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/tasks?project_id=P-1&state=doing")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    let tasks = json.as_array().expect("array response");
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["status"], "doing");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_tasks_handler_rejects_invalid_state() {
    let (state, path) = test_state("http_get_tasks_handler_rejects_invalid_state");
    {
        let db = state.db.lock().expect("lock db");
        let _ = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/tasks?project_id=P-1&state=blocked")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_update_task_handler_updates_summary_without_changing_initial_prompt() {
    let (state, path) = test_state("http_update_task_summary_only");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        db.create_task("Original prompt", "backlog", Some(&project.id), None, None)
            .expect("create task")
            .id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/update_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"{}","summary":"New Summary"}}"#,
                    task_id
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["task_id"], task_id);
    assert_eq!(json["status"], "updated");

    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task(&task_id)
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.initial_prompt, "Original prompt");
    assert_eq!(task.summary, Some("New Summary".to_string()));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_update_task_handler_rejects_initial_prompt_and_preserves_task() {
    let (state, path) = test_state("http_update_task_rejects_initial_prompt");
    let task_id = {
        let db = state.db.lock().expect("lock db");
        let project = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
        let task = db
            .create_task("Original prompt", "backlog", Some(&project.id), None, None)
            .expect("create task");
        db.update_task_summary(&task.id, "Existing Summary")
            .expect("seed summary");
        task.id
    };

    let router = create_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/update_task")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"task_id":"{}","initial_prompt":"New prompt","summary":"New Summary"}}"#,
                    task_id
                )))
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let task = state
        .db
        .lock()
        .expect("lock db")
        .get_task(&task_id)
        .expect("get task")
        .expect("task exists");
    assert_eq!(task.initial_prompt, "Original prompt");
    assert_eq!(task.summary, Some("Existing Summary".to_string()));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_project_attention_handler_returns_zeroed_row_when_no_attention() {
    let (state, path) = test_state("http_get_project_attention_handler_zeroed_row");
    {
        let db = state.db.lock().expect("lock db");
        let _ = db
            .create_project("Project", "/tmp/project")
            .expect("create project");
    }

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/project/P-1/attention")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_body_json(response).await;
    assert_eq!(json["project_id"], "P-1");
    assert_eq!(json["needs_input"], 0);
    assert_eq!(json["running_agents"], 0);
    assert_eq!(json["ci_failures"], 0);
    assert_eq!(json["unaddressed_comments"], 0);
    assert_eq!(json["completed_agents"], 0);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_get_project_attention_handler_returns_not_found_for_unknown_project() {
    let (state, path) = test_state("http_get_project_attention_handler_not_found");

    let router = create_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/project/P-999/attention")
                .method("GET")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let _ = std::fs::remove_file(path);
}
