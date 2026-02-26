import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Spawn a new task in the AI Command Center. Use this when you need to create follow-up work or break a task into subtasks. The task will be added to the backlog for later implementation.",
  args: {
    title: tool.schema.string().describe("Short, descriptive title for the task (e.g., 'Implement user authentication')"),
    description: tool.schema.string().describe("Detailed description of what needs to be done. Will be stored as the task plan for later implementation."),
    project_id: tool.schema.string().describe("Project ID to associate with (optional, e.g., 'P-1')").optional(),
  },
  async execute(args, context) {
    // Get port from environment or use default
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
