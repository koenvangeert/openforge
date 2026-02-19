<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import type { AgentEvent, PtyEvent } from '../lib/types'
  import { activeSessions } from '../lib/stores'
  import { abortImplementation, getLatestSession, getWorktreeForTask, spawnPty, writePty, resizePty, killPty } from '../lib/ipc'
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import '@xterm/xterm/css/xterm.css'
  import { parseCheckpointQuestion } from '../lib/parseCheckpoint'

  interface Props {
    taskId: string
  }

  let { taskId }: Props = $props()

  let status = $state<'idle' | 'running' | 'complete' | 'error'>('idle')
  let errorMessage = $state<string | null>(null)
  let unlisten: UnlistenFn | null = null
  let ptyOutputUnlisten: UnlistenFn | null = null
  let ptyExitUnlisten: UnlistenFn | null = null
  let loadingHistory = $state(false)
  let terminalContainer: HTMLDivElement
  let terminal: Terminal | null = null
  let fitAddon: FitAddon | null = null
  let resizeObserver: ResizeObserver | null = null
  let resizeTimeout: ReturnType<typeof setTimeout> | null = null
  let ptySpawned = $state(false)
  let terminalMounted = false
  let opencodePort: number | null = null

  let session = $derived($activeSessions.get(taskId) || null)
  let attachCommand = $derived(session?.opencode_session_id && opencodePort
    ? `opencode attach http://127.0.0.1:${opencodePort} -s ${session.opencode_session_id}`
    : null)
  let questionText = $derived(session ? parseCheckpointQuestion(session.checkpoint_data) : null)

  $effect(() => {
    if (questionText !== undefined) {
      // Re-fit terminal when banner visibility changes
      setTimeout(() => fitAddon?.fit(), 50)
    }
  })

  // Auto-spawn PTY when session becomes running and terminal is mounted
  $effect(() => {
    if (session && session.status === 'running' && terminalContainer && terminal && !ptySpawned) {
      spawnPtyForSession()
    }
  })

  async function spawnPtyForSession() {
    if (ptySpawned) return
    ptySpawned = true

    const opencodeSessionId = session?.opencode_session_id
    if (!opencodeSessionId) {
      console.error('[AgentPanel] No opencode_session_id available for PTY spawn')
      ptySpawned = false
      return
    }

    try {
      const worktree = await getWorktreeForTask(taskId)
      const port = worktree?.opencode_port
      if (!port) {
        console.error('[AgentPanel] No opencode_port found for task:', taskId)
        ptySpawned = false
        return
      }
      opencodePort = port

      mountTerminal()
      await setupPtyListeners()

      const cols = terminal?.cols ?? 80
      const rows = terminal?.rows ?? 24
      await spawnPty(taskId, port, opencodeSessionId, cols, rows)
      status = 'running'
    } catch (e) {
      console.error('[AgentPanel] Failed to spawn PTY:', e)
      ptySpawned = false
    }
  }

  async function setupPtyListeners() {
    // Listen for PTY output → write to xterm
    ptyOutputUnlisten = await listen<PtyEvent>(`pty-output-${taskId}`, (event) => {
      if (terminal && event.payload.data) {
        terminal.write(event.payload.data)
      }
    })

    ptyExitUnlisten = await listen<PtyEvent>(`pty-exit-${taskId}`, () => {
      ptySpawned = false
    })
  }

  async function loadSessionHistory() {
    loadingHistory = true
    try {
      let existingSession = $activeSessions.get(taskId)
      if (!existingSession) {
        const dbSession = await getLatestSession(taskId)
        if (dbSession && (dbSession.status === 'completed' || dbSession.status === 'failed' || dbSession.status === 'paused' || dbSession.status === 'interrupted')) {
          const updated = new Map($activeSessions)
          updated.set(taskId, dbSession)
          $activeSessions = updated
          existingSession = dbSession
        }
      }

      if (!existingSession) return

      if (!opencodePort) {
        const worktree = await getWorktreeForTask(taskId)
        if (worktree?.opencode_port) opencodePort = worktree.opencode_port
      }

      if (existingSession.status !== 'completed' && existingSession.status !== 'failed' && existingSession.status !== 'paused' && existingSession.status !== 'interrupted') return

      if (existingSession.status === 'completed') {
        status = 'complete'
      } else if (existingSession.status === 'paused') {
        status = 'idle'
      } else {
        status = 'error'
        errorMessage = existingSession.error_message
      }

    } catch (e) {
      console.error('[AgentPanel] Failed to load session history:', e)
    } finally {
      loadingHistory = false
    }

    // Re-attach PTY after loadingHistory is false so the terminal-wrapper div
    // is in the DOM and mountTerminal() can open xterm into it.
    const reattachSession = $activeSessions.get(taskId)
    if (reattachSession?.opencode_session_id) {
      try {
        const worktree = await getWorktreeForTask(taskId)
        if (worktree?.opencode_port) {
          opencodePort = worktree.opencode_port
          await setupPtyListeners()
          const cols = terminal?.cols ?? 80
          const rows = terminal?.rows ?? 24
          await spawnPty(taskId, worktree.opencode_port, reattachSession.opencode_session_id, cols, rows)
          ptySpawned = true
        }
      } catch (e) {
        console.error('[AgentPanel] Failed to re-attach PTY for completed session:', e)
      }
    }
  }

  function mountTerminal() {
    if (terminalMounted || !terminal || !terminalContainer) return
    terminal.open(terminalContainer)
    terminalMounted = true
    fitAddon?.fit()

    resizeObserver = new ResizeObserver(() => {
      if (!terminal || !terminalContainer) return
      if (!resizeTimeout) {
        // Leading edge: fire immediately on first resize event
        fitAddon?.fit()
        if (terminal && ptySpawned) {
          resizePty(taskId, terminal.cols, terminal.rows).catch((e) => {
            console.error('[AgentPanel] Failed to resize PTY:', e)
          })
        }
      } else {
        clearTimeout(resizeTimeout)
      }
      resizeTimeout = setTimeout(() => {
        resizeTimeout = null
        // Trailing edge: fire once more to catch final size
        fitAddon?.fit()
        if (terminal && ptySpawned) {
          resizePty(taskId, terminal.cols, terminal.rows).catch((e) => {
            console.error('[AgentPanel] Failed to resize PTY:', e)
          })
        }
      }, 100)
    })
    resizeObserver.observe(terminalContainer)

    terminal.onData((data) => {
      if (ptySpawned) {
        writePty(taskId, data).catch((e) => {
          console.error('[AgentPanel] Failed to write to PTY:', e)
        })
      }
    })
  }

  onMount(async () => {
    // Initialize xterm.js terminal
    terminal = new Terminal({
      fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      theme: {
        background: '#ffffff',
        foreground: '#1f2937',
        cursor: '#1f2937',
        cursorAccent: '#ffffff',
        selectionBackground: '#bfdbfe',
        selectionForeground: '#1f2937',
        black: '#1f2937',
        red: '#dc2626',
        green: '#16a34a',
        yellow: '#ca8a04',
        blue: '#2563eb',
        magenta: '#9333ea',
        cyan: '#0891b2',
        white: '#f3f4f6',
        brightBlack: '#6b7280',
        brightRed: '#ef4444',
        brightGreen: '#22c55e',
        brightYellow: '#eab308',
        brightBlue: '#3b82f6',
        brightMagenta: '#a855f7',
        brightCyan: '#06b6d4',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
    })

    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    // Mount terminal immediately — by onMount time, bind:this has set terminalContainer.
    // In Svelte 5, $effect won't track plain let variables, so we mount directly here.
    mountTerminal()

    await loadSessionHistory()

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
            console.log('[AgentPanel] Session status busy (running) for task:', taskId)
            status = 'running'
          } else if (statusType === 'retry') {
            console.log('[AgentPanel] Session status retry (running) for task:', taskId)
            status = 'running'
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
    if (ptyOutputUnlisten) ptyOutputUnlisten()
    if (ptyExitUnlisten) ptyExitUnlisten()
    if (resizeTimeout) clearTimeout(resizeTimeout)
    if (resizeObserver) resizeObserver.disconnect()
    const isSessionRunning = session?.status === 'running'
    if (ptySpawned && !isSessionRunning) {
      killPty(taskId).catch((e) => {
        console.error('[AgentPanel] Failed to kill PTY on destroy:', e)
      })
    }
    if (terminal) terminal.dispose()
  })

  async function handleAbort() {
    try {
      if (ptySpawned) {
        await killPty(taskId).catch((e) => {
          console.error('[AgentPanel] Failed to kill PTY on abort:', e)
        })
        ptySpawned = false
      }
      await abortImplementation(taskId)
      status = 'error'
      errorMessage = 'Implementation aborted by user'
    } catch (e) {
      console.error('Failed to abort implementation:', e)
    }
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
  <div class="flex items-center justify-between px-4 py-3 bg-base-200 border border-base-300 rounded-md">
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
      {#if status === 'running'}
        <button class="btn btn-error btn-sm uppercase tracking-wide" onclick={handleAbort}>
          Abort
        </button>
      {/if}
    </div>
  </div>

  {#if questionText}
    <div class="flex items-start gap-2.5 px-4 py-2.5 bg-warning/10 border border-warning/30 rounded-md">
      <span class="flex items-center justify-center w-5 h-5 rounded-full bg-warning/20 text-warning text-xs font-bold shrink-0 mt-0.5">?</span>
      <span class="text-[0.8125rem] text-base-content leading-relaxed line-clamp-3">{questionText}</span>
    </div>
  {/if}

  <div class="flex-1 overflow-hidden min-h-0 bg-white border border-base-300 rounded-md relative">
    <div class="terminal-wrapper" bind:this={terminalContainer}></div>
    {#if loadingHistory}
      <div class="absolute inset-0 flex flex-col items-center justify-center p-16 gap-4 bg-white z-[1]">
        <span class="loading loading-spinner loading-md text-primary"></span>
        <div class="text-base font-semibold text-base-content">Loading session output...</div>
      </div>
    {:else if !session && status === 'idle'}
      <div class="absolute inset-0 flex flex-col items-center justify-center p-16 gap-4 bg-white z-[1]">
        <svg class="w-16 h-16 text-base-content/40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="text-base font-semibold text-base-content">No active agent session</div>
        <div class="text-sm text-base-content/50 text-center max-w-[320px] leading-relaxed">Start an implementation from the Kanban board context menu</div>
      </div>
    {/if}
  </div>
</div>

<style>
  /* xterm.js terminal container — keep custom CSS for sizing and light-theme scrollbar */
  .terminal-wrapper {
    width: 100%;
    height: 100%;
    padding: 8px;
  }

  /* Light theme scrollbar overrides for xterm viewport */
  :global(.terminal-wrapper .xterm-viewport::-webkit-scrollbar) {
    width: 6px;
  }

  :global(.terminal-wrapper .xterm-viewport::-webkit-scrollbar-track) {
    background: #f3f4f6;
  }

  :global(.terminal-wrapper .xterm-viewport::-webkit-scrollbar-thumb) {
    background: #d1d5db;
    border-radius: 3px;
  }

  :global(.terminal-wrapper .xterm-viewport::-webkit-scrollbar-thumb:hover) {
    background: #9ca3af;
  }
</style>
