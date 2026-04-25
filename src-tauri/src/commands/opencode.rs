use crate::command_discovery::{scan_skills_directory, search_project_files};
use crate::db;
use crate::opencode_client::OpenCodeClient;
use crate::server_manager;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::State;

fn load_project_context(
    db: &State<'_, Arc<Mutex<db::Database>>>,
    project_id: &str,
) -> Result<(String, Option<String>), String> {
    let db = crate::db::acquire_db(db);
    let provider = db.resolve_ai_provider(project_id);
    let project_path = db
        .get_project(project_id)
        .map_err(|e| format!("Failed to get project: {}", e))?
        .map(|p| p.path);

    Ok((provider, project_path))
}

async fn ensure_project_discovery_server(
    db: &State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: &State<'_, server_manager::ServerManager>,
    project_id: &str,
) -> Result<Option<u16>, String> {
    let (provider, project_path) = load_project_context(db, project_id)?;
    if provider != "opencode" {
        return Ok(None);
    }

    let discovery_task_id = server_manager::discovery_server_task_id(project_id);
    if let Some(port) = server_mgr.get_server_port(&discovery_task_id).await {
        return Ok(Some(port));
    }

    let Some(project_path) = project_path else {
        return Ok(None);
    };

    let port = server_mgr
        .spawn_server(&discovery_task_id, Path::new(&project_path))
        .await
        .map_err(|e| format!("Failed to start discovery server: {}", e))?;

    Ok(Some(port))
}

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
    let provider = {
        let db = crate::db::acquire_db(&db);
        db.resolve_ai_provider(&project_id)
    };

    if provider == "claude-code" || provider == "pi" {
        let (_, project_path) = load_project_context(&db, &project_id)?;

        if provider == "pi" {
            let provider =
                crate::providers::pi::PiProvider::new(crate::pty_manager::PtyManager::new());
            return Ok(provider.list_commands(project_path.as_deref()));
        }

        let provider = crate::providers::claude_code::ClaudeCodeProvider::new(
            crate::pty_manager::PtyManager::new(),
        );
        return Ok(provider.list_commands(project_path.as_deref()));
    }

    let port = match ensure_project_discovery_server(&db, &server_mgr, &project_id).await? {
        Some(port) => port,
        None => return Ok(vec![]),
    };

    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    client
        .list_commands()
        .await
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
    let provider = {
        let db = crate::db::acquire_db(&db);
        db.resolve_ai_provider(&project_id)
    };

    if provider == "claude-code" || provider == "pi" {
        let (_, project_path) = load_project_context(&db, &project_id)?;

        if let Some(path) = project_path {
            return Ok(search_project_files(&path, &query, 10));
        }
        return Ok(vec![]);
    }

    let port = match ensure_project_discovery_server(&db, &server_mgr, &project_id).await? {
        Some(port) => port,
        None => return Ok(vec![]),
    };

    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    client
        .find_files(&query, true, 10)
        .await
        .map_err(|e| format!("Failed to search files: {}", e))
}

/// List available agents from a running OpenCode server for the project
#[tauri::command]
pub async fn list_opencode_agents(
    db: State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    project_id: String,
) -> Result<Vec<crate::opencode_client::AgentInfo>, String> {
    let provider = {
        let db = crate::db::acquire_db(&db);
        db.resolve_ai_provider(&project_id)
    };

    if provider == "claude-code" || provider == "pi" {
        let (_, project_path) = load_project_context(&db, &project_id)?;

        if provider == "pi" {
            let provider =
                crate::providers::pi::PiProvider::new(crate::pty_manager::PtyManager::new());
            return Ok(provider.list_agents(project_path.as_deref()));
        }

        let provider = crate::providers::claude_code::ClaudeCodeProvider::new(
            crate::pty_manager::PtyManager::new(),
        );
        return Ok(provider.list_agents(project_path.as_deref()));
    }

    let port = match ensure_project_discovery_server(&db, &server_mgr, &project_id).await? {
        Some(port) => port,
        None => return Ok(vec![]),
    };

    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    client
        .list_agents()
        .await
        .map_err(|e| format!("Failed to list agents: {}", e))
}

#[tauri::command]
pub async fn list_opencode_models(
    db: State<'_, Arc<Mutex<db::Database>>>,
    server_mgr: State<'_, server_manager::ServerManager>,
    project_id: String,
) -> Result<Vec<crate::opencode_client::ProviderModelInfo>, String> {
    let port = match ensure_project_discovery_server(&db, &server_mgr, &project_id).await? {
        Some(port) => port,
        None => return Ok(vec![]),
    };

    let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
    client
        .list_providers()
        .await
        .map_err(|e| format!("Failed to list models: {}", e))
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
    let (_, project_path) = load_project_context(&db, &project_id)?;

    // Collect skills from OpenCode API (if server is running)
    let mut skills_map =
        std::collections::HashMap::<String, crate::opencode_client::SkillInfo>::new();

    if let Some(port) = ensure_project_discovery_server(&db, &server_mgr, &project_id).await? {
        let client = OpenCodeClient::with_base_url(format!("http://127.0.0.1:{}", port));
        if let Ok(commands) = client.list_commands().await {
            for cmd in commands {
                if cmd.source.as_deref() != Some("skill") {
                    continue;
                }
                let template = cmd
                    .extra
                    .get("template")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let (level, source_dir) = if let Some(ref proj_path) = project_path {
                    let proj = std::path::Path::new(proj_path);
                    // Check project-level directories to determine level and source
                    if proj.join(".agents").join("skills").join(&cmd.name).exists() {
                        ("project".to_string(), ".agents".to_string())
                    } else if proj.join(".claude").join("skills").join(&cmd.name).exists() {
                        ("project".to_string(), ".claude".to_string())
                    } else if proj
                        .join(".opencode")
                        .join("skills")
                        .join(&cmd.name)
                        .exists()
                    {
                        ("project".to_string(), ".opencode".to_string())
                    } else {
                        // Skill is user-level; detect source from home dirs
                        let home_source = dirs::home_dir().and_then(|home| {
                            for src in &[".agents", ".claude", ".opencode"] {
                                if home.join(src).join("skills").join(&cmd.name).exists() {
                                    return Some(src.to_string());
                                }
                            }
                            None
                        });
                        (
                            "user".to_string(),
                            home_source.unwrap_or_else(|| ".opencode".to_string()),
                        )
                    }
                } else {
                    ("user".to_string(), ".opencode".to_string())
                };

                skills_map.insert(
                    cmd.name.clone(),
                    crate::opencode_client::SkillInfo {
                        name: cmd.name,
                        description: cmd.description,
                        agent: cmd.agent,
                        template,
                        level,
                        source_dir,
                    },
                );
            }
        }
    }

    // Scan skills directories on the filesystem
    // Project-level directories
    if let Some(ref proj_path) = project_path {
        let proj = std::path::Path::new(proj_path);
        for (dir, source) in &[
            (proj.join(".agents").join("skills"), ".agents"),
            (proj.join(".claude").join("skills"), ".claude"),
            (proj.join(".opencode").join("skills"), ".opencode"),
        ] {
            for skill in scan_skills_directory(dir, "project", source) {
                skills_map.entry(skill.name.clone()).or_insert(skill);
            }
        }
    }

    // User-level directories
    if let Some(home) = dirs::home_dir() {
        for (dir, source) in &[
            (home.join(".agents").join("skills"), ".agents"),
            (home.join(".claude").join("skills"), ".claude"),
            (home.join(".opencode").join("skills"), ".opencode"),
        ] {
            for skill in scan_skills_directory(dir, "user", source) {
                skills_map.entry(skill.name.clone()).or_insert(skill);
            }
        }
    }

    // Collect and sort by name for stable ordering
    let mut skills: Vec<_> = skills_map.into_values().collect();
    skills.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(skills)
}

/// Save a skill's SKILL.md content to disk.
/// Resolves the file path from level (project/user), source_dir (.claude/.opencode/.agents), and skill name.
#[tauri::command]
pub async fn save_skill_content(
    db: State<'_, Arc<Mutex<db::Database>>>,
    project_id: String,
    skill_name: String,
    level: String,
    source_dir: String,
    content: String,
) -> Result<(), String> {
    let skill_dir = if level == "project" {
        let project_path = {
            let db = crate::db::acquire_db(&db);
            db.get_project(&project_id)
                .map_err(|e| format!("Failed to get project: {}", e))?
                .map(|p| p.path)
                .ok_or_else(|| "Project not found".to_string())?
        };
        std::path::PathBuf::from(project_path)
            .join(&source_dir)
            .join("skills")
            .join(&skill_name)
    } else {
        dirs::home_dir()
            .ok_or_else(|| "Cannot determine home directory".to_string())?
            .join(&source_dir)
            .join("skills")
            .join(&skill_name)
    };

    let skill_file = skill_dir.join("SKILL.md");

    // Ensure the directory exists
    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create skill directory: {}", e))?;

    std::fs::write(&skill_file, content)
        .map_err(|e| format!("Failed to write skill file: {}", e))?;

    Ok(())
}
