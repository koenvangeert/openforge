use super::*;

#[test]
fn test_create_task_request_ignores_unknown_description_field() {
    let json = r#"{"initial_prompt": "Test", "description": "old field still sent"}"#;
    let req: CreateTaskRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.initial_prompt, "Test");
}

#[test]
fn test_create_task_request_creation() {
    let request = CreateTaskRequest {
        initial_prompt: "Test Task".to_string(),
        project_id: Some("PROJ-1".to_string()),
        worktree: Some("/path/to/wt".to_string()),
        depends_on: vec!["T-1".to_string()],
        labels: vec!["bug".to_string(), "needs review".to_string()],
    };
    assert_eq!(request.initial_prompt, "Test Task");
    assert_eq!(request.project_id, Some("PROJ-1".to_string()));
    assert_eq!(request.depends_on, vec!["T-1".to_string()]);
    assert_eq!(
        request.labels,
        vec!["bug".to_string(), "needs review".to_string()]
    );
}

#[test]
fn test_create_task_request_minimal_fields() {
    let request = CreateTaskRequest {
        initial_prompt: "Minimal Task".to_string(),
        project_id: None,
        worktree: None,
        depends_on: Vec::new(),
        labels: Vec::new(),
    };
    assert_eq!(request.initial_prompt, "Minimal Task");
    assert!(request.project_id.is_none());
    assert!(request.depends_on.is_empty());
    assert!(request.labels.is_empty());
}

#[test]
fn test_create_task_request_deserialize_all_fields() {
    let json = r#"{"initial_prompt": "Implement Feature X", "project_id": "PROJ-42", "worktree": "/path/to/wt", "depends_on": ["T-1", "T-2"], "labels": ["bug", "needs review"]}"#;
    let request: CreateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
    assert_eq!(request.initial_prompt, "Implement Feature X");
    assert_eq!(request.project_id, Some("PROJ-42".to_string()));
    assert_eq!(request.worktree, Some("/path/to/wt".to_string()));
    assert_eq!(
        request.depends_on,
        vec!["T-1".to_string(), "T-2".to_string()]
    );
    assert_eq!(
        request.labels,
        vec!["bug".to_string(), "needs review".to_string()]
    );
}

#[test]
fn test_create_task_request_deserialize_only_required() {
    let json = r#"{"initial_prompt": "Simple Task"}"#;
    let request: CreateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
    assert_eq!(request.initial_prompt, "Simple Task");
    assert!(request.project_id.is_none());
    assert!(request.depends_on.is_empty());
    assert!(request.labels.is_empty());
}

#[test]
fn test_create_task_request_deserialize_labels_only() {
    let json = r#"{"initial_prompt": "Task with labels", "labels": ["bug", "ui"]}"#;
    let request: CreateTaskRequest = serde_json::from_str(json).expect("deserialize labels");
    assert_eq!(request.labels, vec!["bug".to_string(), "ui".to_string()]);
}

#[test]
fn test_create_task_request_deserialize_partial_optional() {
    let json = r#"{"initial_prompt": "Task with project", "project_id": "PROJ-99"}"#;
    let request: CreateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
    assert_eq!(request.initial_prompt, "Task with project");
    assert_eq!(request.project_id, Some("PROJ-99".to_string()));
    assert!(request.worktree.is_none());
    assert!(request.depends_on.is_empty());
    assert!(request.labels.is_empty());
}

#[test]
fn test_create_task_request_deserialize_empty_strings() {
    let json = r#"{"initial_prompt": "", "project_id": "", "worktree": ""}"#;
    let request: CreateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
    assert_eq!(request.initial_prompt, "");
    assert_eq!(request.project_id, Some("".to_string()));
    assert_eq!(request.worktree, Some("".to_string()));
    assert!(request.depends_on.is_empty());
    assert!(request.labels.is_empty());
}

#[test]
fn test_create_task_request_deserialize_missing_initial_prompt_fails() {
    let json = r#"{"project_id": "PROJ-1"}"#;
    let result: Result<CreateTaskRequest, _> = serde_json::from_str(json);
    assert!(
        result.is_err(),
        "Should fail without required initial_prompt field"
    );
}

#[test]
fn test_create_task_request_serialize_roundtrip() {
    let original = CreateTaskRequest {
        initial_prompt: "Roundtrip Test".to_string(),
        project_id: Some("PROJ-99".to_string()),
        worktree: Some("/path/to/worktree".to_string()),
        depends_on: vec!["T-1".to_string()],
        labels: vec!["bug".to_string()],
    };
    let json = serde_json::to_string(&original).expect("Failed to serialize");
    let deserialized: CreateTaskRequest =
        serde_json::from_str(&json).expect("Failed to deserialize");
    assert_eq!(deserialized.initial_prompt, original.initial_prompt);
    assert_eq!(deserialized.project_id, original.project_id);
    assert_eq!(deserialized.worktree, original.worktree);
    assert_eq!(deserialized.depends_on, original.depends_on);
    assert_eq!(deserialized.labels, original.labels);
}

#[test]
fn test_create_task_response_creation() {
    let response = CreateTaskResponse {
        task_id: "T-123".to_string(),
        project_id: Some("P-1".to_string()),
        status: "created".to_string(),
    };
    assert_eq!(response.task_id, "T-123");
    assert_eq!(response.project_id, Some("P-1".to_string()));
    assert_eq!(response.status, "created");
}

#[test]
fn test_create_task_response_serialize() {
    let response = CreateTaskResponse {
        task_id: "T-456".to_string(),
        project_id: None,
        status: "created".to_string(),
    };
    let json = serde_json::to_string(&response).expect("Failed to serialize");
    assert!(json.contains("\"task_id\":\"T-456\""));
    assert!(json.contains("\"status\":\"created\""));
}

#[test]
fn test_create_task_response_json_structure() {
    let response = CreateTaskResponse {
        task_id: "T-789".to_string(),
        project_id: Some("P-2".to_string()),
        status: "created".to_string(),
    };
    let json_value = serde_json::to_value(&response).expect("Failed to convert to JSON value");
    assert_eq!(json_value["task_id"], "T-789");
    assert_eq!(json_value["project_id"], "P-2");
    assert_eq!(json_value["status"], "created");
}

#[test]
fn test_task_label_request_models_serialize_expected_fields() {
    let add_request: AddTaskLabelRequest =
        serde_json::from_str(r#"{"task_id":"T-1","label":"bug"}"#).expect("add request");
    assert_eq!(add_request.task_id, "T-1");
    assert_eq!(add_request.label, "bug");

    let remove_request: RemoveTaskLabelRequest =
        serde_json::from_str(r#"{"task_id":"T-1","label_id":42}"#).expect("remove request");
    assert_eq!(remove_request.task_id, "T-1");
    assert_eq!(remove_request.label_id, 42);

    let label = crate::db::TaskLabelRow {
        id: 42,
        project_id: "P-1".to_string(),
        name: "bug".to_string(),
        color: "error".to_string(),
    };
    let list_response = TaskLabelsResponse {
        task_id: "T-1".to_string(),
        labels: vec![label.clone()],
    };
    let list_json = serde_json::to_value(&list_response).expect("list response");
    assert_eq!(list_json["labels"][0]["name"], "bug");

    let add_response = AddTaskLabelResponse {
        task_id: "T-1".to_string(),
        status: "updated".to_string(),
        label,
    };
    let add_json = serde_json::to_value(&add_response).expect("add response");
    assert_eq!(add_json["label"]["id"], 42);
}

#[test]
fn test_update_task_request_creation_with_forbidden_initial_prompt_marker() {
    let request = UpdateTaskRequest {
        task_id: "T-123".to_string(),
        initial_prompt: Some("Forbidden prompt update".to_string()),
        summary: Some("New Summary".to_string()),
    };
    assert_eq!(request.task_id, "T-123");
    assert_eq!(
        request.initial_prompt,
        Some("Forbidden prompt update".to_string())
    );
    assert_eq!(request.summary, Some("New Summary".to_string()));
}

#[test]
fn test_update_task_request_deserializes_forbidden_initial_prompt_for_rejection() {
    let json = r#"{"task_id": "T-456", "initial_prompt": "Forbidden prompt update", "summary": "Updated Summary"}"#;
    let request: UpdateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
    assert_eq!(request.task_id, "T-456");
    assert_eq!(
        request.initial_prompt,
        Some("Forbidden prompt update".to_string())
    );
    assert_eq!(request.summary, Some("Updated Summary".to_string()));
}

#[test]
fn test_update_task_request_deserializes_forbidden_initial_prompt_without_summary() {
    let json = r#"{"task_id": "T-789", "initial_prompt": "Forbidden prompt update"}"#;
    let request: UpdateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
    assert_eq!(request.task_id, "T-789");
    assert_eq!(
        request.initial_prompt,
        Some("Forbidden prompt update".to_string())
    );
    assert!(request.summary.is_none());
}

#[test]
fn test_update_task_request_deserialize_summary_only() {
    let json = r#"{"task_id": "T-999", "summary": "Only Summary"}"#;
    let request: UpdateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
    assert_eq!(request.task_id, "T-999");
    assert!(request.initial_prompt.is_none());
    assert_eq!(request.summary, Some("Only Summary".to_string()));
}

#[test]
fn test_update_task_request_deserialize_no_update_fields() {
    let json = r#"{"task_id": "T-111"}"#;
    let request: UpdateTaskRequest = serde_json::from_str(json).expect("Failed to deserialize");
    assert_eq!(request.task_id, "T-111");
    assert!(request.initial_prompt.is_none());
    assert!(request.summary.is_none());
}

#[test]
fn test_update_task_request_deserialize_missing_task_id_fails() {
    let json = r#"{"initial_prompt": "Forbidden prompt update"}"#;
    let result: Result<UpdateTaskRequest, _> = serde_json::from_str(json);
    assert!(
        result.is_err(),
        "Should fail without required task_id field"
    );
}

#[test]
fn test_update_task_request_serialize_roundtrip_preserves_forbidden_marker() {
    let original = UpdateTaskRequest {
        task_id: "T-555".to_string(),
        initial_prompt: Some("Forbidden prompt update".to_string()),
        summary: Some("Roundtrip Summary".to_string()),
    };
    let json = serde_json::to_string(&original).expect("Failed to serialize");
    let deserialized: UpdateTaskRequest =
        serde_json::from_str(&json).expect("Failed to deserialize");
    assert_eq!(deserialized.task_id, original.task_id);
    assert_eq!(deserialized.initial_prompt, original.initial_prompt);
    assert_eq!(deserialized.summary, original.summary);
}

#[test]
fn test_update_task_response_creation() {
    let response = UpdateTaskResponse {
        task_id: "T-123".to_string(),
        status: "updated".to_string(),
    };
    assert_eq!(response.task_id, "T-123");
    assert_eq!(response.status, "updated");
}

#[test]
fn test_update_task_response_serialize() {
    let response = UpdateTaskResponse {
        task_id: "T-456".to_string(),
        status: "updated".to_string(),
    };
    let json = serde_json::to_string(&response).expect("Failed to serialize");
    assert!(json.contains("\"task_id\":\"T-456\""));
    assert!(json.contains("\"status\":\"updated\""));
}

#[test]
fn test_update_task_response_json_structure() {
    let response = UpdateTaskResponse {
        task_id: "T-789".to_string(),
        status: "updated".to_string(),
    };
    let json_value = serde_json::to_value(&response).expect("Failed to convert to JSON value");
    assert_eq!(json_value["task_id"], "T-789");
    assert_eq!(json_value["status"], "updated");
}

#[test]
fn test_get_task_info_response_creation_all_fields() {
    let response = GetTaskInfoResponse {
        id: "T-42".to_string(),
        initial_prompt: "My Task".to_string(),
        prompt: Some("Do something cool".to_string()),
        summary: Some("Did the thing".to_string()),
        status: "doing".to_string(),
        depends_on: vec!["T-1".to_string()],
        labels: Vec::new(),
    };
    assert_eq!(response.id, "T-42");
    assert_eq!(response.initial_prompt, "My Task");
    assert_eq!(response.prompt, Some("Do something cool".to_string()));
    assert_eq!(response.summary, Some("Did the thing".to_string()));
    assert_eq!(response.status, "doing");
}

#[test]
fn test_get_task_info_response_creation_nullable_fields_none() {
    let response = GetTaskInfoResponse {
        id: "T-1".to_string(),
        initial_prompt: "Simple Task".to_string(),
        prompt: None,
        summary: None,
        status: "backlog".to_string(),
        depends_on: Vec::new(),
        labels: Vec::new(),
    };
    assert!(response.prompt.is_none());
    assert!(response.summary.is_none());
}

#[test]
fn test_get_task_info_response_serialize_all_fields() {
    let response = GetTaskInfoResponse {
        id: "T-99".to_string(),
        initial_prompt: "Full Task".to_string(),
        prompt: Some("Implement X".to_string()),
        summary: Some("Implemented X".to_string()),
        status: "done".to_string(),
        depends_on: Vec::new(),
        labels: Vec::new(),
    };
    let json = serde_json::to_string(&response).expect("Failed to serialize");
    assert!(json.contains("\"id\":\"T-99\""));
    assert!(json.contains("\"initial_prompt\":\"Full Task\""));
    assert!(json.contains("\"prompt\":\"Implement X\""));
    assert!(json.contains("\"summary\":\"Implemented X\""));
    assert!(json.contains("\"status\":\"done\""));
}

#[test]
fn test_get_task_info_response_only_exposes_expected_fields() {
    let response = GetTaskInfoResponse {
        id: "T-99".to_string(),
        initial_prompt: "Full Task".to_string(),
        prompt: Some("Implement X".to_string()),
        summary: Some("Implemented X".to_string()),
        status: "done".to_string(),
        depends_on: Vec::new(),
        labels: Vec::new(),
    };

    let json_value = serde_json::to_value(&response).expect("Failed to serialize");
    assert!(
        json_value.get("id").is_some()
            && json_value.get("initial_prompt").is_some()
            && json_value.get("prompt").is_some()
            && json_value.get("summary").is_some()
            && json_value.get("status").is_some()
            && json_value.get("depends_on").is_some()
            && json_value.get("labels").is_some()
            && json_value
                .as_object()
                .map(|obj| obj.len())
                .unwrap_or_default()
                == 7,
        "HTTP task info response must only expose the expected task fields"
    );
}

#[test]
fn test_get_task_info_response_serialize_nulls() {
    let response = GetTaskInfoResponse {
        id: "T-1".to_string(),
        initial_prompt: "Minimal".to_string(),
        prompt: None,
        summary: None,
        status: "backlog".to_string(),
        depends_on: Vec::new(),
        labels: Vec::new(),
    };
    let json_value = serde_json::to_value(&response).expect("Failed to serialize");
    assert_eq!(json_value["id"], "T-1");
    assert_eq!(json_value["initial_prompt"], "Minimal");
    assert!(json_value["prompt"].is_null());
    assert!(json_value["summary"].is_null());
    assert_eq!(json_value["status"], "backlog");
    assert_eq!(json_value["depends_on"], serde_json::json!([]));
    assert_eq!(json_value["labels"], serde_json::json!([]));
    assert_eq!(json_value.as_object().map(|obj| obj.len()), Some(7));
}

#[test]
fn test_get_task_info_response_json_structure() {
    let response = GetTaskInfoResponse {
        id: "T-7".to_string(),
        initial_prompt: "Structure Test".to_string(),
        prompt: Some("Test prompt".to_string()),
        summary: None,
        status: "doing".to_string(),
        depends_on: vec!["T-1".to_string()],
        labels: Vec::new(),
    };
    let json_value = serde_json::to_value(&response).expect("Failed to convert to JSON value");
    assert_eq!(json_value["id"], "T-7");
    assert_eq!(json_value["initial_prompt"], "Structure Test");
    assert_eq!(json_value["prompt"], "Test prompt");
    assert!(json_value["summary"].is_null());
    assert_eq!(json_value["status"], "doing");
    assert_eq!(json_value["depends_on"], serde_json::json!(["T-1"]));
    assert_eq!(json_value["labels"], serde_json::json!([]));
    assert_eq!(json_value.as_object().map(|obj| obj.len()), Some(7));
}
