use super::*;

#[test]
fn test_resolve_project_id_with_explicit_id() {
    let (db, _path) = crate::db::test_helpers::make_test_db("resolve_explicit");
    let result = resolve_project_id(&db, Some("P-1"), None);
    assert_eq!(result, Ok("P-1".to_string()));
}

#[test]
fn test_resolve_project_id_empty_id_falls_through() {
    let (db, _path) = crate::db::test_helpers::make_test_db("resolve_empty_id");
    let result = resolve_project_id(&db, Some(""), None);
    assert!(result.is_err());
}

#[test]
fn test_resolve_project_id_none_id_falls_through() {
    let (db, _path) = crate::db::test_helpers::make_test_db("resolve_none_id");
    let result = resolve_project_id(&db, None, None);
    assert!(result.is_err());
}

#[test]
fn test_resolve_project_id_from_worktree() {
    let (db, _path) = crate::db::test_helpers::make_test_db("resolve_worktree");
    let project = db
        .create_project("Test Project", "/tmp/test")
        .expect("create project");
    crate::db::test_helpers::insert_test_task(&db);
    db.create_worktree_record("T-100", &project.id, "/tmp/repo", "/tmp/wt1", "branch-1")
        .expect("create worktree");

    let result = resolve_project_id(&db, None, Some("/tmp/wt1"));
    assert_eq!(result, Ok(project.id));
}

#[test]
fn test_resolve_project_id_no_match_lists_available_projects() {
    let (db, _path) = crate::db::test_helpers::make_test_db("resolve_no_match");
    db.create_project("My Project", "/path/to/project")
        .expect("create project");

    let result = resolve_project_id(&db, None, None);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("Could not determine project"), "Error: {err}");
    assert!(err.contains("P-1"), "Should list project ID. Error: {err}");
    assert!(
        err.contains("My Project"),
        "Should list project name. Error: {err}"
    );
    assert!(
        err.contains("/path/to/project"),
        "Should list project path. Error: {err}"
    );
    assert!(
        err.contains("create_task"),
        "Should tell caller to retry. Error: {err}"
    );
}

#[test]
fn test_resolve_project_id_no_projects_at_all() {
    let (db, _path) = crate::db::test_helpers::make_test_db("resolve_no_projects");
    let result = resolve_project_id(&db, None, None);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("none"),
        "Should indicate no projects exist. Error: {err}"
    );
}

#[test]
fn test_resolve_project_id_worktree_not_found_lists_projects() {
    let (db, _path) = crate::db::test_helpers::make_test_db("resolve_wt_not_found");
    db.create_project("Test", "/tmp/test")
        .expect("create project");

    let result = resolve_project_id(&db, None, Some("/unknown/path"));
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("Could not determine project"), "Error: {err}");
    assert!(
        err.contains("P-1"),
        "Should list available project. Error: {err}"
    );
}

#[test]
fn test_resolve_project_id_explicit_takes_priority_over_worktree() {
    let (db, _path) = crate::db::test_helpers::make_test_db("resolve_priority");
    let project = db
        .create_project("Test Project", "/tmp/test")
        .expect("create project");
    crate::db::test_helpers::insert_test_task(&db);
    db.create_worktree_record("T-100", &project.id, "/tmp/repo", "/tmp/wt1", "branch-1")
        .expect("create worktree");

    let result = resolve_project_id(&db, Some("P-99"), Some("/tmp/wt1"));
    assert_eq!(result, Ok("P-99".to_string()));
}
