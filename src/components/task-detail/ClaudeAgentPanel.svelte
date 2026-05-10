<script lang="ts">
  import AgentTerminalShell from './AgentTerminalShell.svelte'

  interface Props {
    taskId: string
    isStarting?: boolean
  }

  let { taskId, isStarting = false }: Props = $props()

  const stageLabels: Record<string, string> = {
    'read_ticket': 'reading ticket',
    'implement': 'implementing',
    'create_pr': 'creating PR',
    'address_comments': 'addressing comments',
  }
</script>

<AgentTerminalShell
  {taskId}
  {isStarting}
  runningText="Claude agent running..."
  logPrefix="ClaudeAgentPanel"
  sessionIdKey="claude_session_id"
  {stageLabels}
/>
