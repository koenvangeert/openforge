<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import type { AgentEvent } from '../lib/types'
  import { activeSessions } from '../lib/stores'
  import { abortImplementation, resizePty } from '../lib/ipc'
  import '@xterm/xterm/css/xterm.css'
  import { parseCheckpointQuestion } from '../lib/parseCheckpoint'
  import VoiceInput from './VoiceInput.svelte'
  import { createTerminal } from '../lib/useTerminal.svelte'
  import { createPtyBridge } from '../lib/usePtyBridge.svelte'
  import { createSessionHistory } from '../lib/useSessionHistory.svelte'
  import type { PtyBridgeHandle } from '../lib/usePtyBridge.svelte'

  interface Props {
    taskId: string
  }

  let { taskId }: Props = $props()

  let status = $state<'idle' | 'running' | 'complete' | 'error'>('idle')
  let errorMessage = $state<string | null>(null)
  let opencodePort = $state<number | null>(null)
  let unlisten: UnlistenFn | null = null
  let terminalEl: HTMLDivElement

  // Declare ptyBridge before termHandle so the onData/onResize closures can reference it.
  // The variable is assigned immediately below — closures only execute after both are set.
  let ptyBridge: PtyBridgeHandle

  const termHandle = createTerminal({
    onData: (data: string) => {
      if (ptyBridge?.ptySpawned) ptyBridge.writeToPty(data)
    },
    onResize: (cols: number, rows: number) => {
      if (ptyBridge?.ptySpawned) {
        resizePty(taskId, cols, rows).catch((e) => {
          console.error('[AgentPanel] Failed to resize PTY:', e)
        })
      }
    },
  })

  ptyBridge = createPtyBridge({
    taskId: untrack(() => taskId),
    getTerminal: () => termHandle.terminal,
    setOpencodePort: (port) => { opencodePort = port },
    onAttached: () => {
      const currentSession = $activeSessions.get(taskId)
      if (currentSession?.status === 'running') status = 'running'
    },
  })

  const sessionHistory = createSessionHistory({
    taskId: untrack(() => taskId),
    getOpencodePort: () => opencodePort,
    setOpencodePort: (port) => { opencodePort = port },
    onStatusUpdate: (s, msg) => {
      status = s
      if (msg !== undefined) errorMessage = msg ?? null
    },
  })

  let session = $derived($activeSessions.get(taskId) || null)
  let attachCommand = $derived(session?.opencode_session_id && opencodePort
    ? `opencode attach http://127.0.0.1:${opencodePort} -s ${session.opencode_session_id}`
    : null)
  let questionText = $derived(session ? parseCheckpointQuestion(session.checkpoint_data) : null)

  $effect(() => {
    if (questionText !== undefined) {
      // Re-fit terminal when banner visibility changes
      requestAnimationFrame(() => {
        requestAnimationFrame(() => termHandle.safeFit())
      })
    }
  })

  async function tryAttachPty(): Promise<void> {
    const currentSession = $activeSessions.get(taskId)
    const sessionId = currentSession?.opencode_session_id
    if (!sessionId) return
    await ptyBridge.attachPty(sessionId)
  }

  onMount(async () => {
    termHandle.terminalEl = terminalEl
    await termHandle.mount()

    await sessionHistory.loadSessionHistory()
    await tryAttachPty()

    unlisten = await listen<AgentEvent>('agent-event', (event) => {
      if (event.payload.task_id !== taskId) return

      const eventType = event.payload.event_type
      const data = event.payload.data

      if (eventType === 'session.idle') {
        status = 'complete'
      } else if (eventType === 'session.status') {
        try {
          const parsed = JSON.parse(data)
          const statusType = parsed.properties?.status?.type
          if (statusType === 'idle') {
            status = 'complete'
          } else if (statusType === 'busy') {
            status = 'running'
            tryAttachPty()
          } else if (statusType === 'retry') {
            status = 'running'
            tryAttachPty()
          }
        } catch { /* ignore parse errors */ }
      } else if (eventType === 'session.error') {
        status = 'error'
        errorMessage = data
      }
    })
  })

  onDestroy(() => {
    if (unlisten) unlisten()
    const isSessionRunning = session?.status === 'running'
    // PTY must be killed BEFORE terminal disposes
    if (ptyBridge.ptySpawned && !isSessionRunning) {
      ptyBridge.killPty().catch((e) => {
        console.error('[AgentPanel] Failed to kill PTY on destroy:', e)
      })
    }
    ptyBridge.dispose()
    termHandle.dispose()
  })

  async function handleAbort() {
    try {
      if (ptyBridge.ptySpawned) {
        await ptyBridge.killPty().catch((e) => {
          console.error('[AgentPanel] Failed to kill PTY on abort:', e)
        })
      }
      await abortImplementation(taskId)
      status = 'error'
      errorMessage = 'Implementation aborted by user'
    } catch (e) {
      console.error('Failed to abort implementation:', e)
    }
  }

  function handleTranscription(text: string) {
    ptyBridge.writeToPty(text)
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
        <svg class="w-16 h-16 text-base-content/40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
       </svg>
         <div class="text-base font-semibold text-base-content">No active agent session</div>
         <div class="text-sm text-base-content/50 text-center max-w-[320px] leading-relaxed">Use the action buttons in the header to get started</div>
       </div>
    {/if}
  </div>
</div>

<style>
  /* xterm.js terminal container — keep custom CSS for sizing and light-theme scrollbar */
  .terminal-wrapper {
    width: 100%;
    height: 100%;
    padding: 12px;
  }

  /* Light theme scrollbar overrides for xterm viewport */
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
