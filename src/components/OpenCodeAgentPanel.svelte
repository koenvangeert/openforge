<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte'
  import { activeSessions } from '../lib/stores'
  import { writePty, killPty, spawnPty, abortImplementation } from '../lib/ipc'
  import '@xterm/xterm/css/xterm.css'
  import { parseCheckpointQuestion } from '../lib/parseCheckpoint'
  import VoiceInput from './VoiceInput.svelte'
  import { acquire, attach, detach, type PoolEntry } from '../lib/terminalPool'
  import { createSessionHistory } from '../lib/useSessionHistory.svelte'

  interface Props {
    taskId: string
    isStarting?: boolean
  }

  let { taskId, isStarting = false }: Props = $props()

  let status = $state<'idle' | 'running' | 'complete' | 'error'>('idle')
  let opencodePort = $state<number | null>(null)
  let terminalEl: HTMLDivElement
  let poolEntry: PoolEntry | null = null

  const sessionHistory = createSessionHistory({
    taskId: untrack(() => taskId),
    getOpencodePort: () => opencodePort,
    setOpencodePort: (port) => { opencodePort = port },
    onStatusUpdate: (s) => {
      status = s
    },
  })

  let session = $derived($activeSessions.get(taskId) || null)
  let attachCommand = $derived(session?.opencode_session_id && opencodePort
    ? `opencode attach http://127.0.0.1:${opencodePort} -s ${session.opencode_session_id}`
    : null)
  let questionText = $derived(session ? parseCheckpointQuestion(session.checkpoint_data) : null)

  $effect(() => {
    if (session?.status === 'running' || session?.status === 'paused') {
      status = 'running'
      if (session.status === 'running') {
        void tryAttachPty()
      }
      return
    }

    if (session?.status === 'completed') {
      status = 'complete'
      return
    }

    if (session?.status === 'failed' || session?.status === 'interrupted') {
      status = 'error'
      return
    }

    if (!session) {
      status = 'idle'
    }
  })

  $effect(() => {
    if (questionText !== undefined && poolEntry) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (poolEntry) {
            const proposed = poolEntry.fitAddon.proposeDimensions()
            if (proposed && !Number.isNaN(proposed.cols) && !Number.isNaN(proposed.rows)) {
              poolEntry.fitAddon.fit()
            }
          }
        })
      })
    }
  })

  async function tryAttachPty(): Promise<void> {
    if (!poolEntry) return
    if (poolEntry.ptyActive) return  // PTY survived from pool — no need to re-spawn

    const currentSession = $activeSessions.get(taskId)
    if (!currentSession) return
    if (currentSession.status !== 'running' && currentSession.status !== 'paused' && currentSession.status !== 'completed') return
    if (!currentSession.opencode_session_id) return

    // Get port from session history or worktree
    if (!opencodePort) {
      await sessionHistory.loadSessionHistory()
    }
    if (!opencodePort) return

    try {
      await spawnPty(taskId, opencodePort, currentSession.opencode_session_id, poolEntry.terminal.cols, poolEntry.terminal.rows)
      poolEntry.ptyActive = true
      if (currentSession.status === 'running') status = 'running'
    } catch (e) {
      console.error('[OpenCodeAgentPanel] Failed to spawn PTY:', e)
    }
  }

  onMount(async () => {
    poolEntry = await acquire(taskId)
    attach(poolEntry, terminalEl)

    await sessionHistory.loadSessionHistory()
    await tryAttachPty()
  })

  onDestroy(() => {
    if (poolEntry) {
      detach(poolEntry)
    }
  })

  async function handleAbort() {
    try {
      if (poolEntry?.ptyActive) {
        await killPty(taskId).catch((e) => {
          console.error('[OpenCodeAgentPanel] Failed to kill PTY on abort:', e)
        })
        poolEntry.ptyActive = false
        poolEntry.needsClear = true
      }
      await abortImplementation(taskId)
      status = 'error'
    } catch (e) {
      console.error('[OpenCodeAgentPanel] Failed to abort implementation:', e)
    }
  }

  function handleTranscription(text: string) {
    if (poolEntry?.ptyActive) writePty(taskId, text).catch(e => console.error('[OpenCodeAgentPanel] transcription write failed:', e))
  }

  function getStatusText(): string {
    switch (status) {
      case 'idle': return 'No active implementation'
      case 'running': return 'Agent running...'
      case 'complete': return 'Implementation complete'
      case 'error': return 'Error occurred'
      default: return ''
    }
  }

  function getStageLabel(stage: string): string {
    const stageMap: Record<string, string> = {
      'read_ticket': 'Reading Ticket',
      'implement': 'Implementing',
      'create_pr': 'Creating PR',
      'address_comments': 'Addressing Comments'
    }
    return stageMap[stage] || stage
  }

  function getSessionStatusBadgeClass(sessionStatus: string): string {
    switch (sessionStatus) {
      case 'running': return 'badge-success'
      case 'completed': return 'badge-primary'
      case 'failed': return 'badge-error'
      case 'interrupted': return 'badge-ghost'
      case 'paused': return 'badge-warning'
      default: return 'badge-ghost'
    }
  }
</script>

<div class="flex flex-col gap-3 h-full">
  <div class="flex items-center justify-between px-5 py-3.5 bg-base-200 border border-base-300 rounded-md">
    <div class="flex items-start gap-2.5">
      <span class="mt-1.5 shrink-0 {status === 'idle' ? 'status status-neutral' : status === 'running' ? 'status status-success' : status === 'complete' ? 'status status-primary' : 'status status-error'}"></span>
      <div class="flex flex-col gap-1.5">
        <span class="text-sm font-semibold text-base-content">{getStatusText()}</span>
        {#if session}
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium text-base-content/50 tracking-wide">{getStageLabel(session.stage)}</span>
            <span class="badge badge-sm {getSessionStatusBadgeClass(session.status)}">
              {session.status}
            </span>
            {#if attachCommand}
              <button
                class="btn btn-ghost btn-xs font-mono text-base-content/50 border border-base-300 max-w-[420px] truncate normal-case"
                onclick={() => { navigator.clipboard.writeText(attachCommand ?? '') }}
                title="Click to copy"
              >
                {attachCommand}
              </button>
            {:else if session.opencode_session_id}
              <span class="text-[0.6875rem] font-mono text-base-content/50 max-w-[180px] truncate" title={session.opencode_session_id}>
                {session.opencode_session_id}
              </span>
            {/if}
          </div>
        {/if}
      </div>
    </div>
    <div class="flex items-center gap-3">
      <VoiceInput onTranscription={handleTranscription} listenToHotkey />
      {#if status === 'running'}
        <button class="btn btn-error btn-sm uppercase tracking-wide shadow-sm hover:shadow-md transition-shadow" onclick={handleAbort}>
          Abort
        </button>
      {/if}
    </div>
  </div>

  {#if questionText}
    <div class="flex items-start gap-3 px-5 py-3 bg-warning/10 border border-warning/30 rounded-md">
      <span class="flex items-center justify-center w-5 h-5 rounded-full bg-warning/20 text-warning text-xs font-bold shrink-0 mt-0.5">?</span>
      <span class="text-[0.8125rem] text-base-content leading-relaxed line-clamp-3">{questionText}</span>
    </div>
  {/if}

  <div class="flex-1 overflow-hidden min-h-0 bg-base-100 border border-base-300 rounded-md relative">
    <div class="terminal-wrapper" bind:this={terminalEl}></div>
    {#if sessionHistory.loadingHistory}
      <div class="absolute inset-0 flex flex-col items-center justify-center p-16 gap-4 bg-base-100 z-[1] pointer-events-none">
        <span class="loading loading-spinner loading-md text-primary"></span>
        <div class="text-base font-semibold text-base-content">Loading session output...</div>
      </div>
    {:else if !session && status === 'idle'}
      <div class="absolute inset-0 flex flex-col items-center justify-center p-16 gap-4 bg-base-100 z-[1] pointer-events-none">
        {#if isStarting}
          <span class="loading loading-spinner loading-lg text-primary"></span>
          <div class="text-base font-semibold text-base-content" style="animation: badge-pulse 2s ease-in-out infinite;">Starting agent session...</div>
          <div class="text-sm text-base-content/50 text-center max-w-[320px] leading-relaxed">Creating worktree and launching agent</div>
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

<style>
  .terminal-wrapper {
    width: 100%;
    height: 100%;
    padding: 12px;
  }

  :global(.terminal-wrapper .xterm-viewport::-webkit-scrollbar) {
    width: 6px;
  }

  :global(.terminal-wrapper .xterm-viewport::-webkit-scrollbar-track) {
    background: var(--color-base-200);
  }

  :global(.terminal-wrapper .xterm-viewport::-webkit-scrollbar-thumb) {
    background: var(--color-base-300);
    border-radius: 3px;
  }

  :global(.terminal-wrapper .xterm-viewport::-webkit-scrollbar-thumb:hover) {
    background: color-mix(in oklch, var(--color-base-content) 40%, transparent);
  }
</style>
