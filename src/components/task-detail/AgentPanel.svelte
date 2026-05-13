<script lang="ts">
  import { activeSessions } from '../../lib/stores'
  import { getLatestSession } from '../../lib/ipc'
  import AgentTerminalShell from './AgentTerminalShell.svelte'
  import { onMount } from 'svelte'

  interface Props {
    taskId: string
    isStarting?: boolean
  }

  let { taskId, isStarting = false }: Props = $props()

  const sharedStageLabels: Record<string, string> = {
    'read_ticket': 'reading ticket',
    'implement': 'implementing',
    'create_pr': 'creating PR',
    'address_comments': 'addressing comments',
  }

  const openCodeStageLabels: Record<string, string> = {
    'read_ticket': 'Reading Ticket',
    'implement': 'Implementing',
    'create_pr': 'Creating PR',
    'address_comments': 'Addressing Comments',
  }

  // Check the store first; if absent, try loading from DB once on mount.
  let session = $derived($activeSessions.get(taskId) || null)
  let provider = $derived(session?.provider ?? null)
  let checkedDb = $state(false)

  onMount(async () => {
    if (!session) {
      try {
        const dbSession = await getLatestSession(taskId)
        if (dbSession) {
          const updated = new Map($activeSessions)
          updated.set(taskId, dbSession)
          $activeSessions = updated
        }
      } catch (e) {
        console.error('[AgentPanel] Failed to load session from DB:', e)
      }
    }
    checkedDb = true
  })
</script>

{#if provider === 'claude-code'}
  <AgentTerminalShell
    {taskId}
    {isStarting}
    runningText="Claude agent running..."
    logPrefix="ClaudeAgentPanel"
    sessionIdKey="claude_session_id"
    stageLabels={sharedStageLabels}
  />
{:else if provider === 'pi'}
  <AgentTerminalShell
    {taskId}
    {isStarting}
    runningText="Pi agent running..."
    logPrefix="PiAgentPanel"
    sessionIdKey="pi_session_id"
    stageLabels={sharedStageLabels}
    rootTestId="pi-agent-panel"
  />
{:else if provider || checkedDb}
  <AgentTerminalShell
    {taskId}
    {isStarting}
    runningText="Agent running..."
    logPrefix="OpenCodeAgentPanel"
    sessionIdKey="opencode_session_id"
    stageLabels={openCodeStageLabels}
    rootTestId="opencode-agent-panel"
    loadSessionHistory
    markLifecycleExitedOnAbort
    stageLabelPrefix=""
    uppercaseSessionStatus={false}
    sessionStatusBadgeVariant="badge"
  />
{/if}
