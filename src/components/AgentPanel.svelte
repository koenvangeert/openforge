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
  import VoiceInput from './VoiceInput.svelte'

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
  let visibilityObserver: IntersectionObserver | null = null
  let ptySpawned = false
  let expectedPtyInstance: number | null = null
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
      requestAnimationFrame(() => {
        requestAnimationFrame(() => safeFit())
      })
    }
  })

  // Attach PTY once for the current session. Called from onMount (existing session)
  // and from the agent-event listener (new session becomes running).
  async function tryAttachPty() {
    if (ptySpawned) return

    const currentSession = $activeSessions.get(taskId)
    const sessionId = currentSession?.opencode_session_id
    if (!sessionId) return

    ptySpawned = true  // Set synchronously before any await to prevent duplicate calls

    try {
      const worktree = await getWorktreeForTask(taskId)
      const port = worktree?.opencode_port
      if (!port) {
        console.error('[AgentPanel] No opencode_port found for task:', taskId)
        ptySpawned = false
        return
      }
      opencodePort = port

      await setupPtyListeners()
      const cols = terminal?.cols ?? 80
      const rows = terminal?.rows ?? 24
      expectedPtyInstance = await spawnPty(taskId, port, sessionId, cols, rows)
      terminal?.focus()

      if (currentSession.status === 'running') {
        status = 'running'
      }
    } catch (e) {
      console.error('[AgentPanel] Failed to attach PTY:', e)
      ptySpawned = false
    }
  }

  async function setupPtyListeners() {
    // Clean up old listeners before registering new ones (prevents listener leak)
    if (ptyOutputUnlisten) { ptyOutputUnlisten(); ptyOutputUnlisten = null }
    if (ptyExitUnlisten) { ptyExitUnlisten(); ptyExitUnlisten = null }

    // Listen for PTY output → write to xterm
    ptyOutputUnlisten = await listen<PtyEvent>(`pty-output-${taskId}`, (event) => {
      if (terminal && event.payload.data) {
        terminal.write(event.payload.data)
      }
    })

    ptyExitUnlisten = await listen<PtyEvent>(`pty-exit-${taskId}`, (event) => {
      const exitInstance = event.payload?.instance_id
      if (exitInstance != null && exitInstance !== expectedPtyInstance) {
        console.warn(`[AgentPanel] Ignoring stale pty-exit (instance ${exitInstance}, expected ${expectedPtyInstance})`)
        return
      }
      ptySpawned = false
      expectedPtyInstance = null
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
  }

  function safeFit(): void {
    if (!fitAddon || !terminalContainer) return
    if (terminalContainer.clientWidth === 0 || terminalContainer.clientHeight === 0) return
    const proposed = fitAddon.proposeDimensions()
    if (!proposed || isNaN(proposed.cols) || isNaN(proposed.rows)) return
    fitAddon.fit()
  }

  async function mountTerminal(): Promise<void> {
    if (terminalMounted || !terminal || !terminalContainer) return

    // Wait for fonts to load so CharSizeService measures correctly
    await Promise.race([
      document.fonts.ready,
      new Promise<void>(resolve => setTimeout(resolve, 3000))
    ])

    terminal.open(terminalContainer)
    terminal.focus()
    terminalMounted = true
    requestAnimationFrame(() => {
      safeFit()
    })

    resizeObserver = new ResizeObserver((entries) => {
      if (!terminal || !terminalContainer) return
      const { width, height } = entries[0].contentRect
      if (width === 0 || height === 0) return
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        resizeTimeout = null
        safeFit()
        if (terminal && ptySpawned) {
          resizePty(taskId, terminal.cols, terminal.rows).catch((e) => {
            console.error('[AgentPanel] Failed to resize PTY:', e)
          })
        }
      }, 100)
    })
    resizeObserver.observe(terminalContainer)

    // Re-fit and refresh terminal when it becomes visible (e.g., after tab/view switch)
    visibilityObserver = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry.isIntersecting) {
        requestAnimationFrame(() => {
          safeFit()
          terminal?.refresh(0, (terminal?.rows ?? 1) - 1)
          terminal?.focus()
        })
      }
    }, { threshold: 0 })
    visibilityObserver.observe(terminalContainer)

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
    await mountTerminal()

    await loadSessionHistory()

    // Attach PTY once for whatever session exists at panel open
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
    if (ptyOutputUnlisten) ptyOutputUnlisten()
    if (ptyExitUnlisten) ptyExitUnlisten()
    if (resizeTimeout) clearTimeout(resizeTimeout)
    if (resizeObserver) resizeObserver.disconnect()
    if (visibilityObserver) visibilityObserver.disconnect()
    const isSessionRunning = session?.status === 'running'
    if (ptySpawned && !isSessionRunning) {
      killPty(taskId).catch((e) => {
        console.error('[AgentPanel] Failed to kill PTY on destroy:', e)
      })
    }
    expectedPtyInstance = null
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

  function handleTranscription(text: string) {
    writePty(taskId, text).catch((e) => {
      console.error('[AgentPanel] Failed to write transcription to PTY:', e)
    })
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
      <VoiceInput onTranscription={handleTranscription} disabled={!ptySpawned} listenToHotkey />
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
    <div class="terminal-wrapper" bind:this={terminalContainer}></div>
    {#if loadingHistory}
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
