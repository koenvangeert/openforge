use std::fs;
use std::path::PathBuf;

/// The spawn_task tool source code as a constant
const SPAWN_TASK_TOOL: &str = r#"import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Spawn a new task in the AI Command Center. Use this when you need to create follow-up work or break a task into subtasks. The task will be added to the backlog for later implementation.",
  args: {
    title: tool.schema.string().describe("Short, descriptive title for the task (e.g., 'Implement user authentication')"),
    description: tool.schema.string().describe("Detailed description of what needs to be done. Will be stored as the task plan for later implementation."),
    project_id: tool.schema.string().describe("Project ID to associate with (optional, e.g., 'P-1')").optional(),
  },
  async execute(args, context) {
    const port = process.env.AI_COMMAND_CENTER_PORT ?? "17422"
    
    try {
      const res = await fetch(`http://127.0.0.1:${port}/spawn_task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: args.title,
          description: args.description,
          project_id: args.project_id,
          calling_session_id: context.sessionID,
          worktree: context.worktree,
        }),
      })
      
      if (!res.ok) {
        const error = await res.text()
        return `Failed to spawn task: ${error}`
      }
      
      const data = await res.json() as { task_id: string }
      return `Task created successfully: ${data.task_id}. It has been added to the backlog and can be started manually when ready.`
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e)
      return `Error spawning task: ${errorMessage}. Is the AI Command Center running?`
    }
  },
})
"#;

/// Get the global OpenCode plugins directory
fn get_opencode_plugins_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".opencode").join("plugins"))
}

/// Install the spawn-task plugin globally
///
/// This function checks if the spawn_task tool is already installed as a global plugin.
/// If not, it creates the directory structure and writes the tool file.
pub fn install_spawn_task_plugin() -> Result<(), Box<dyn std::error::Error>> {
    let plugins_dir = get_opencode_plugins_dir().ok_or("Could not determine home directory")?;

    let plugin_dir = plugins_dir.join("spawn-task");
    let plugin_file = plugin_dir.join("index.ts");

    // Check if already installed
    if plugin_file.exists() {
        println!("[plugin_installer] spawn-task plugin already installed");
        return Ok(());
    }

    // Create directory structure
    fs::create_dir_all(&plugin_dir)?;

    // Write the plugin file
    fs::write(&plugin_file, SPAWN_TASK_TOOL)?;

    println!(
        "[plugin_installer] spawn-task plugin installed at: {}",
        plugin_file.display()
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_opencode_plugins_dir() {
        let dir = get_opencode_plugins_dir();
        assert!(dir.is_some());
        let dir = dir.unwrap();
        assert!(dir.ends_with(".opencode/plugins"));
    }

    #[test]
    fn test_spawn_task_tool_constant_is_not_empty() {
        assert!(!SPAWN_TASK_TOOL.is_empty());
        assert!(SPAWN_TASK_TOOL.contains("spawn_task"));
        assert!(SPAWN_TASK_TOOL.contains("execute"));
    }
}
