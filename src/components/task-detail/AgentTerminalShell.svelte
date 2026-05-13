<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { DesktopUnlistenFn } from '../../lib/desktopIpc'
  import { activeSessions } from '../../lib/stores'
  import '@xterm/xterm/css/xterm.css'
  import { listenToAgentStatusChanged, type AgentPanelStatus } from '../../lib/agentPanelSessionSync'
  import { acquire, attach, detach, type PoolEntry } from '../../lib/terminalPool'
  import {
    abortAgentTerminalSession,
    getAgentSessionStatusBadgeClass,
    getAgentStageLabel,
    getAgentStatusText,
    syncAgentPanelStatusFromSession,
    writeAgentTerminalTranscription,
    type AgentStageLabels,
  } from '../../lib/agentTerminalPanel'
  import VoiceInput from '../shared/input/VoiceInput.svelte'
  import { getAgentResumeCommand, type AgentResumeCommandProvider } from '../../lib/agentResumeCommand'

  type ProviderSessionIdKey = 'claude_session_id' | 'pi_session_id'

  interface Props {
    taskId: string
    runningText: string
    logPrefix: string
    sessionIdKey: ProviderSessionIdKey
    stageLabels: AgentStageLabels
    isStarting?: boolean
    rootTestId?: string | null
  }

  let {
    taskId,
    runningText,
    logPrefix,
    sessionIdKey,
    stageLabels,
    isStarting = false,
    rootTestId = null,
  }: Props = $props()

  let terminalEl: HTMLDivElement
  let unlisteners: DesktopUnlistenFn[] = []
  let poolEntry: PoolEntry | null = null
  let status = $state<AgentPanelStatus>('idle')
  let terminalActive = $state(false)
  let destroyed = false

  let session = $derived($activeSessions.get(taskId) || null)
  let providerSessionId = $derived(session ? session[sessionIdKey] : null)
  let resumeCommandProvider: AgentResumeCommandProvider = $derived(sessionIdKey === 'claude_session_id' ? 'claude-code' : 'pi')
  let resumeCommand = $derived(getAgentResumeCommand(resumeCommandProvider, providerSessionId))

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

  onMount(async () => {
    poolEntry = await acquire(taskId)
    if (destroyed || !poolEntry) return
    await attach(poolEntry, terminalEl)
    if (destroyed) return

    syncStatusFromSession(session?.status)

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
    if (poolEntry) {
      detach(poolEntry)
    }
  })

  async function handleAbort() {
    await abortAgentTerminalSession({
      taskId,
      logPrefix,
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
    return getAgentSessionStatusBadgeClass(sessionStatus, 'soft')
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
            <span class="text-xs font-mono text-secondary">// {getStageLabel(session.stage)}</span>
            <span class="badge badge-sm font-bold {getSessionStatusBadgeClass(session.status)}">
              {session.status.toUpperCase()}
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

  <div class="flex-1 overflow-hidden min-h-0 bg-base-100 border border-base-300 rounded-md relative">
    <div class="shell-terminal-wrapper w-full h-full p-3" bind:this={terminalEl}></div>
    {#if !session && !terminalActive}
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
