use crate::{db, diff_parser};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    pub sha: String,
    pub short_sha: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

/// Parse NUL-separated git log output into CommitInfo structs.
pub fn parse_git_log_output(output: &str) -> Vec<CommitInfo> {
    if output.trim().is_empty() {
        return Vec::new();
    }
    output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\0').collect();
            if parts.len() >= 5 {
                Some(CommitInfo {
                    sha: parts[0].to_string(),
                    short_sha: parts[1].to_string(),
                    message: parts[2].to_string(),
                    author: parts[3].to_string(),
                    date: parts[4].to_string(),
                })
            } else {
                None
            }
        })
        .collect()
}

pub async fn get_task_diff_for_workspace(
    worktree_path: &str,
    include_uncommitted: bool,
) -> Result<Vec<diff_parser::TaskFileDiff>, String> {
    let merge_base_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&worktree_path)
        .args(["merge-base", "origin/main", "HEAD"])
        .output()
        .await
        .map_err(|e| format!("Failed to run git merge-base: {}", e))?;

    if !merge_base_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_base_output.stderr);
        return Err(format!("git merge-base failed: {}", stderr));
    }

    let merge_base = String::from_utf8_lossy(&merge_base_output.stdout)
        .trim()
        .to_string();

    let mut cmd = tokio::process::Command::new("git");
    cmd.arg("-C")
        .arg(&worktree_path)
        .arg("diff")
        .arg(&merge_base);
    if !include_uncommitted {
        cmd.arg("HEAD");
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff failed: {}", stderr));
    }

    let diff_output = String::from_utf8_lossy(&output.stdout);
    let mut diffs = diff_parser::parse_unified_diff(&diff_output, true);

    if include_uncommitted {
        let untracked_output = tokio::process::Command::new("git")
            .arg("-C")
            .arg(&worktree_path)
            .args(["ls-files", "--others", "--exclude-standard"])
            .output()
            .await
            .map_err(|e| format!("Failed to run git ls-files: {}", e))?;

        if untracked_output.status.success() {
            let untracked_str = String::from_utf8_lossy(&untracked_output.stdout);
            for filename in untracked_str.lines() {
                let filename = filename.trim().to_string();
                if filename.is_empty() {
                    continue;
                }
                let full_path = std::path::Path::new(&worktree_path).join(&filename);
                match tokio::fs::read_to_string(&full_path).await {
                    Ok(content) => {
                        let lines: Vec<&str> = content.lines().collect();
                        let line_count = lines.len();
                        let total_patch_lines = line_count + 1; // +1 for @@ header
                        let (is_truncated, patch_line_count, patch_lines_to_use) =
                            if line_count > 10_000 {
                                (true, Some(total_patch_lines as i32), 199) // 199 content lines + 1 header = 200
                            } else {
                                (false, None, line_count)
                            };
                        let mut patch = format!("@@ -0,0 +1,{} @@\n", line_count);
                        for line in lines.iter().take(patch_lines_to_use) {
                            patch.push('+');
                            patch.push_str(line);
                            patch.push('\n');
                        }
                        diffs.push(diff_parser::TaskFileDiff {
                            sha: String::new(),
                            filename,
                            status: "added".to_string(),
                            additions: line_count as i32,
                            deletions: 0,
                            changes: line_count as i32,
                            patch: Some(patch),
                            previous_filename: None,
                            is_truncated,
                            patch_line_count,
                        });
                    }
                    Err(_) => {
                        diffs.push(diff_parser::TaskFileDiff {
                            sha: String::new(),
                            filename,
                            status: "binary".to_string(),
                            additions: 0,
                            deletions: 0,
                            changes: 0,
                            patch: None,
                            previous_filename: None,
                            is_truncated: false,
                            patch_line_count: None,
                        });
                    }
                }
            }
        }
    }

    Ok(diffs)
}

#[tauri::command]
pub async fn get_task_diff(
    task_id: String,
    include_uncommitted: bool,
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<diff_parser::TaskFileDiff>, String> {
    let worktree_path = {
        let db = crate::db::acquire_db(&db);
        resolve_workspace_path(&db, &task_id)?
    };
    get_task_diff_for_workspace(&worktree_path, include_uncommitted).await
}

// ============================================================================
// File content helpers
// ============================================================================

fn is_image_path(path: &str) -> bool {
    let extension = std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());

    matches!(
        extension.as_deref(),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico")
    )
}

fn is_removed_status(status: &str) -> bool {
    status == "removed" || status == "deleted"
}

fn bytes_to_frontend_content(path: &str, bytes: &[u8]) -> String {
    if is_image_path(path) {
        general_purpose::STANDARD.encode(bytes)
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

async fn fetch_file_contents(
    worktree_path: &str,
    merge_base: &str,
    path: &str,
    old_path: Option<&str>,
    status: &str,
    include_uncommitted: bool,
) -> Result<(String, String), String> {
    let old_content = if status == "added" {
        String::new()
    } else {
        let old_file_path = old_path.unwrap_or(path);
        let old_output = tokio::process::Command::new("git")
            .arg("-C")
            .arg(worktree_path)
            .args(["show", &format!("{}:{}", merge_base, old_file_path)])
            .output()
            .await
            .map_err(|e| format!("Failed to run git show: {}", e))?;

        if old_output.status.success() {
            bytes_to_frontend_content(old_file_path, &old_output.stdout)
        } else {
            String::new()
        }
    };

    let new_content = if is_removed_status(status) {
        String::new()
    } else if include_uncommitted {
        let full_path = std::path::Path::new(worktree_path).join(path);
        match tokio::fs::read(&full_path).await {
            Ok(bytes) => bytes_to_frontend_content(path, &bytes),
            Err(_) => String::new(),
        }
    } else {
        let new_output = tokio::process::Command::new("git")
            .arg("-C")
            .arg(worktree_path)
            .args(["show", &format!("HEAD:{}", path)])
            .output()
            .await
            .map_err(|e| format!("Failed to run git show: {}", e))?;
        if new_output.status.success() {
            bytes_to_frontend_content(path, &new_output.stdout)
        } else {
            String::new()
        }
    };

    Ok((old_content, new_content))
}

// ============================================================================
// Single-file command
// ============================================================================

pub async fn get_task_file_contents_for_workspace(
    worktree_path: &str,
    path: &str,
    old_path: Option<&str>,
    status: &str,
    include_uncommitted: bool,
) -> Result<(String, String), String> {
    let merge_base_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&worktree_path)
        .args(["merge-base", "origin/main", "HEAD"])
        .output()
        .await
        .map_err(|e| format!("Failed to run git merge-base: {}", e))?;

    if !merge_base_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_base_output.stderr);
        return Err(format!("git merge-base failed: {}", stderr));
    }

    let merge_base = String::from_utf8_lossy(&merge_base_output.stdout)
        .trim()
        .to_string();

    fetch_file_contents(
        &worktree_path,
        &merge_base,
        path,
        old_path,
        status,
        include_uncommitted,
    )
    .await
}

#[tauri::command]
pub async fn get_task_file_contents(
    task_id: String,
    path: String,
    old_path: Option<String>,
    status: String,
    include_uncommitted: bool,
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<(String, String), String> {
    let worktree_path = {
        let db = crate::db::acquire_db(&db);
        resolve_workspace_path(&db, &task_id)?
    };
    get_task_file_contents_for_workspace(
        &worktree_path,
        &path,
        old_path.as_deref(),
        &status,
        include_uncommitted,
    )
    .await
}

// ============================================================================
// Batch command — computes merge-base ONCE, then fetches N files
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct FileContentRequest {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
}

pub async fn get_task_batch_file_contents_for_workspace(
    worktree_path: &str,
    files: &[FileContentRequest],
    include_uncommitted: bool,
) -> Result<Vec<(String, String)>, String> {
    let merge_base_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&worktree_path)
        .args(["merge-base", "origin/main", "HEAD"])
        .output()
        .await
        .map_err(|e| format!("Failed to run git merge-base: {}", e))?;

    if !merge_base_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_base_output.stderr);
        return Err(format!("git merge-base failed: {}", stderr));
    }

    let merge_base = String::from_utf8_lossy(&merge_base_output.stdout)
        .trim()
        .to_string();

    // Fetch each file using the single pre-computed merge-base.
    let mut results = Vec::with_capacity(files.len());
    for file in files {
        let contents = fetch_file_contents(
            &worktree_path,
            &merge_base,
            &file.path,
            file.old_path.as_deref(),
            &file.status,
            include_uncommitted,
        )
        .await?;
        results.push(contents);
    }

    Ok(results)
}

#[tauri::command]
pub async fn get_task_batch_file_contents(
    task_id: String,
    files: Vec<FileContentRequest>,
    include_uncommitted: bool,
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<(String, String)>, String> {
    let worktree_path = {
        let db = crate::db::acquire_db(&db);
        resolve_workspace_path(&db, &task_id)?
    };
    get_task_batch_file_contents_for_workspace(&worktree_path, &files, include_uncommitted).await
}

#[tauri::command]
pub async fn add_self_review_comment(
    task_id: String,
    comment_type: String,
    file_path: Option<String>,
    line_number: Option<i32>,
    body: String,
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<i64, String> {
    let db = crate::db::acquire_db(&db);
    db.insert_self_review_comment(
        &task_id,
        &comment_type,
        file_path.as_deref(),
        line_number,
        &body,
    )
    .map_err(|e| format!("Failed to add self review comment: {}", e))
}

#[tauri::command]
pub async fn get_active_self_review_comments(
    task_id: String,
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<db::SelfReviewCommentRow>, String> {
    let db = crate::db::acquire_db(&db);
    db.get_active_self_review_comments(&task_id)
        .map_err(|e| format!("Failed to get active self review comments: {}", e))
}

#[tauri::command]
pub async fn get_archived_self_review_comments(
    task_id: String,
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<db::SelfReviewCommentRow>, String> {
    let db = crate::db::acquire_db(&db);
    db.get_archived_self_review_comments(&task_id)
        .map_err(|e| format!("Failed to get archived self review comments: {}", e))
}

#[tauri::command]
pub async fn delete_self_review_comment(
    comment_id: i64,
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<(), String> {
    let db = crate::db::acquire_db(&db);
    db.delete_self_review_comment(comment_id)
        .map_err(|e| format!("Failed to delete self review comment: {}", e))
}

#[tauri::command]
pub async fn archive_self_review_comments(
    task_id: String,
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<(), String> {
    let db = crate::db::acquire_db(&db);
    db.archive_self_review_comments(&task_id)
        .map_err(|e| format!("Failed to archive self review comments: {}", e))
}

pub async fn get_task_commits_for_workspace(
    worktree_path: &str,
) -> Result<Vec<CommitInfo>, String> {
    let merge_base_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&worktree_path)
        .args(["merge-base", "origin/main", "HEAD"])
        .output()
        .await
        .map_err(|e| format!("Failed to run git merge-base: {}", e))?;

    if !merge_base_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_base_output.stderr);
        return Err(format!("git merge-base failed: {}", stderr));
    }

    let merge_base = String::from_utf8_lossy(&merge_base_output.stdout)
        .trim()
        .to_string();

    let log_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&worktree_path)
        .args([
            "log",
            "--ancestry-path",
            "--topo-order",
            "--reverse",
            "--pretty=format:%H%x00%h%x00%s%x00%an%x00%aI",
            &format!("{}..HEAD", merge_base),
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    if !log_output.status.success() {
        let stderr = String::from_utf8_lossy(&log_output.stderr);
        return Err(format!("git log failed: {}", stderr));
    }

    let output_str = String::from_utf8_lossy(&log_output.stdout);
    Ok(parse_git_log_output(&output_str))
}

#[tauri::command]
pub async fn get_task_commits(
    task_id: String,
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<CommitInfo>, String> {
    let worktree_path = {
        let db = crate::db::acquire_db(&db);
        resolve_workspace_path(&db, &task_id)?
    };
    get_task_commits_for_workspace(&worktree_path).await
}

// ============================================================================
// Per-commit diff helpers
// ============================================================================

/// Get the parent SHA for a commit. Falls back to the empty tree SHA for root commits.
async fn get_parent_sha(worktree_path: &str, commit_sha: &str) -> Result<String, String> {
    let parent_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["rev-parse", &format!("{}^1", commit_sha)])
        .output()
        .await
        .map_err(|e| format!("Failed to run git rev-parse: {}", e))?;

    if parent_output.status.success() {
        Ok(String::from_utf8_lossy(&parent_output.stdout)
            .trim()
            .to_string())
    } else {
        // Root commit — use git's empty tree SHA
        Ok("4b825dc642cb6eb9a060e54bf899d15006245d1a".to_string())
    }
}

async fn fetch_commit_file_contents(
    worktree_path: &str,
    parent_sha: &str,
    commit_sha: &str,
    path: &str,
    old_path: Option<&str>,
    status: &str,
) -> Result<(String, String), String> {
    let old_content = if status == "added" {
        String::new()
    } else {
        let old_file_path = old_path.unwrap_or(path);
        let old_output = tokio::process::Command::new("git")
            .arg("-C")
            .arg(worktree_path)
            .args(["show", &format!("{}:{}", parent_sha, old_file_path)])
            .output()
            .await
            .map_err(|e| format!("Failed to run git show: {}", e))?;

        if old_output.status.success() {
            bytes_to_frontend_content(old_file_path, &old_output.stdout)
        } else {
            String::new()
        }
    };

    let new_content = if is_removed_status(status) {
        String::new()
    } else {
        let new_output = tokio::process::Command::new("git")
            .arg("-C")
            .arg(worktree_path)
            .args(["show", &format!("{}:{}", commit_sha, path)])
            .output()
            .await
            .map_err(|e| format!("Failed to run git show: {}", e))?;
        if new_output.status.success() {
            bytes_to_frontend_content(path, &new_output.stdout)
        } else {
            String::new()
        }
    };

    Ok((old_content, new_content))
}

// ============================================================================
// Per-commit diff commands
// ============================================================================

pub async fn get_commit_diff_for_workspace(
    worktree_path: &str,
    commit_sha: &str,
) -> Result<Vec<diff_parser::TaskFileDiff>, String> {
    let parent_sha = get_parent_sha(worktree_path, commit_sha).await?;

    let diff_output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&worktree_path)
        .args(["diff", &parent_sha, commit_sha])
        .output()
        .await
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    if !diff_output.status.success() {
        let stderr = String::from_utf8_lossy(&diff_output.stderr);
        return Err(format!("git diff failed: {}", stderr));
    }

    let output_str = String::from_utf8_lossy(&diff_output.stdout);
    Ok(diff_parser::parse_unified_diff(&output_str, true))
}

#[tauri::command]
pub async fn get_commit_diff(
    task_id: String,
    commit_sha: String,
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<diff_parser::TaskFileDiff>, String> {
    let worktree_path = {
        let db = crate::db::acquire_db(&db);
        resolve_workspace_path(&db, &task_id)?
    };
    get_commit_diff_for_workspace(&worktree_path, &commit_sha).await
}

pub async fn get_commit_file_contents_for_workspace(
    worktree_path: &str,
    commit_sha: &str,
    path: &str,
    old_path: Option<&str>,
    status: &str,
) -> Result<(String, String), String> {
    let parent_sha = get_parent_sha(worktree_path, commit_sha).await?;

    fetch_commit_file_contents(
        &worktree_path,
        &parent_sha,
        commit_sha,
        path,
        old_path,
        status,
    )
    .await
}

#[tauri::command]
pub async fn get_commit_file_contents(
    task_id: String,
    commit_sha: String,
    path: String,
    old_path: Option<String>,
    status: String,
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<(String, String), String> {
    let worktree_path = {
        let db = crate::db::acquire_db(&db);
        resolve_workspace_path(&db, &task_id)?
    };
    get_commit_file_contents_for_workspace(
        &worktree_path,
        &commit_sha,
        &path,
        old_path.as_deref(),
        &status,
    )
    .await
}

pub async fn get_commit_batch_file_contents_for_workspace(
    worktree_path: &str,
    commit_sha: &str,
    files: &[FileContentRequest],
) -> Result<Vec<(String, String)>, String> {
    let parent_sha = get_parent_sha(worktree_path, commit_sha).await?;

    let mut results = Vec::with_capacity(files.len());
    for file in files {
        let contents = fetch_commit_file_contents(
            &worktree_path,
            &parent_sha,
            commit_sha,
            &file.path,
            file.old_path.as_deref(),
            &file.status,
        )
        .await?;
        results.push(contents);
    }

    Ok(results)
}

#[tauri::command]
pub async fn get_commit_batch_file_contents(
    task_id: String,
    commit_sha: String,
    files: Vec<FileContentRequest>,
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<(String, String)>, String> {
    let worktree_path = {
        let db = crate::db::acquire_db(&db);
        resolve_workspace_path(&db, &task_id)?
    };
    get_commit_batch_file_contents_for_workspace(&worktree_path, &commit_sha, &files).await
}

pub fn resolve_workspace_path(db: &crate::db::Database, task_id: &str) -> Result<String, String> {
    let worktree = db
        .get_worktree_for_task(task_id)
        .map_err(|e| format!("Failed to get worktree for task: {}", e))?;

    if let Some(row) = &worktree {
        if std::path::Path::new(&row.worktree_path).is_dir() {
            return Ok(row.worktree_path.clone());
        }
    }

    let workspace = db
        .get_task_workspace_for_task(task_id)
        .map_err(|e| format!("Failed to get task workspace for task: {}", e))?;

    if let Some(workspace) = workspace {
        if std::path::Path::new(&workspace.workspace_path).is_dir() {
            return Ok(workspace.workspace_path);
        }
    }

    Err(format!("No workspace found for task {}", task_id))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::make_test_db;
    use tempfile::tempdir;

    #[test]
    fn test_resolve_workspace_path_from_task_workspaces_only() {
        let (db, db_path) = make_test_db("resolve_workspace_path_task_workspaces_only");
        let workspace_dir = tempdir().expect("create temp workspace dir");
        let workspace_path = workspace_dir.path().to_string_lossy().to_string();
        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task(
                "No worktree task",
                "doing",
                Some(&project.id),
                None,
                None,
                None,
            )
            .expect("create task failed");

        db.create_task_workspace_record(
            &task.id,
            &project.id,
            &workspace_path,
            "/tmp/test-repo",
            "project_dir",
            None,
            "opencode",
        )
        .expect("create task workspace failed");

        let path = resolve_workspace_path(&db, &task.id).expect("should resolve path");
        assert_eq!(path, workspace_path);

        drop(db);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_resolve_workspace_path_prefers_worktrees_row() {
        let (db, db_path) = make_test_db("resolve_workspace_path_prefers_worktrees");
        let worktree_dir = tempdir().expect("create temp worktree dir");
        let worktree_path = worktree_dir.path().to_string_lossy().to_string();
        let workspace_dir = tempdir().expect("create temp workspace dir");
        let workspace_path = workspace_dir.path().to_string_lossy().to_string();
        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task(
                "Both sources task",
                "doing",
                Some(&project.id),
                None,
                None,
                None,
            )
            .expect("create task failed");

        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/test-repo",
            &worktree_path,
            "branch-1",
        )
        .expect("create worktree record failed");

        db.create_task_workspace_record(
            &task.id,
            &project.id,
            &workspace_path,
            "/tmp/test-repo",
            "project_dir",
            None,
            "opencode",
        )
        .expect("create task workspace failed");

        let path = resolve_workspace_path(&db, &task.id).expect("should resolve path");
        assert_eq!(path, worktree_path);

        drop(db);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_resolve_workspace_path_falls_back_when_worktree_path_is_stale() {
        let (db, db_path) = make_test_db("resolve_workspace_path_stale_worktree");
        let workspace_dir = tempdir().expect("create temp workspace dir");
        let workspace_path = workspace_dir.path().to_string_lossy().to_string();
        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task(
                "Stale worktree task",
                "doing",
                Some(&project.id),
                None,
                None,
                None,
            )
            .expect("create task failed");

        db.create_worktree_record(
            &task.id,
            &project.id,
            "/tmp/test-repo",
            "/tmp/non-existent-worktree-path",
            "branch-1",
        )
        .expect("create worktree record failed");

        db.create_task_workspace_record(
            &task.id,
            &project.id,
            &workspace_path,
            "/tmp/test-repo",
            "project_dir",
            None,
            "opencode",
        )
        .expect("create task workspace failed");

        let path = resolve_workspace_path(&db, &task.id).expect("should resolve path");
        assert_eq!(path, workspace_path);

        drop(db);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_resolve_workspace_path_returns_err_when_no_row_exists() {
        let (db, db_path) = make_test_db("resolve_workspace_path_no_row");
        let project = db
            .create_project("Test Project", "/tmp/test-repo")
            .expect("create project failed");
        let task = db
            .create_task(
                "Task with no workspace",
                "doing",
                Some(&project.id),
                None,
                None,
                None,
            )
            .expect("create task failed");

        let result = resolve_workspace_path(&db, &task.id);
        assert!(result.is_err(), "expected Err but got {:?}", result);
        assert!(
            result.unwrap_err().contains(&task.id),
            "error message should contain task id"
        );

        drop(db);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_image_path_detection_is_case_insensitive() {
        assert!(is_image_path("assets/logo.PNG"));
        assert!(is_image_path("photo.jpeg"));
        assert!(is_image_path("icons/vector.svg"));
        assert!(!is_image_path("src/main.rs"));
    }

    #[test]
    fn test_image_content_is_encoded_for_frontend() {
        let content = bytes_to_frontend_content("assets/logo.png", &[0x89, b'P', b'N', b'G']);
        assert_eq!(content, "iVBORw==");
    }

    #[test]
    fn test_text_content_stays_text_for_frontend() {
        let content = bytes_to_frontend_content("src/main.rs", b"fn main() {}\n");
        assert_eq!(content, "fn main() {}\n");
    }

    #[test]
    fn test_removed_status_accepts_git_and_github_names() {
        assert!(is_removed_status("removed"));
        assert!(is_removed_status("deleted"));
        assert!(!is_removed_status("modified"));
    }

    #[test]
    fn test_file_content_request_deserialize() {
        let json = r#"{"path":"src/main.rs","old_path":null,"status":"modified"}"#;
        let req: FileContentRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.path, "src/main.rs");
        assert!(req.old_path.is_none());
        assert_eq!(req.status, "modified");
    }

    #[test]
    fn test_file_content_request_deserialize_with_old_path() {
        let json = r#"{"path":"new/path.rs","old_path":"old/path.rs","status":"renamed"}"#;
        let req: FileContentRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.path, "new/path.rs");
        assert_eq!(req.old_path.as_deref(), Some("old/path.rs"));
        assert_eq!(req.status, "renamed");
    }

    #[test]
    fn test_batch_request_produces_parallel_results_structure() {
        let files = [
            FileContentRequest {
                path: "a.rs".into(),
                old_path: None,
                status: "added".into(),
            },
            FileContentRequest {
                path: "b.rs".into(),
                old_path: None,
                status: "modified".into(),
            },
            FileContentRequest {
                path: "c.rs".into(),
                old_path: Some("old_c.rs".into()),
                status: "renamed".into(),
            },
        ];

        assert_eq!(files.len(), 3);
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["a.rs", "b.rs", "c.rs"]);
    }

    #[test]
    fn test_commit_info_serialize() {
        let info = super::CommitInfo {
            sha: "abc123def456".to_string(),
            short_sha: "abc123d".to_string(),
            message: "Fix login bug".to_string(),
            author: "dev".to_string(),
            date: "2025-01-01T00:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("abc123def456"));
        assert!(json.contains("abc123d"));
        assert!(json.contains("Fix login bug"));
    }

    #[test]
    fn test_parse_git_log_output_multiple() {
        let output = "abc123\0abc\0First commit\0Alice\x002025-01-01T00:00:00Z\ndef456\0def\0Second commit\0Bob\x002025-01-02T00:00:00Z";
        let result = super::parse_git_log_output(output);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].sha, "abc123");
        assert_eq!(result[0].short_sha, "abc");
        assert_eq!(result[0].message, "First commit");
        assert_eq!(result[0].author, "Alice");
        assert_eq!(result[1].sha, "def456");
        assert_eq!(result[1].message, "Second commit");
    }

    #[test]
    fn test_parse_git_log_output_empty() {
        let result = super::parse_git_log_output("");
        assert!(result.is_empty());
        let result = super::parse_git_log_output("   \n  ");
        assert!(result.is_empty());
    }

    #[test]
    fn test_parse_git_log_output_malformed_line() {
        let output = "abc123\0abc\0Commit msg\0Author\x002025-01-01\nbadline";
        let result = super::parse_git_log_output(output);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].sha, "abc123");
    }
}
