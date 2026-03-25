<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import { activeSessions } from '../lib/stores'
  import { writePty, killPty, abortImplementation } from '../lib/ipc'
  import '@xterm/xterm/css/xterm.css'
  import { acquire, attach, detach, isPtyActive, type PoolEntry } from '../lib/terminalPool'
  import VoiceInput from './VoiceInput.svelte'

  interface Props {
    taskId: string
    isStarting?: boolean
  }

  let { taskId, isStarting = false }: Props = $props()

  let terminalEl: HTMLDivElement
  let unlisteners: UnlistenFn[] = []
  let poolEntry: PoolEntry | null = null
  let status = $state<'idle' | 'running' | 'complete' | 'error'>('idle')
  let terminalActive = $state(false)

  // Derived state from activeSessions store
  let session = $derived($activeSessions.get(taskId) || null)

  onMount(async () => {
    poolEntry = await acquire(taskId)
    attach(poolEntry, terminalEl)

    terminalActive = isPtyActive(taskId)

    // If session already exists and is running, PTY is already spawned
    if (session?.status === 'running') {
      status = 'running'
      terminalActive = isPtyActive(taskId)
    } else if (session?.status === 'completed') {
      status = 'complete'
    } else if (session?.status === 'failed' || session?.status === 'interrupted') {
      status = 'error'
    }

    // Listen for agent-status-changed events (App.svelte also updates activeSessions store)
    unlisteners.push(await listen<{ task_id: string; status: string }>('agent-status-changed', (event) => {
      if (event.payload.task_id !== taskId) return
      const s = event.payload.status
      if (s === 'running') {
        status = 'running'
        terminalActive = isPtyActive(taskId)
      } else if (s === 'completed') {
        status = 'complete'
      } else if (s === 'failed' || s === 'interrupted') {
        status = 'error'
      }
    }))
  })

  onDestroy(() => {
    unlisteners.forEach((fn) => {
      fn()
    })
    if (poolEntry) {
      detach(poolEntry)
    }
  })

  async function handleAbort() {
    try {
      if (isPtyActive(taskId)) {
        await killPty(taskId).catch(e => {
          console.error('[ClaudeAgentPanel] Failed to kill PTY on abort:', e)
        })
      }
      await abortImplementation(taskId)
      status = 'error'
    } catch (e) {
      console.error('[ClaudeAgentPanel] Failed to abort implementation:', e)
    }
  }

  function handleTranscription(text: string) {
    if (isPtyActive(taskId)) writePty(taskId, text).catch(e => console.error('[ClaudeAgentPanel] transcription write failed:', e))
  }

  function getStatusText(): string {
    switch (status) {
      case 'idle': return 'No active implementation'
      case 'running': return 'Claude agent running...'
      case 'complete': return 'Implementation complete'
      case 'error': return 'Error occurred'
      default: return ''
    }
  }

  function getStageLabel(stage: string): string {
    const stageMap: Record<string, string> = {
      'read_ticket': 'reading ticket',
      'implement': 'implementing',
      'create_pr': 'creating PR',
      'address_comments': 'addressing comments',
    }
    return stageMap[stage] || stage
  }

  function getSessionStatusBadgeClass(sessionStatus: string): string {
    switch (sessionStatus) {
      case 'running': return 'bg-success/10 text-success'
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
            <span class="text-xs font-mono text-secondary">// {getStageLabel(session.stage)}</span>
            <span class="badge badge-sm font-bold {getSessionStatusBadgeClass(session.status)}">
              {session.status.toUpperCase()}
            </span>
            {#if session.claude_session_id}
              <span class="text-[0.6875rem] font-mono text-secondary max-w-[180px] truncate" title={session.claude_session_id}>
                {session.claude_session_id}
              </span>
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
    <div class="terminal-wrapper" bind:this={terminalEl}></div>
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
