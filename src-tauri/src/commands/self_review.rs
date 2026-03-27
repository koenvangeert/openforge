use crate::{db, diff_parser};
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use tauri::State;

#[tauri::command]
pub async fn get_task_diff(
    task_id: String,
    include_uncommitted: bool,
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<diff_parser::TaskFileDiff>, String> {
    let worktree_path = {
        let db = crate::db::acquire_db(&db);
        let row = db
            .get_worktree_for_task(&task_id)
            .map_err(|e| format!("Failed to get worktree for task: {}", e))?;
        row.ok_or_else(|| format!("No worktree found for task {}", task_id))?
            .worktree_path
    };

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

// ============================================================================
// File content helpers
// ============================================================================

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
            String::from_utf8_lossy(&old_output.stdout).to_string()
        } else {
            String::new()
        }
    };

    let new_content = if status == "deleted" {
        String::new()
    } else if include_uncommitted {
        let full_path = std::path::Path::new(worktree_path).join(path);
        tokio::fs::read_to_string(&full_path)
            .await
            .unwrap_or_default()
    } else {
        let new_output = tokio::process::Command::new("git")
            .arg("-C")
            .arg(worktree_path)
            .args(["show", &format!("HEAD:{}", path)])
            .output()
            .await
            .map_err(|e| format!("Failed to run git show: {}", e))?;
        if new_output.status.success() {
            String::from_utf8_lossy(&new_output.stdout).to_string()
        } else {
            String::new()
        }
    };

    Ok((old_content, new_content))
}

// ============================================================================
// Single-file command
// ============================================================================

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
        let row = db
            .get_worktree_for_task(&task_id)
            .map_err(|e| format!("Failed to get worktree for task: {}", e))?;
        row.ok_or_else(|| format!("No worktree found for task {}", task_id))?
            .worktree_path
    };

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

#[tauri::command]
pub async fn get_task_batch_file_contents(
    task_id: String,
    files: Vec<FileContentRequest>,
    include_uncommitted: bool,
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<(String, String)>, String> {
    let worktree_path = {
        let db = crate::db::acquire_db(&db);
        let row = db
            .get_worktree_for_task(&task_id)
            .map_err(|e| format!("Failed to get worktree for task: {}", e))?;
        row.ok_or_else(|| format!("No worktree found for task {}", task_id))?
            .worktree_path
    };

    // Compute merge-base ONCE for the entire batch.
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
    for file in &files {
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

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

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
}
