<script lang="ts">
  import AgentTerminalShell from './AgentTerminalShell.svelte'

  interface Props {
    taskId: string
    isStarting?: boolean
  }

  let { taskId, isStarting = false }: Props = $props()

  const stageLabels: Record<string, string> = {
    'read_ticket': 'Reading Ticket',
    'implement': 'Implementing',
    'create_pr': 'Creating PR',
    'address_comments': 'Addressing Comments'
  }
</script>

<AgentTerminalShell
  {taskId}
  {isStarting}
  runningText="Agent running..."
  logPrefix="OpenCodeAgentPanel"
  sessionIdKey="opencode_session_id"
  {stageLabels}
  loadSessionHistory
  markLifecycleExitedOnAbort
  stageLabelPrefix=""
  uppercaseSessionStatus={false}
  sessionStatusBadgeVariant="badge"
/>
