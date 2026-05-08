use super::*;

#[tokio::test]
async fn handler_uses_shared_boundary() {
    let (state, path) = test_state("app_invoke_github_shared_boundary");
    {
        let db = state.db.lock().expect("db lock");
        let task = db
            .create_task("PR task", "doing", None, None, None)
            .expect("create task");
        db.insert_pull_request(
            10,
            &task.id,
            "owner",
            "repo",
            "Fix bug",
            "https://github.com/owner/repo/pull/5",
            "open",
            1000,
            2000,
            false,
        )
        .expect("insert PR");
    }

    let value = invoke_ok(&state, "get_pull_requests", serde_json::Value::Null).await;
    assert_eq!(value[0]["title"], "Fix bug");

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn submit_pr_review_rejects_null_comments_before_runtime() {
    let (state, path) = test_state("app_invoke_submit_pr_review_null_comments");

    let err = invoke(
        &state,
        "submit_pr_review",
        json!({
            "owner": "owner",
            "repo": "repo",
            "prNumber": 7,
            "event": "COMMENT",
            "body": "looks risky",
            "commitId": "sha-1",
            "comments": null,
        }),
    )
    .await
    .expect_err("null comments should be rejected before GitHub runtime");

    assert_eq!(err.0, StatusCode::BAD_REQUEST);
    assert!(err.1.contains("payload.comments is invalid"));
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn handles_db_backed_commands_and_events() {
    let (state, path) = test_state("app_invoke_github_review_db_backed");
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("event sender")
        .subscribe();
    {
        let db = state.db.lock().expect("db lock");
        let task = db
            .create_task("PR task", "doing", None, None, None)
            .expect("create task");
        db.insert_pull_request(
            10,
            &task.id,
            "owner",
            "repo",
            "Fix bug",
            "https://github.com/owner/repo/pull/5",
            "open",
            1000,
            2000,
            false,
        )
        .expect("insert PR");
        db.insert_pr_comment(
            501,
            10,
            "reviewer",
            "Please fix",
            "review",
            Some("src/main.rs"),
            Some(12),
            false,
            3000,
        )
        .expect("insert PR comment");
        db.upsert_review_pr(
            20,
            7,
            "Review me",
            Some("body"),
            "open",
            false,
            "https://github.com/owner/repo/pull/7",
            "author",
            None,
            "owner",
            "repo",
            "feature",
            "main",
            "sha-1",
            10,
            2,
            3,
            1000,
            2000,
        )
        .expect("upsert review PR");
        db.upsert_authored_pr(
            30,
            9,
            "Authored by me",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/9",
            "me",
            None,
            "owner",
            "repo",
            "feature-authored",
            "main",
            "sha-authored",
            1,
            1,
            1,
            Some("success"),
            None,
            Some("approved"),
            None,
            false,
            Some(&task.id),
            1000,
            2000,
        )
        .expect("upsert authored PR");
    }

    assert_eq!(
        invoke_ok(&state, "get_pull_requests", serde_json::Value::Null).await[0]["title"],
        "Fix bug"
    );
    assert_eq!(
        invoke_ok(&state, "get_pr_comments", json!({ "prId": 10 })).await[0]["body"],
        "Please fix"
    );
    invoke_ok(
        &state,
        "mark_comment_addressed",
        json!({ "commentId": 501 }),
    )
    .await;
    let event = events.recv().await.expect("comment addressed event");
    assert_eq!(event.event_name, "comment-addressed");
    assert_eq!(
        invoke_ok(&state, "get_review_prs", serde_json::Value::Null).await[0]["title"],
        "Review me"
    );
    invoke_ok(
        &state,
        "mark_review_pr_viewed",
        json!({ "prId": 20, "headSha": "sha-1" }),
    )
    .await;
    assert_eq!(
        invoke_ok(&state, "get_authored_prs", serde_json::Value::Null).await[0]["title"],
        "Authored by me"
    );

    let _ = std::fs::remove_file(path);
}
