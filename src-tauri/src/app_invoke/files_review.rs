use super::*;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppFileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: Option<u64>,
    modified_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppFileContent {
    r#type: String,
    content: String,
    mime_type: Option<String>,
    size: u64,
}

fn app_task_workspace_path(
    state: &AppState,
    task_id: &str,
) -> Result<String, (StatusCode, String)> {
    let db = crate::db::acquire_db(&state.db);
    crate::self_review_runtime::resolve_workspace_path(&db, task_id)
        .map_err(|e| (StatusCode::NOT_FOUND, e))
}

fn app_project_root(state: &AppState, project_id: &str) -> Result<String, (StatusCode, String)> {
    let db = crate::db::acquire_db(&state.db);
    db.get_project(project_id)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {e}"),
            )
        })?
        .map(|project| project.path)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                format!("Project not found: {project_id}"),
            )
        })
}

fn app_resolve_project_path(
    project_root: &std::path::Path,
    sub_path: Option<&str>,
) -> Result<std::path::PathBuf, (StatusCode, String)> {
    let resolved = match sub_path {
        None | Some("") => project_root.to_path_buf(),
        Some(path) => project_root.join(path),
    };

    let canonical_root = std::fs::canonicalize(project_root).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("Failed to canonicalize project root: {e}"),
        )
    })?;
    let canonical_resolved = std::fs::canonicalize(&resolved).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("Failed to canonicalize path: {e}"),
        )
    })?;

    if !canonical_resolved.starts_with(&canonical_root) {
        return Err((
            StatusCode::FORBIDDEN,
            "Path traversal detected: access denied".to_string(),
        ));
    }

    Ok(canonical_resolved)
}

fn app_file_type_key(path: &std::path::Path) -> String {
    if let Some(ext) = path.extension().and_then(|ext| ext.to_str()) {
        return ext.to_ascii_lowercase();
    }

    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .trim_start_matches('.')
        .to_ascii_lowercase()
}

fn app_detect_file_type(path: &std::path::Path) -> &'static str {
    let key = app_file_type_key(path);
    match key.as_str() {
        "ts" | "tsx" | "js" | "jsx" | "rs" | "py" | "rb" | "go" | "json" | "yaml" | "yml"
        | "md" | "txt" | "toml" | "css" | "html" | "svelte" | "vue" | "sh" | "bash" | "zsh"
        | "sql" | "graphql" | "xml" | "csv" | "env" | "gitignore" | "prettierrc" | "eslintrc"
        | "cfg" | "ini" | "conf" | "log" | "lock" => "text",
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "ico" | "bmp" => "image",
        "pdf" => "document",
        _ => "binary",
    }
}

fn app_mime_type(path: &std::path::Path) -> Option<String> {
    let key = app_file_type_key(path);
    let mime = match key.as_str() {
        "ts" | "tsx" => "text/typescript",
        "js" | "jsx" => "application/javascript",
        "rs" => "text/rust",
        "py" => "text/python",
        "rb" => "text/ruby",
        "go" => "text/go",
        "json" => "application/json",
        "yaml" | "yml" => "application/yaml",
        "md" => "text/markdown",
        "txt" => "text/plain",
        "toml" => "text/toml",
        "css" => "text/css",
        "html" => "text/html",
        "svelte" => "text/svelte",
        "vue" => "text/vue",
        "sh" | "bash" | "zsh" => "text/shell",
        "sql" => "text/sql",
        "graphql" => "text/graphql",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "env" | "gitignore" | "prettierrc" | "eslintrc" => "text/plain",
        "cfg" | "ini" | "conf" => "text/plain",
        "log" => "text/plain",
        "lock" => "text/plain",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "pdf" => "application/pdf",
        _ => return None,
    };
    Some(mime.to_string())
}

async fn app_read_file_preview(
    full_path: &std::path::Path,
) -> Result<AppFileContent, (StatusCode, String)> {
    let metadata = tokio::fs::metadata(full_path).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read file metadata: {e}"),
        )
    })?;
    if metadata.is_dir() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Path is a directory, not a file".to_string(),
        ));
    }

    let size = metadata.len();
    let mime_type = app_mime_type(full_path);
    match app_detect_file_type(full_path) {
        "text" => {
            const MAX_TEXT_SIZE: u64 = 1_048_576;
            if size > MAX_TEXT_SIZE {
                return Ok(AppFileContent {
                    r#type: "large-file".to_string(),
                    content: String::new(),
                    mime_type,
                    size,
                });
            }
            let bytes = tokio::fs::read(full_path).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to read file: {e}"),
                )
            })?;
            let content = String::from_utf8(bytes).map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    format!("File is not valid UTF-8: {e}"),
                )
            })?;
            Ok(AppFileContent {
                r#type: "text".to_string(),
                content,
                mime_type,
                size,
            })
        }
        "image" => {
            let bytes = tokio::fs::read(full_path).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to read file: {e}"),
                )
            })?;
            use base64::Engine;
            Ok(AppFileContent {
                r#type: "image".to_string(),
                content: base64::engine::general_purpose::STANDARD.encode(bytes),
                mime_type,
                size,
            })
        }
        file_type => Ok(AppFileContent {
            r#type: file_type.to_string(),
            content: String::new(),
            mime_type,
            size,
        }),
    }
}

pub(super) fn app_agent_review_live_blocker(
    command: &str,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    Err((
        StatusCode::NOT_IMPLEMENTED,
        format!("app IPC command requires provider runtime state before Electron sidecar support: {command}"),
    ))
}

pub(super) async fn handle_app_files_review_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    let value = match request.command.as_str() {
        "fs_read_dir" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let dir_path = payload_optional_string(&request.payload, "dirPath")?;
            let project_root = app_project_root(state, &project_id)?;
            let project_root = std::path::Path::new(&project_root);
            let dir_to_read = app_resolve_project_path(project_root, dir_path.as_deref())?;
            let mut read_dir = tokio::fs::read_dir(&dir_to_read).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to read directory: {e}"),
                )
            })?;
            let mut dirs = Vec::new();
            let mut files = Vec::new();
            while let Some(entry) = read_dir.next_entry().await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Error reading directory entry: {e}"),
                )
            })? {
                let metadata = match entry.metadata().await {
                    Ok(metadata) => metadata,
                    Err(_) => continue,
                };
                let name = entry.file_name().to_string_lossy().to_string();
                let full_path = entry.path();
                let path = full_path
                    .strip_prefix(project_root)
                    .map(|path| path.to_string_lossy().to_string())
                    .unwrap_or_else(|_| name.clone());
                let is_dir = metadata.is_dir();
                let modified_at = metadata.modified().ok().and_then(|time| {
                    time.duration_since(std::time::UNIX_EPOCH)
                        .ok()
                        .map(|duration| duration.as_millis() as u64)
                });
                let entry = AppFileEntry {
                    name,
                    path,
                    is_dir,
                    size: if is_dir { None } else { Some(metadata.len()) },
                    modified_at,
                };
                if is_dir {
                    dirs.push(entry)
                } else {
                    files.push(entry)
                }
            }
            dirs.sort_by(|left, right| left.name.cmp(&right.name));
            files.sort_by(|left, right| left.name.cmp(&right.name));
            dirs.extend(files);
            json_value(dirs)?
        }
        "fs_read_file" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let file_path = payload_string(&request.payload, "filePath")?;
            let project_root = app_project_root(state, &project_id)?;
            let full_path =
                app_resolve_project_path(std::path::Path::new(&project_root), Some(&file_path))?;
            json_value(app_read_file_preview(&full_path).await?)?
        }
        "fs_search_files" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let query = payload_string(&request.payload, "query")?;
            let limit = payload_optional_usize(&request.payload, "limit")?.unwrap_or(50);
            let project_root = match app_project_root(state, &project_id) {
                Ok(path) => path,
                Err((StatusCode::NOT_FOUND, _)) => return Ok(Some(serde_json::json!([]))),
                Err(error) => return Err(error),
            };
            if project_root.is_empty() {
                serde_json::json!([])
            } else {
                json_value(crate::command_discovery::search_project_files(
                    &project_root,
                    &query,
                    limit,
                ))?
            }
        }
        "add_self_review_comment" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let comment_type = payload_string(&request.payload, "commentType")?;
            let file_path = payload_optional_string(&request.payload, "filePath")?;
            let line_number = payload_optional_i32(&request.payload, "lineNumber")?;
            let body = payload_string(&request.payload, "body")?;
            let db = crate::db::acquire_db(&state.db);
            json_value(
                db.insert_self_review_comment(
                    &task_id,
                    &comment_type,
                    file_path.as_deref(),
                    line_number,
                    &body,
                )
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to add self review comment: {e}"),
                    )
                })?,
            )?
        }
        "get_active_self_review_comments" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let db = crate::db::acquire_db(&state.db);
            json_value(db.get_active_self_review_comments(&task_id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get active self review comments: {e}"),
                )
            })?)?
        }
        "get_archived_self_review_comments" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let db = crate::db::acquire_db(&state.db);
            json_value(
                db.get_archived_self_review_comments(&task_id)
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to get archived self review comments: {e}"),
                        )
                    })?,
            )?
        }
        "delete_self_review_comment" => {
            let comment_id = payload_i64(&request.payload, "commentId")?;
            let db = crate::db::acquire_db(&state.db);
            db.delete_self_review_comment(comment_id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to delete self review comment: {e}"),
                )
            })?;
            serde_json::Value::Null
        }
        "archive_self_review_comments" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let db = crate::db::acquire_db(&state.db);
            db.archive_self_review_comments(&task_id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to archive self review comments: {e}"),
                )
            })?;
            serde_json::Value::Null
        }
        "get_agent_review_comments" => {
            let review_pr_id = payload_i64(&request.payload, "reviewPrId")?;
            let db = crate::db::acquire_db(&state.db);
            json_value(
                db.get_agent_review_comments_for_pr(review_pr_id)
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to get agent review comments: {e}"),
                        )
                    })?,
            )?
        }
        "update_agent_review_comment_status" => {
            let comment_id = payload_i64(&request.payload, "commentId")?;
            let status = payload_string(&request.payload, "status")?;
            let db = crate::db::acquire_db(&state.db);
            db.update_agent_review_comment_status(comment_id, &status)
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to update agent review comment status: {e}"),
                    )
                })?;
            serde_json::Value::Null
        }
        "dismiss_all_agent_review_comments" => {
            let review_pr_id = payload_i64(&request.payload, "reviewPrId")?;
            let db = crate::db::acquire_db(&state.db);
            db.delete_agent_review_comments_for_pr(review_pr_id)
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to dismiss all agent review comments: {e}"),
                    )
                })?;
            serde_json::Value::Null
        }
        "get_task_diff" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let include_uncommitted = payload_bool(&request.payload, "includeUncommitted")?;
            let worktree_path = app_task_workspace_path(state, &task_id)?;
            json_value(
                crate::self_review_runtime::get_task_diff_for_workspace(
                    &worktree_path,
                    include_uncommitted,
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?,
            )?
        }
        "get_task_file_contents" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let path = payload_string(&request.payload, "path")?;
            let old_path = payload_optional_string(&request.payload, "oldPath")?;
            let status = payload_string(&request.payload, "status")?;
            let include_uncommitted = payload_bool(&request.payload, "includeUncommitted")?;
            let worktree_path = app_task_workspace_path(state, &task_id)?;
            json_value(
                crate::self_review_runtime::get_task_file_contents_for_workspace(
                    &worktree_path,
                    &path,
                    old_path.as_deref(),
                    &status,
                    include_uncommitted,
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?,
            )?
        }
        "get_task_batch_file_contents" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let files = payload_field::<Vec<crate::self_review_runtime::FileContentRequest>>(
                &request.payload,
                "files",
            )?;
            let include_uncommitted = payload_bool(&request.payload, "includeUncommitted")?;
            let worktree_path = app_task_workspace_path(state, &task_id)?;
            json_value(
                crate::self_review_runtime::get_task_batch_file_contents_for_workspace(
                    &worktree_path,
                    &files,
                    include_uncommitted,
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?,
            )?
        }
        "get_task_commits" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let worktree_path = app_task_workspace_path(state, &task_id)?;
            json_value(
                crate::self_review_runtime::get_task_commits_for_workspace(&worktree_path)
                    .await
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?,
            )?
        }
        "get_commit_diff" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let commit_sha = payload_string(&request.payload, "commitSha")?;
            let worktree_path = app_task_workspace_path(state, &task_id)?;
            json_value(
                crate::self_review_runtime::get_commit_diff_for_workspace(
                    &worktree_path,
                    &commit_sha,
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?,
            )?
        }
        "get_commit_file_contents" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let commit_sha = payload_string(&request.payload, "commitSha")?;
            let path = payload_string(&request.payload, "path")?;
            let old_path = payload_optional_string(&request.payload, "oldPath")?;
            let status = payload_string(&request.payload, "status")?;
            let worktree_path = app_task_workspace_path(state, &task_id)?;
            json_value(
                crate::self_review_runtime::get_commit_file_contents_for_workspace(
                    &worktree_path,
                    &commit_sha,
                    &path,
                    old_path.as_deref(),
                    &status,
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?,
            )?
        }
        "get_commit_batch_file_contents" => {
            let task_id = payload_string(&request.payload, "taskId")?;
            let commit_sha = payload_string(&request.payload, "commitSha")?;
            let files = payload_field::<Vec<crate::self_review_runtime::FileContentRequest>>(
                &request.payload,
                "files",
            )?;
            let worktree_path = app_task_workspace_path(state, &task_id)?;
            json_value(
                crate::self_review_runtime::get_commit_batch_file_contents_for_workspace(
                    &worktree_path,
                    &commit_sha,
                    &files,
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?,
            )?
        }
        "start_agent_review" | "abort_agent_review" => {
            return app_agent_review_live_blocker(&request.command)
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}
