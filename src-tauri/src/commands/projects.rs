use std::sync::Mutex;
use tauri::State;
use crate::db;

#[tauri::command]
pub async fn create_project(
    db: State<'_, Mutex<db::Database>>,
    name: String,
    path: String,
) -> Result<db::ProjectRow, String> {
    let db = db.lock().unwrap();
    db.create_project(&name, &path)
        .map_err(|e| format!("Failed to create project: {}", e))
}

#[tauri::command]
pub async fn get_projects(
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<db::ProjectRow>, String> {
    let db = db.lock().unwrap();
    db.get_all_projects()
        .map_err(|e| format!("Failed to get projects: {}", e))
}

#[tauri::command]
pub async fn update_project(
    db: State<'_, Mutex<db::Database>>,
    id: String,
    name: String,
    path: String,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.update_project(&id, &name, &path)
        .map_err(|e| format!("Failed to update project: {}", e))
}

#[tauri::command]
pub async fn delete_project(
    db: State<'_, Mutex<db::Database>>,
    id: String,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.delete_project(&id)
        .map_err(|e| format!("Failed to delete project: {}", e))
}

#[tauri::command]
pub async fn get_project_config(
    db: State<'_, Mutex<db::Database>>,
    project_id: String,
    key: String,
) -> Result<Option<String>, String> {
    let db = db.lock().unwrap();
    db.get_project_config(&project_id, &key)
        .map_err(|e| format!("Failed to get project config: {}", e))
}

#[tauri::command]
pub async fn set_project_config(
    db: State<'_, Mutex<db::Database>>,
    project_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    db.set_project_config(&project_id, &key, &value)
        .map_err(|e| format!("Failed to set project config: {}", e))
}

#[tauri::command]
pub async fn get_tasks_for_project(
    db: State<'_, Mutex<db::Database>>,
    project_id: String,
) -> Result<Vec<db::TaskRow>, String> {
    let db = db.lock().unwrap();
    db.get_tasks_for_project(&project_id)
        .map_err(|e| format!("Failed to get tasks for project: {}", e))
}

#[tauri::command]
pub async fn get_worktree_for_task(
    db: State<'_, Mutex<db::Database>>,
    task_id: String,
) -> Result<Option<db::WorktreeRow>, String> {
    let db = db.lock().unwrap();
    db.get_worktree_for_task(&task_id)
        .map_err(|e| format!("Failed to get worktree for task: {}", e))
}


#[tauri::command]
pub async fn get_project_attention(
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<db::ProjectAttentionRow>, String> {
    let db = db.lock().unwrap();
    db.get_project_attention_summaries()
        .map_err(|e| format!("Failed to get project attention: {}", e))
}
