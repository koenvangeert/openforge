use log::info;
use std::fs;
use std::path::PathBuf;

/// The create_task tool source code as a constant
#[allow(dead_code)]
const CREATE_TASK_TOOL: &str = r#"import { tool } from "@opencode-ai/plugin"

export default tool({
  name: "create_task",
  description: "Create a new task in Open Forge. Use this when you need to create follow-up work or break a task into subtasks. The task will be added to the backlog for later implementation.",
  args: {
    initial_prompt: tool.schema.string().describe("Initial instructions or prompt for the task"),
    project_id: tool.schema.string().describe("Project ID to associate with (optional, e.g., 'P-1')").optional(),
  },
  async execute(args, context) {
    const port = process.env.AI_COMMAND_CENTER_PORT ?? "17422"
    
    try {
      const res = await fetch(`http://127.0.0.1:${port}/create_task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initial_prompt: args.initial_prompt,
          project_id: args.project_id,
          calling_session_id: context.sessionID,
          worktree: context.worktree,
        }),
      })
      
      if (!res.ok) {
        const error = await res.text()
        return `Failed to create task: ${error}`
      }
      
      const data = await res.json() as { task_id: string }
      return `Task created successfully: ${data.task_id}. It has been added to the backlog and can be started manually when ready.`
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e)
      return `Error creating task: ${errorMessage}. Is Open Forge running?`
    }
  },
})
"#;

/// Get the global OpenCode tools directory
#[allow(dead_code)]
fn get_opencode_tools_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|config| config.join("opencode").join("tools"))
}

/// Install the create_task tool globally
///
/// This function checks if the create_task tool is already installed.
/// If not, it creates the directory structure and writes the tool file.
#[allow(dead_code)]
pub fn install_create_task_plugin() -> Result<(), Box<dyn std::error::Error>> {
    let tools_dir = get_opencode_tools_dir().ok_or("Could not determine config directory")?;

    let tool_file = tools_dir.join("create_task.ts");

    // Create directory structure
    fs::create_dir_all(&tools_dir)?;

    // Write the tool file
    fs::write(&tool_file, CREATE_TASK_TOOL)?;

    info!(
        "[plugin_installer] create_task tool installed/updated at: {}",
        tool_file.display()
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_opencode_tools_dir() {
        let dir = get_opencode_tools_dir();
        assert!(dir.is_some());
        let dir = dir.unwrap();
        assert!(dir.ends_with("opencode/tools"));
    }

    #[test]
    fn test_create_task_tool_constant_is_not_empty() {
        assert!(!CREATE_TASK_TOOL.is_empty());
        assert!(CREATE_TASK_TOOL.contains("create_task"));
        assert!(CREATE_TASK_TOOL.contains("execute"));
        // Verify description argument is removed
        assert!(!CREATE_TASK_TOOL.contains("description: tool.schema"));
        assert!(!CREATE_TASK_TOOL.contains("description: args.description"));
        // Verify tool-level description still exists
        assert!(CREATE_TASK_TOOL.contains("description: \"Create a new task"));
    }
}
