<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte'
  import type { DesktopUnlistenFn } from '../../lib/desktopIpc'
  import { activeSessions } from '../../lib/stores'
  import '@xterm/xterm/css/xterm.css'
  import { listenToAgentStatusChanged, type AgentPanelStatus } from '../../lib/agentPanelSessionSync'
  import { acquire, attach, detach, isValidTerminalDimensions, type PoolEntry } from '../../lib/terminalPool'
  import {
    abortAgentTerminalSession,
    getAgentSessionStatusBadgeClass,
    getAgentStageLabel,
    getAgentStatusText,
    markAgentTerminalExited,
    syncAgentPanelStatusFromSession,
    writeAgentTerminalTranscription,
    type AgentStageLabels,
    type AgentSessionStatusBadgeVariant,
  } from '../../lib/agentTerminalPanel'
  import VoiceInput from '../shared/input/VoiceInput.svelte'
  import { getAgentResumeCommand, type AgentResumeCommandProvider } from '../../lib/agentResumeCommand'
  import { parseCheckpointQuestion } from '../../lib/parseCheckpoint'
  import { createSessionHistory } from '../../lib/useSessionHistory.svelte'

  type ProviderSessionIdKey = 'opencode_session_id' | 'claude_session_id' | 'pi_session_id'

  interface Props {
    taskId: string
    runningText: string
    logPrefix: string
    sessionIdKey: ProviderSessionIdKey
    stageLabels: AgentStageLabels
    isStarting?: boolean
    rootTestId?: string | null
    loadSessionHistory?: boolean
    markLifecycleExitedOnAbort?: boolean
    stageLabelPrefix?: string
    uppercaseSessionStatus?: boolean
    sessionStatusBadgeVariant?: AgentSessionStatusBadgeVariant
  }

  let {
    taskId,
    runningText,
    logPrefix,
    sessionIdKey,
    stageLabels,
    isStarting = false,
    rootTestId = null,
    loadSessionHistory = false,
    markLifecycleExitedOnAbort = false,
    stageLabelPrefix = '// ',
    uppercaseSessionStatus = true,
    sessionStatusBadgeVariant = 'soft',
  }: Props = $props()

  let terminalEl: HTMLDivElement
  let unlisteners: DesktopUnlistenFn[] = []
  let poolEntry: PoolEntry | null = null
  let poolEntryAttached = $state(false)
  let status = $state<AgentPanelStatus>('idle')
  let terminalActive = $state(false)
  let destroyed = false

  const sessionHistory = createSessionHistory({
    taskId: untrack(() => taskId),
    onStatusUpdate: (nextStatus) => {
      status = nextStatus
      if ((nextStatus === 'complete' || nextStatus === 'error') && poolEntry) {
        markAgentTerminalExited(taskId, poolEntry.currentPtyInstance)
      }
    },
  })

  let session = $derived($activeSessions.get(taskId) || null)
  let providerSessionId = $derived(session ? session[sessionIdKey] : null)
  let resumeCommandProvider: AgentResumeCommandProvider = $derived(
    sessionIdKey === 'opencode_session_id'
      ? 'opencode'
      : sessionIdKey === 'claude_session_id'
        ? 'claude-code'
        : 'pi'
  )
  let resumeCommand = $derived(getAgentResumeCommand(resumeCommandProvider, providerSessionId))
  let checkpointQuestion = $derived(
    sessionIdKey === 'opencode_session_id' && session?.status === 'paused'
      ? parseCheckpointQuestion(session.checkpoint_data)
      : null
  )

  function syncStatusFromSession(sessionStatus: string | null | undefined) {
    syncAgentPanelStatusFromSession({
      taskId,
      sessionStatus,
      setStatus: (nextStatus) => { status = nextStatus },
      setTerminalActive: (active) => { terminalActive = active },
    })
  }

  $effect(() => {
    syncStatusFromSession(session?.status)
  })

  let previousCheckpointQuestion: string | null = null

  $effect(() => {
    const nextCheckpointQuestion = checkpointQuestion
    const entryReady = poolEntryAttached
    const shouldRefitForCheckpointLayout = sessionIdKey === 'opencode_session_id' && entryReady && poolEntry && (
      nextCheckpointQuestion !== null || previousCheckpointQuestion !== null
    )

    previousCheckpointQuestion = nextCheckpointQuestion

    if (!shouldRefitForCheckpointLayout) return

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!poolEntry) return
        const proposed = poolEntry.fitAddon.proposeDimensions()
        if (isValidTerminalDimensions(proposed)) {
          poolEntry.fitAddon.fit()
        }
      })
    })
  })

  onMount(async () => {
    poolEntry = await acquire(taskId)
    if (destroyed || !poolEntry) return
    await attach(poolEntry, terminalEl)
    if (destroyed) return
    poolEntryAttached = true

    syncStatusFromSession(session?.status)

    if (loadSessionHistory) {
      await sessionHistory.loadSessionHistory()
    }

    unlisteners.push(await listenToAgentStatusChanged({
      taskId,
      setStatus: (nextStatus) => { status = nextStatus },
      onRunning: () => { syncStatusFromSession('running') },
    }))
  })

  onDestroy(() => {
    destroyed = true
    unlisteners.forEach((fn) => {
      fn()
    })
    poolEntryAttached = false
    if (poolEntry) {
      detach(poolEntry)
    }
  })

  async function handleAbort() {
    await abortAgentTerminalSession({
      taskId,
      logPrefix,
      markLifecycleExited: markLifecycleExitedOnAbort,
      setStatus: (nextStatus) => { status = nextStatus },
    })
  }

  function handleTranscription(text: string) {
    void writeAgentTerminalTranscription(taskId, text, logPrefix)
  }

  function getStatusText(): string {
    return getAgentStatusText(status, runningText)
  }

  function getStageLabel(stage: string): string {
    return getAgentStageLabel(stage, stageLabels)
  }

  function getSessionStatusBadgeClass(sessionStatus: string): string {
    return getAgentSessionStatusBadgeClass(sessionStatus, sessionStatusBadgeVariant)
  }

  function getSessionStatusLabel(sessionStatus: string): string {
    return uppercaseSessionStatus ? sessionStatus.toUpperCase() : sessionStatus
  }
</script>

<div class="flex flex-col gap-3 h-full" data-testid={rootTestId}>
  <div class="flex items-center justify-between px-5 py-3.5 bg-base-200 border border-base-300 rounded-md">
    <div class="flex items-start gap-2.5">
      <span class="mt-1.5 shrink-0 {status === 'idle' ? 'status status-neutral' : status === 'running' ? 'status status-success' : status === 'complete' ? 'status status-primary' : 'status status-error'}"></span>
      <div class="flex flex-col gap-1.5">
        <span class="text-sm font-semibold text-base-content">{getStatusText()}</span>
        {#if session}
          <div class="flex items-center gap-2">
            <span class="text-xs font-mono text-secondary">{stageLabelPrefix}{getStageLabel(session.stage)}</span>
            <span class="badge badge-sm font-bold {getSessionStatusBadgeClass(session.status)}">
              {getSessionStatusLabel(session.status)}
            </span>
            {#if resumeCommand}
              <code class="text-[0.6875rem] font-mono text-secondary whitespace-nowrap select-all" title={resumeCommand}>
                {resumeCommand}
              </code>
            {/if}
          </div>
        {/if}
      </div>
    </div>
    <div class="flex items-center gap-3">
      <VoiceInput onTranscription={handleTranscription} listenToHotkey />
      {#if status === 'running'}
        <button class="btn btn-outline btn-error btn-sm" onclick={handleAbort}>
          Abort
        </button>
      {/if}
    </div>
  </div>

  {#if checkpointQuestion}
    <div class="flex items-start gap-3 px-5 py-3 bg-warning/10 border border-warning/30 rounded-md">
      <span class="flex items-center justify-center w-5 h-5 rounded-full bg-warning/20 text-warning text-xs font-bold shrink-0 mt-0.5">?</span>
      <span class="text-[0.8125rem] text-base-content leading-relaxed line-clamp-3">{checkpointQuestion}</span>
    </div>
  {/if}

  <div class="flex-1 overflow-hidden min-h-0 bg-base-100 border border-base-300 rounded-md relative">
    <div class="shell-terminal-wrapper w-full h-full p-3" bind:this={terminalEl}></div>
    {#if loadSessionHistory && sessionHistory.loadingHistory}
      <div class="absolute inset-0 flex flex-col items-center justify-center p-16 gap-4 bg-base-100 z-[1] pointer-events-none">
        <span class="loading loading-spinner loading-md text-primary"></span>
        <div class="text-base font-semibold text-base-content">Loading session output...</div>
      </div>
    {:else if !session && !terminalActive}
      <div class="absolute inset-0 flex flex-col items-center justify-center p-16 gap-4 bg-base-100 z-[1] pointer-events-none">
        {#if isStarting}
          <span class="loading loading-spinner loading-lg text-primary"></span>
          <div class="text-base font-semibold text-base-content" style="animation: badge-pulse 2s ease-in-out infinite;">Starting agent session...</div>
          <div class="text-sm text-base-content/50 text-center max-w-[320px] leading-relaxed">Preparing workspace and launching agent</div>
        {:else}
          <svg class="w-16 h-16 text-base-content/40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="text-base font-semibold text-base-content">No active agent session</div>
          <div class="text-sm text-base-content/50 text-center max-w-[320px] leading-relaxed">Use the action buttons in the header to get started</div>
        {/if}
      </div>
    {/if}
  </div>
</div>
