use log::error;
use std::sync::{Mutex, Arc};
use tauri::{State, Emitter};
use crate::{db, server_manager::ServerManager, sse_bridge::SseBridgeManager, pty_manager::PtyManager, git_worktree};

#[tauri::command]
pub async fn get_tasks(
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<db::TaskRow>, String> {
    let db = crate::db::acquire_db(&db);
    db.get_all_tasks()
        .map_err(|e| format!("Failed to get tasks: {}", e))
}

#[tauri::command]
pub async fn get_work_queue_tasks(
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<db::WorkQueueTaskRow>, String> {
    let db = crate::db::acquire_db(&db);
    db.get_work_queue_tasks()
}

#[tauri::command]
pub async fn get_task_detail(
    db: State<'_, Arc<Mutex<db::Database>>>,
    task_id: String,
) -> Result<db::TaskRow, String> {
    let db = crate::db::acquire_db(&db);
    db.get_task(&task_id)
        .map_err(|e| format!("Failed to get task: {}", e))?
        .ok_or_else(|| format!("Task {} not found", task_id))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_task(
    db: State<'_, Arc<Mutex<db::Database>>>,
    app: tauri::AppHandle,
    initial_prompt: String,
    status: String,
    jira_key: Option<String>,
    project_id: Option<String>,
    prompt: Option<String>,
    agent: Option<String>,
    permission_mode: Option<String>,
) -> Result<db::TaskRow, String> {
    let db = crate::db::acquire_db(&db);
    let task = db.create_task(&initial_prompt, &status, jira_key.as_deref(), project_id.as_deref(), prompt.as_deref(), agent.as_deref(), permission_mode.as_deref())
        .map_err(|e| format!("Failed to create task: {}", e))?;
    let _ = app.emit("task-changed", serde_json::json!({ "action": "created", "task_id": task.id }));
    Ok(task)
}

#[tauri::command]
pub async fn update_task(
    db: State<'_, Arc<Mutex<db::Database>>>,
    app: tauri::AppHandle,
    id: String,
    initial_prompt: String,
    jira_key: Option<String>,
) -> Result<(), String> {
    let db = crate::db::acquire_db(&db);
    db.update_task(&id, &initial_prompt, jira_key.as_deref())
        .map_err(|e| format!("Failed to update task: {}", e))?;
    let _ = app.emit("task-changed", serde_json::json!({ "action": "updated", "task_id": id }));
    Ok(())
}

#[tauri::command]
pub async fn update_task_initial_prompt_and_summary(
    db: State<'_, Arc<Mutex<db::Database>>>,
    app: tauri::AppHandle,
    id: String,
    initial_prompt: Option<String>,
    summary: Option<String>,
) -> Result<(), String> {
    let db = crate::db::acquire_db(&db);
    db.update_task_title_and_summary(&id, initial_prompt.as_deref(), summary.as_deref())
        .map_err(|e| format!("Failed to update task initial prompt and summary: {}", e))?;
    let _ = app.emit("task-changed", serde_json::json!({ "action": "updated", "task_id": id }));
    Ok(())
}

#[tauri::command]
pub async fn update_task_status(
    db: State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: State<'_, ServerManager>,
    sse_mgr: State<'_, SseBridgeManager>,
    pty_mgr: State<'_, PtyManager>,
    app: tauri::AppHandle,
    id: String,
    status: String,
) -> Result<(), String> {
    {
        let db = crate::db::acquire_db(&db);
        db.update_task_status(&id, &status)
            .map_err(|e| format!("Failed to update task status: {}", e))?;
        if status == "done" {
            let _ = db.update_task_workspace_status(&id, "completed");
        }
    }
    let _ = app.emit("task-changed", serde_json::json!({ "action": "updated", "task_id": id }));

    if status == "done" {
        let _ = pty_mgr.kill_pty(&id).await;
        pty_mgr.kill_shells_for_task(&id).await;
        sse_mgr.stop_bridge(&id).await;
        let _ = server_mgr.stop_server(&id).await;

        let worktree = {
            let db_lock = crate::db::acquire_db(&db);
            db_lock
                .get_worktree_for_task(&id)
                .map_err(|e| format!("Failed to get worktree: {}", e))?
        };
        if let Some(worktree) = worktree {
            let repo_path = std::path::Path::new(&worktree.repo_path);
            let worktree_path = std::path::Path::new(&worktree.worktree_path);
            if let Err(e) = git_worktree::remove_worktree(repo_path, worktree_path).await {
                error!(
                    "[update_task_status] Failed to remove worktree at {}: {}",
                    worktree_path.display(),
                    e
                );
            }

            let db_lock = crate::db::acquire_db(&db);
            if let Err(e) = db_lock.delete_worktree_record(&id) {
                error!(
                    "[update_task_status] Failed to delete worktree record for {}: {}",
                    id, e
                );
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_task(
    db: State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: State<'_, ServerManager>,
    sse_mgr: State<'_, SseBridgeManager>,
    pty_mgr: State<'_, PtyManager>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let _ = pty_mgr.kill_pty(&id).await;
    pty_mgr.kill_shells_for_task(&id).await;
    sse_mgr.stop_bridge(&id).await;
    let _ = server_mgr.stop_server(&id).await;

    let worktree = {
        let db_lock = crate::db::acquire_db(&db);
        db_lock
            .get_worktree_for_task(&id)
            .map_err(|e| format!("Failed to get worktree: {}", e))?
    };
    if let Some(worktree) = worktree {
        let repo_path = std::path::Path::new(&worktree.repo_path);
        let worktree_path = std::path::Path::new(&worktree.worktree_path);
        if let Err(e) = git_worktree::remove_worktree_with_branch(repo_path, worktree_path, Some(&worktree.branch_name)).await {
            error!(
                "[delete_task] Failed to remove worktree at {}: {}",
                worktree_path.display(),
                e
            );
        }
    }

    let db_lock = crate::db::acquire_db(&db);
    db_lock
        .delete_task(&id)
        .map_err(|e| format!("Failed to delete task: {}", e))?;
    let _ = app.emit("task-changed", serde_json::json!({ "action": "deleted", "task_id": id }));
    Ok(())
}

#[tauri::command]
pub async fn clear_done_tasks(
    db: State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: State<'_, ServerManager>,
    sse_mgr: State<'_, SseBridgeManager>,
    pty_mgr: State<'_, PtyManager>,
    app: tauri::AppHandle,
    project_id: String,
) -> Result<u32, String> {
    let task_ids = {
        let db_lock = crate::db::acquire_db(&db);
        db_lock
            .get_task_ids_by_status(&project_id, "done")
            .map_err(|e| format!("Failed to get done tasks: {}", e))?
    };

    let mut deleted = 0u32;
    for id in &task_ids {
        let _ = pty_mgr.kill_pty(id).await;
        pty_mgr.kill_shells_for_task(id).await;
        sse_mgr.stop_bridge(id).await;
        let _ = server_mgr.stop_server(id).await;

        let worktree = {
            let db_lock = crate::db::acquire_db(&db);
            db_lock
                .get_worktree_for_task(id)
                .map_err(|e| format!("Failed to get worktree: {}", e))?
        };
        if let Some(worktree) = worktree {
            let repo_path = std::path::Path::new(&worktree.repo_path);
            let worktree_path = std::path::Path::new(&worktree.worktree_path);
            if let Err(e) = git_worktree::remove_worktree_with_branch(
                repo_path,
                worktree_path,
                Some(&worktree.branch_name),
            )
            .await
            {
                error!(
                    "[clear_done_tasks] Failed to remove worktree at {}: {}",
                    worktree_path.display(),
                    e
                );
            }
        }

        let db_lock = crate::db::acquire_db(&db);
        db_lock
            .delete_task(id)
            .map_err(|e| format!("Failed to delete task {}: {}", id, e))?;
        deleted += 1;
    }

    if deleted > 0 {
        let _ = app.emit(
            "task-changed",
            serde_json::json!({ "action": "cleared_done", "count": deleted }),
        );
    }

    Ok(deleted)
}
