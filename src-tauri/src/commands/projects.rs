use crate::db;
use std::sync::{Arc, Mutex};
use tauri::State;

fn task_workspace_from_legacy(
    workspace: db::WorktreeRow,
    provider_name: String,
) -> db::TaskWorkspaceRow {
    db::TaskWorkspaceRow {
        id: workspace.id,
        task_id: workspace.task_id,
        project_id: workspace.project_id,
        workspace_path: workspace.worktree_path,
        repo_path: workspace.repo_path,
        kind: "git_worktree".to_string(),
        branch_name: Some(workspace.branch_name),
        provider_name,
        opencode_port: workspace.opencode_port,
        status: workspace.status,
        created_at: workspace.created_at,
        updated_at: workspace.updated_at,
    }
}

fn legacy_worktree_from_task_workspace(workspace: db::TaskWorkspaceRow) -> db::WorktreeRow {
    db::WorktreeRow {
        id: workspace.id,
        task_id: workspace.task_id,
        project_id: workspace.project_id,
        repo_path: workspace.repo_path,
        worktree_path: workspace.workspace_path,
        branch_name: workspace.branch_name.unwrap_or_default(),
        opencode_port: workspace.opencode_port,
        opencode_pid: None,
        status: workspace.status,
        created_at: workspace.created_at,
        updated_at: workspace.updated_at,
    }
}

#[tauri::command]
pub async fn create_project(
    db: State<'_, Arc<Mutex<db::Database>>>,
    name: String,
    path: String,
) -> Result<db::ProjectRow, String> {
    let db = crate::db::acquire_db(&db);
    db.create_project(&name, &path)
        .map_err(|e| format!("Failed to create project: {}", e))
}

#[tauri::command]
pub async fn get_projects(
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<db::ProjectRow>, String> {
    let db = crate::db::acquire_db(&db);
    db.get_all_projects()
        .map_err(|e| format!("Failed to get projects: {}", e))
}

#[tauri::command]
pub async fn update_project(
    db: State<'_, Arc<Mutex<db::Database>>>,
    id: String,
    name: String,
    path: String,
) -> Result<(), String> {
    let db = crate::db::acquire_db(&db);
    db.update_project(&id, &name, &path)
        .map_err(|e| format!("Failed to update project: {}", e))
}

#[tauri::command]
pub async fn delete_project(
    db: State<'_, Arc<Mutex<db::Database>>>,
    id: String,
) -> Result<(), String> {
    let db = crate::db::acquire_db(&db);
    db.delete_project(&id)
        .map_err(|e| format!("Failed to delete project: {}", e))
}

#[tauri::command]
pub async fn get_project_config(
    db: State<'_, Arc<Mutex<db::Database>>>,
    project_id: String,
    key: String,
) -> Result<Option<String>, String> {
    let db = crate::db::acquire_db(&db);
    db.get_project_config(&project_id, &key)
        .map_err(|e| format!("Failed to get project config: {}", e))
}

#[tauri::command]
pub async fn set_project_config(
    db: State<'_, Arc<Mutex<db::Database>>>,
    project_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let db = crate::db::acquire_db(&db);
    db.set_project_config(&project_id, &key, &value)
        .map_err(|e| format!("Failed to set project config: {}", e))
}

#[tauri::command]
pub async fn get_tasks_for_project(
    db: State<'_, Arc<Mutex<db::Database>>>,
    project_id: String,
) -> Result<Vec<db::TaskRow>, String> {
    let db = crate::db::acquire_db(&db);
    db.get_tasks_for_project(&project_id)
        .map_err(|e| format!("Failed to get tasks for project: {}", e))
}

#[tauri::command]
pub async fn get_worktree_for_task(
    db: State<'_, Arc<Mutex<db::Database>>>,
    task_id: String,
) -> Result<Option<db::WorktreeRow>, String> {
    let db = crate::db::acquire_db(&db);
    if let Some(worktree) = db
        .get_worktree_for_task(&task_id)
        .map_err(|e| format!("Failed to get worktree for task: {}", e))?
    {
        return Ok(Some(worktree));
    }

    let workspace = db
        .get_task_workspace_for_task(&task_id)
        .map_err(|e| format!("Failed to get task workspace for task: {}", e))?;
    Ok(workspace.map(legacy_worktree_from_task_workspace))
}

#[tauri::command]
pub async fn get_task_workspace(
    db: State<'_, Arc<Mutex<db::Database>>>,
    task_id: String,
) -> Result<Option<db::TaskWorkspaceRow>, String> {
    let db = crate::db::acquire_db(&db);
    if let Some(workspace) = db
        .get_task_workspace_for_task(&task_id)
        .map_err(|e| format!("Failed to get task workspace for task: {}", e))?
    {
        return Ok(Some(workspace));
    }

    let provider_name = db
        .get_latest_session_for_ticket(&task_id)
        .map_err(|e| {
            format!(
                "Failed to get latest session for task workspace fallback: {}",
                e
            )
        })?
        .map(|session| session.provider)
        .unwrap_or_else(|| "unknown".to_string());

    let worktree = db
        .get_worktree_for_task(&task_id)
        .map_err(|e| format!("Failed to get worktree for task workspace fallback: {}", e))?;
    Ok(worktree.map(|workspace| task_workspace_from_legacy(workspace, provider_name)))
}

#[tauri::command]
pub async fn get_project_attention(
    db: State<'_, Arc<Mutex<db::Database>>>,
) -> Result<Vec<db::ProjectAttentionRow>, String> {
    let db = crate::db::acquire_db(&db);
    db.get_project_attention_summaries()
        .map_err(|e| format!("Failed to get project attention: {}", e))
}
