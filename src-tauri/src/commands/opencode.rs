use std::sync::{Mutex, Arc};
use tauri::State;
use crate::opencode_client::OpenCodeClient;
use crate::server_manager;
use crate::db;

/// Get list of available agents from OpenCode server
#[tauri::command]
pub async fn get_agents(
    client: State<'_, OpenCodeClient>,
) -> Result<Vec<crate::opencode_client::AgentInfo>, String> {
    client
        .list_agents()
        .await
        .map_err(|e| format!("Failed to get agents: {}", e))
}

/// Create a new OpenCode session
#[tauri::command]
pub async fn create_session(
    client: State<'_, OpenCodeClient>,
    title: String,
) -> Result<String, String> {
    client
        .create_session(title)
        .await
        .map_err(|e| format!("Failed to create session: {}", e))
}

/// Send a prompt to an OpenCode session
#[tauri::command]
pub async fn send_prompt(
    client: State<'_, OpenCodeClient>,
    session_id: String,
    text: String,
) -> Result<serde_json::Value, String> {
    client
        .send_prompt(&session_id, text)
        .await
        .map_err(|e| format!("Failed to send prompt: {}", e))
}

/// List available commands from a running OpenCode server for the project
#[tauri::command]
pub async fn list_opencode_commands(
    db: State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    project_id: String,
) -> Result<Vec<crate::opencode_client::CommandInfo>, String> {
    // Get task IDs for the project
    let task_ids: Vec<String> = {
        let db = db.lock().unwrap();
        db.get_tasks_for_project(&project_id)
            .map_err(|e| format!("Failed to get tasks: {}", e))?
            .into_iter()
            .map(|t| t.id)
            .collect()
    };

    // Find any running server
    let port = match server_mgr.get_any_server_port_for_project(&task_ids).await {
        Some(p) => p,
        None => return Ok(vec![]),  // Graceful degradation
    };

    // Query the server
    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    client.list_commands().await
        .map_err(|e| format!("Failed to list commands: {}", e))
}

/// Search files in a running OpenCode server for the project
#[tauri::command]
pub async fn search_opencode_files(
    db: State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    project_id: String,
    query: String,
) -> Result<Vec<String>, String> {
    // Get task IDs for the project
    let task_ids: Vec<String> = {
        let db = db.lock().unwrap();
        db.get_tasks_for_project(&project_id)
            .map_err(|e| format!("Failed to get tasks: {}", e))?
            .into_iter()
            .map(|t| t.id)
            .collect()
    };

    // Find any running server
    let port = match server_mgr.get_any_server_port_for_project(&task_ids).await {
        Some(p) => p,
        None => return Ok(vec![]),  // Graceful degradation
    };

    // Query the server
    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    client.find_files(&query, true, 10).await
        .map_err(|e| format!("Failed to search files: {}", e))
}

/// List available agents from a running OpenCode server for the project
#[tauri::command]
pub async fn list_opencode_agents(
    db: State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    project_id: String,
) -> Result<Vec<crate::opencode_client::AgentInfo>, String> {
    // Get task IDs for the project
    let task_ids: Vec<String> = {
        let db = db.lock().unwrap();
        db.get_tasks_for_project(&project_id)
            .map_err(|e| format!("Failed to get tasks: {}", e))?
            .into_iter()
            .map(|t| t.id)
            .collect()
    };

    // Find any running server
    let port = match server_mgr.get_any_server_port_for_project(&task_ids).await {
        Some(p) => p,
        None => return Ok(vec![]),  // Graceful degradation
    };

    // Query the server
    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    client.list_agents().await
        .map_err(|e| format!("Failed to list agents: {}", e))
}

/// Parse SKILL.md frontmatter to extract name and description.
/// Frontmatter is YAML between `---` delimiters at the start of the file.
fn parse_skill_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (None, None);
    }
    // Find the closing ---
    let after_first = &trimmed[3..];
    let end_idx = match after_first.find("\n---") {
        Some(idx) => idx,
        None => return (None, None),
    };
    let frontmatter = &after_first[..end_idx];

    let mut name: Option<String> = None;
    let mut description = String::new();
    let mut in_description = false;

    for line in frontmatter.lines() {
        let trimmed_line = line.trim();
        if trimmed_line.starts_with("name:") {
            name = Some(trimmed_line.trim_start_matches("name:").trim().to_string());
            in_description = false;
        } else if trimmed_line.starts_with("description:") {
            let val = trimmed_line.trim_start_matches("description:").trim();
            if val == "|" || val == ">" || val.is_empty() {
                // Multi-line description follows
                in_description = true;
            } else {
                description = val.to_string();
            }
        } else if in_description {
            if !trimmed_line.is_empty() && (line.starts_with(' ') || line.starts_with('\t')) {
                if !description.is_empty() {
                    description.push(' ');
                }
                description.push_str(trimmed_line);
            } else {
                in_description = false;
            }
        }
    }

    let desc = if description.is_empty() { None } else { Some(description) };
    (name, desc)
}

/// Scan a skills directory (e.g. `.claude/skills/` or `.opencode/skills/`) for SKILL.md files.
/// Returns a Vec of SkillInfo with the given level.
fn scan_skills_directory(dir: &std::path::Path, level: &str) -> Vec<crate::opencode_client::SkillInfo> {
    let mut skills = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return skills,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_file = path.join("SKILL.md");
        if !skill_file.exists() {
            continue;
        }
        let content = match std::fs::read_to_string(&skill_file) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let dir_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let (fm_name, fm_desc) = parse_skill_frontmatter(&content);
        let name = fm_name.unwrap_or(dir_name);
        skills.push(crate::opencode_client::SkillInfo {
            name,
            description: fm_desc,
            agent: None,
            template: Some(content),
            level: level.to_string(),
        });
    }
    skills
}

/// List skills from OpenCode API + filesystem (.opencode/skills/ and .claude/skills/).
/// Merges results, deduplicating by name (API skills take precedence).
#[tauri::command]
pub async fn list_opencode_skills(
    db: State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    project_id: String,
) -> Result<Vec<crate::opencode_client::SkillInfo>, String> {
    // Get the project path for filesystem scanning and level detection
    let project_path = {
        let db = db.lock().unwrap();
        db.get_project(&project_id)
            .map_err(|e| format!("Failed to get project: {}", e))?
            .map(|p| p.path)
    };

    // Get task IDs for the project
    let task_ids: Vec<String> = {
        let db = db.lock().unwrap();
        db.get_tasks_for_project(&project_id)
            .map_err(|e| format!("Failed to get tasks: {}", e))?
            .into_iter()
            .map(|t| t.id)
            .collect()
    };

    // Collect skills from OpenCode API (if server is running)
    let mut skills_map = std::collections::HashMap::<String, crate::opencode_client::SkillInfo>::new();

    if let Some(port) = server_mgr.get_any_server_port_for_project(&task_ids).await {
        let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
        if let Ok(commands) = client.list_commands().await {
            for cmd in commands {
                if cmd.source.as_deref() != Some("skill") {
                    continue;
                }
                let template = cmd.extra.get("template")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let level = if let Some(ref proj_path) = project_path {
                    let project_skill_path = std::path::Path::new(proj_path)
                        .join(".opencode")
                        .join("skills")
                        .join(&cmd.name);
                    if project_skill_path.exists() {
                        "project".to_string()
                    } else {
                        "user".to_string()
                    }
                } else {
                    "user".to_string()
                };

                skills_map.insert(cmd.name.clone(), crate::opencode_client::SkillInfo {
                    name: cmd.name,
                    description: cmd.description,
                    agent: cmd.agent,
                    template,
                    level,
                });
            }
        }
    }

    // Scan .claude/skills/ and .opencode/skills/ on the filesystem
    // Project-level directories
    if let Some(ref proj_path) = project_path {
        let proj = std::path::Path::new(proj_path);
        for skills_dir in &[
            proj.join(".claude").join("skills"),
            proj.join(".opencode").join("skills"),
        ] {
            for skill in scan_skills_directory(skills_dir, "project") {
                skills_map.entry(skill.name.clone()).or_insert(skill);
            }
        }
    }

    // User-level directories
    if let Some(home) = dirs::home_dir() {
        for skills_dir in &[
            home.join(".claude").join("skills"),
            home.join(".opencode").join("skills"),
        ] {
            for skill in scan_skills_directory(skills_dir, "user") {
                skills_map.entry(skill.name.clone()).or_insert(skill);
            }
        }
    }

    // Collect and sort by name for stable ordering
    let mut skills: Vec<_> = skills_map.into_values().collect();
    skills.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(skills)
}
