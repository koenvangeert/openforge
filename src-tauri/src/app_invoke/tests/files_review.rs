use super::*;

#[tokio::test]
async fn handles_fs_self_review_and_agent_review_db_commands() {
    let (state, path) = test_state("app_invoke_files_self_agent_review");
    let temp_dir = tempfile::tempdir().expect("temp project dir");
    std::fs::write(temp_dir.path().join("README.md"), "hello electron").expect("write file");
    std::fs::create_dir_all(temp_dir.path().join("src")).expect("create src dir");
    std::fs::write(temp_dir.path().join("src/main.rs"), "fn main() {}\n").expect("write rust file");
    let repo = git2::Repository::init(temp_dir.path()).expect("init repo");
    let mut index = repo.index().expect("repo index");
    index
        .add_path(std::path::Path::new("README.md"))
        .expect("add readme");
    index
        .add_path(std::path::Path::new("src/main.rs"))
        .expect("add main");
    index.write().expect("write index");
    let (project_id, task_id) = {
        let db = state.db.lock().expect("db lock");
        let project = db
            .create_project("Open Forge", temp_dir.path().to_str().expect("utf8 path"))
            .expect("create project");
        let task = db
            .create_task("Review task", "doing", Some(&project.id), None, None, None)
            .expect("create task");
        db.upsert_review_pr(
            88,
            8,
            "Review PR",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/8",
            "author",
            None,
            "owner",
            "repo",
            "feature",
            "main",
            "sha-8",
            0,
            0,
            0,
            1000,
            2000,
        )
        .expect("upsert review pr");
        let agent_comment_id = db
            .insert_agent_review_comment(
                88,
                "review-session",
                "file_specific",
                Some("src/main.rs"),
                Some(1),
                Some("RIGHT"),
                "Agent says fix this",
                None,
                None,
            )
            .expect("insert agent comment");
        assert!(agent_comment_id > 0);
        (project.id, task.id)
    };

    let dir_entries = invoke_ok(
        &state,
        "fs_read_dir",
        json!({ "projectId": project_id, "dirPath": null }),
    )
    .await;
    assert!(dir_entries
        .as_array()
        .expect("dir entries")
        .iter()
        .any(|entry| entry["name"] == "src" && entry["isDir"] == true));
    let file = invoke_ok(
        &state,
        "fs_read_file",
        json!({ "projectId": project_id, "filePath": "README.md" }),
    )
    .await;
    assert_eq!(file["content"], "hello electron");
    assert_eq!(file["mimeType"], "text/markdown");
    std::fs::write(temp_dir.path().join("src/main.py"), "print(\"hello\")")
        .expect("write python file");
    assert_eq!(
        invoke_ok(
            &state,
            "fs_read_file",
            json!({ "projectId": project_id, "filePath": "src/main.py" })
        )
        .await["mimeType"],
        "text/python"
    );
    assert!(invoke_ok(
        &state,
        "fs_search_files",
        json!({ "projectId": project_id, "query": "main", "limit": 10 })
    )
    .await
    .as_array()
    .expect("search")
    .iter()
    .any(|value| value == "src/main.rs"));

    let self_comment_id = invoke_ok(
            &state,
            "add_self_review_comment",
            json!({ "taskId": task_id, "commentType": "general", "filePath": null, "lineNumber": null, "body": "Self review note" }),
        )
        .await
        .as_i64()
        .expect("self comment id");
    assert!(self_comment_id > 0);
    assert_eq!(
        invoke_ok(
            &state,
            "get_active_self_review_comments",
            json!({ "taskId": task_id })
        )
        .await[0]["body"],
        "Self review note"
    );
    invoke_ok(
        &state,
        "archive_self_review_comments",
        json!({ "taskId": task_id }),
    )
    .await;
    assert_eq!(
        invoke_ok(
            &state,
            "get_archived_self_review_comments",
            json!({ "taskId": task_id })
        )
        .await[0]["id"],
        self_comment_id
    );
    invoke_ok(
        &state,
        "delete_self_review_comment",
        json!({ "commentId": self_comment_id }),
    )
    .await;

    let agent_comment_id = invoke_ok(
        &state,
        "get_agent_review_comments",
        json!({ "reviewPrId": 88 }),
    )
    .await[0]["id"]
        .as_i64()
        .expect("agent comment id");
    invoke_ok(
        &state,
        "update_agent_review_comment_status",
        json!({ "commentId": agent_comment_id, "status": "addressed" }),
    )
    .await;
    invoke_ok(
        &state,
        "dismiss_all_agent_review_comments",
        json!({ "reviewPrId": 88 }),
    )
    .await;

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn fs_read_file_treats_gitignore_dotfile_as_text() {
    let (state, path) = test_state("app_invoke_gitignore_dotfile_text_preview");
    let temp_dir = tempfile::tempdir().expect("temp project dir");
    std::fs::write(
        temp_dir.path().join(".gitignore"),
        "target/\nnode_modules/\n",
    )
    .expect("write gitignore");
    std::fs::write(temp_dir.path().join("extensionless"), "plain text\n")
        .expect("write extensionless file");

    let project_id = {
        let db = state.db.lock().expect("db lock");
        db.create_project("Open Forge", temp_dir.path().to_str().expect("utf8 path"))
            .expect("create project")
            .id
    };

    let file = invoke_ok(
        &state,
        "fs_read_file",
        json!({ "projectId": project_id, "filePath": ".gitignore" }),
    )
    .await;

    assert_eq!(file["type"], "text");
    assert_eq!(file["content"], "target/\nnode_modules/\n");
    assert_eq!(file["mimeType"], "text/plain");

    let extensionless = invoke_ok(
        &state,
        "fs_read_file",
        json!({ "projectId": project_id, "filePath": "extensionless" }),
    )
    .await;
    assert_eq!(extensionless["type"], "binary");
    assert_eq!(extensionless["content"], "");
    assert_eq!(extensionless["mimeType"], serde_json::Value::Null);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn handles_git_workspace_extraction_commands() {
    let (state, path) = test_state("app_invoke_git_workspace_extraction");
    let repo_dir = tempfile::tempdir().expect("temp git repo");
    let repo_path = repo_dir.path();
    let run_git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };

    run_git(&["init", "-b", "main"]);
    run_git(&["config", "user.email", "test@example.com"]);
    run_git(&["config", "user.name", "Test User"]);
    std::fs::write(repo_path.join("tracked.txt"), "base\n").expect("write base");
    run_git(&["add", "tracked.txt"]);
    run_git(&["commit", "-m", "base"]);
    run_git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
    std::fs::write(repo_path.join("tracked.txt"), "base\nfeature\n").expect("write feature");
    run_git(&["add", "tracked.txt"]);
    run_git(&["commit", "-m", "feature change"]);
    let feature_sha = run_git(&["rev-parse", "HEAD"]);
    std::fs::write(repo_path.join("untracked.txt"), "new\n").expect("write untracked");

    let task_id = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .create_project("Git Project", repo_path.to_str().expect("repo path"))
            .expect("create project");
        let task = db
            .create_task("Review diff", "doing", Some(&project.id), None, None, None)
            .expect("create task");
        db.create_task_workspace_record(
            &task.id,
            &project.id,
            repo_path.to_str().expect("repo path"),
            repo_path.to_str().expect("repo path"),
            "project_dir",
            None,
            "opencode",
        )
        .expect("create workspace");
        task.id
    };

    let diff_value = invoke_ok(
        &state,
        "get_task_diff",
        json!({ "taskId": task_id, "includeUncommitted": true }),
    )
    .await;
    assert!(diff_value
        .as_array()
        .expect("diffs")
        .iter()
        .any(|file| file["filename"] == "tracked.txt"));
    assert!(diff_value
        .as_array()
        .expect("diffs")
        .iter()
        .any(|file| file["filename"] == "untracked.txt"));

    let commit_value = invoke_ok(&state, "get_task_commits", json!({ "taskId": task_id })).await;
    assert_eq!(commit_value.as_array().expect("commits").len(), 1);
    assert_eq!(commit_value[0]["message"], "feature change");

    assert!(invoke_ok(
        &state,
        "get_commit_diff",
        json!({ "taskId": task_id, "commitSha": feature_sha }),
    )
    .await
    .as_array()
    .expect("commit diff")
    .iter()
    .any(|file| file["filename"] == "tracked.txt"));

    let task_contents = invoke_ok(
            &state,
            "get_task_file_contents",
            json!({ "taskId": task_id, "path": "tracked.txt", "oldPath": null, "status": "modified", "includeUncommitted": true }),
        )
        .await;
    assert_eq!(task_contents[0], "base\n");
    assert_eq!(task_contents[1], "base\nfeature\n");

    let batch = invoke_ok(
            &state,
            "get_task_batch_file_contents",
            json!({ "taskId": task_id, "files": [{ "path": "tracked.txt", "old_path": null, "status": "modified" }], "includeUncommitted": true }),
        )
        .await;
    assert_eq!(batch[0][1], "base\nfeature\n");

    let commit_contents = invoke_ok(
            &state,
            "get_commit_file_contents",
            json!({ "taskId": task_id, "commitSha": feature_sha, "path": "tracked.txt", "oldPath": null, "status": "modified" }),
        )
        .await;
    assert_eq!(commit_contents[1], "base\nfeature\n");

    let commit_batch = invoke_ok(
            &state,
            "get_commit_batch_file_contents",
            json!({ "taskId": task_id, "commitSha": feature_sha, "files": [{ "path": "tracked.txt", "old_path": null, "status": "modified" }] }),
        )
        .await;
    assert_eq!(commit_batch[0][0], "base\n");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn returns_explicit_blockers_for_live_review_commands() {
    let (state, path) = test_state("app_invoke_files_review_blockers");

    let err = invoke(&state, "start_agent_review", json!({ "reviewPrId": 88 }))
        .await
        .expect_err("live review command should report missing runtime state");
    assert_eq!(err.0, StatusCode::NOT_IMPLEMENTED);
    assert!(err.1.contains("requires provider runtime state"));

    let _ = std::fs::remove_file(path);
}
