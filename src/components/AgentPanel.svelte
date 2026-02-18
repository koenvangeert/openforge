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

  export let taskId: string

  let status: 'idle' | 'running' | 'complete' | 'error' = 'idle'
  let errorMessage: string | null = null
  let unlisten: UnlistenFn | null = null
  let ptyOutputUnlisten: UnlistenFn | null = null
  let ptyExitUnlisten: UnlistenFn | null = null
  let loadingHistory = false
  let terminalContainer: HTMLDivElement
  let terminal: Terminal | null = null
  let fitAddon: FitAddon | null = null
  let resizeObserver: ResizeObserver | null = null
  let ptySpawned = false
  let terminalMounted = false
  let opencodePort: number | null = null

  $: session = $activeSessions.get(taskId) || null
  $: attachCommand = session?.opencode_session_id && opencodePort
    ? `opencode attach http://127.0.0.1:${opencodePort} -s ${session.opencode_session_id}`
    : null
  $: console.log('[AgentPanel] session reactive update for task:', taskId, 'session:', session ? `id=${session.id} status=${session.status} stage=${session.stage}` : 'null')
  $: questionText = session ? parseCheckpointQuestion(session.checkpoint_data) : null

  $: if (questionText !== undefined) {
    // Re-fit terminal when banner visibility changes
    setTimeout(() => fitAddon?.fit(), 50)
  }

  // Auto-spawn PTY when session becomes running and terminal is mounted
  $: if (session && session.status === 'running' && terminalContainer && terminal && !ptySpawned) {
    spawnPtyForSession()
  }

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
      console.log('[AgentPanel] Spawning PTY for task:', taskId, 'port:', port, 'session:', opencodeSessionId, 'size:', cols, 'x', rows)
      await spawnPty(taskId, port, opencodeSessionId, cols, rows)
      console.log('[AgentPanel] PTY spawn succeeded, listening on pty-output-' + taskId)
      status = 'running'
    } catch (e) {
      console.error('[AgentPanel] Failed to spawn PTY:', e)
      ptySpawned = false
    }
  }

  async function setupPtyListeners() {
    // Listen for PTY output → write to xterm
    ptyOutputUnlisten = await listen<PtyEvent>(`pty-output-${taskId}`, (event) => {
      console.log('[AgentPanel] pty-output received, payload:', JSON.stringify(event.payload).slice(0, 200))
      if (terminal && event.payload.data) {
        terminal.write(event.payload.data)
      } else {
        console.warn('[AgentPanel] pty-output skipped: terminal=', !!terminal, 'data=', !!event.payload?.data)
      }
    })

    ptyExitUnlisten = await listen<PtyEvent>(`pty-exit-${taskId}`, (event) => {
      console.log('[AgentPanel] PTY exited for task:', taskId, 'data:', event.payload.data)
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
    console.log('[AgentPanel] Opening terminal into container', terminalContainer.clientWidth, 'x', terminalContainer.clientHeight)
    terminal.open(terminalContainer)
    terminalMounted = true
    fitAddon?.fit()
    console.log('[AgentPanel] Terminal opened, size:', terminal.cols, 'x', terminal.rows)

    resizeObserver = new ResizeObserver(() => {
      fitAddon?.fit()
      if (terminal && ptySpawned) {
        resizePty(taskId, terminal.cols, terminal.rows).catch((e) => {
          console.error('[AgentPanel] Failed to resize PTY:', e)
        })
      }
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

  $: if (terminalContainer && terminal) {
    mountTerminal()
  }

  onMount(async () => {
    console.log('[AgentPanel] Mounted for task:', taskId)

    // Initialize xterm.js terminal
    terminal = new Terminal({
      fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      theme: {
        background: '#1a1b26',
        foreground: '#a9b1d6',
        cursor: '#7aa2f7',
        selectionBackground: 'rgba(122, 162, 247, 0.3)',
        black: '#414868',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#c0caf5',
        brightBlack: '#414868',
        brightRed: '#f7768e',
        brightGreen: '#9ece6a',
        brightYellow: '#e0af68',
        brightBlue: '#7aa2f7',
        brightMagenta: '#bb9af7',
        brightCyan: '#7dcfff',
        brightWhite: '#c0caf5',
      },
      allowProposedApi: true,
    })

    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    await loadSessionHistory()

    unlisten = await listen<AgentEvent>('agent-event', (event) => {
      if (event.payload.task_id !== taskId) return

      const eventType = event.payload.event_type
      const data = event.payload.data
      console.log('[AgentPanel] agent-event for task:', taskId, 'type:', eventType)

      if (eventType === 'session.idle') {
        console.log('[AgentPanel] Session idle (complete) for task:', taskId)
        status = 'complete'
      } else if (eventType === 'session.status') {
        try {
          const parsed = JSON.parse(data)
          const statusType = parsed.properties?.status?.type
          if (statusType === 'idle') {
            console.log('[AgentPanel] Session status idle (complete) for task:', taskId)
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
        console.log('[AgentPanel] Session error for task:', taskId, 'error:', data)
        status = 'error'
        errorMessage = data
      }
    })
  })

  onDestroy(() => {
    if (unlisten) unlisten()
    if (ptyOutputUnlisten) ptyOutputUnlisten()
    if (ptyExitUnlisten) ptyExitUnlisten()
    if (resizeObserver) resizeObserver.disconnect()
    if (ptySpawned) {
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
      case 'running': return 'badge-running'
      case 'completed': return 'badge-completed'
      case 'failed': return 'badge-failed'
      case 'interrupted': return 'badge-interrupted'
      case 'paused': return 'badge-paused'
      default: return 'badge-default'
    }
  }
</script>

<div class="agent-panel">
  <div class="status-bar">
    <div class="status-indicator">
      <span class="status-dot" class:idle={status === 'idle'} class:running={status === 'running'} class:complete={status === 'complete'} class:error={status === 'error'}></span>
      <div class="status-content">
        <span class="status-text">{getStatusText()}</span>
        {#if session}
          <div class="session-info">
            <span class="stage-label">{getStageLabel(session.stage)}</span>
            <span class="session-badge {getSessionStatusBadgeClass(session.status)}">
              {session.status}
            </span>
            {#if attachCommand}
              <button class="attach-command" on:click={() => { navigator.clipboard.writeText(attachCommand ?? '') }} title="Click to copy">
                {attachCommand}
              </button>
            {:else if session.opencode_session_id}
              <span class="session-id" title={session.opencode_session_id}>
                {session.opencode_session_id}
              </span>
            {/if}
          </div>
        {/if}
      </div>
    </div>
    <div class="controls">
      {#if status === 'running'}
        <button class="abort-button" on:click={handleAbort}>
          Abort
        </button>
      {/if}
    </div>
  </div>

  {#if questionText}
    <div class="question-banner">
      <span class="question-icon">?</span>
      <span class="question-text" title={questionText}>{questionText}</span>
    </div>
  {/if}

  <div class="output-container">
    <div class="terminal-wrapper" bind:this={terminalContainer}></div>
    {#if loadingHistory}
      <div class="empty-state-overlay">
        <div class="loading-spinner"></div>
        <div class="empty-title">Loading session output...</div>
      </div>
    {:else if !session && status === 'idle'}
      <div class="empty-state-overlay">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="empty-title">No active agent session</div>
        <div class="empty-description">Start an implementation from the Kanban board context menu</div>
      </div>
    {/if}
  </div>
</div>

<style>
  .agent-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
  }

  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--bg-secondary);
    border-radius: 6px;
    border: 1px solid var(--border);
  }

  .status-indicator {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 6px;
  }

  .status-dot.idle {
    background: var(--text-secondary);
  }

  .status-dot.running {
    background: var(--success);
    animation: pulse 1.5s ease-in-out infinite;
    box-shadow: 0 0 8px var(--success);
  }

  .status-dot.complete {
    background: var(--success);
  }

  .status-dot.error {
    background: var(--error);
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .status-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .status-text {
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .session-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .stage-label {
    color: var(--text-secondary);
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  .session-badge {
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .session-id {
    color: var(--text-secondary);
    font-size: 0.6875rem;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    opacity: 0.7;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .attach-command {
    color: var(--text-secondary);
    font-size: 0.6875rem;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    background: rgba(122, 162, 247, 0.08);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 2px 8px;
    cursor: pointer;
    max-width: 420px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: all 0.15s;
  }

  .attach-command:hover {
    background: rgba(122, 162, 247, 0.15);
    color: var(--text-primary);
  }

  .badge-running {
    background: rgba(158, 206, 106, 0.15);
    color: var(--success);
  }

  .badge-completed {
    background: rgba(158, 206, 106, 0.15);
    color: var(--success);
  }

  .badge-failed {
    background: rgba(247, 118, 142, 0.15);
    color: var(--error);
  }

  .badge-paused {
    background: rgba(224, 175, 104, 0.15);
    color: var(--warning);
  }

  .badge-interrupted {
    background: rgba(86, 95, 137, 0.2);
    color: var(--text-secondary);
  }

  .badge-default {
    background: rgba(122, 162, 247, 0.15);
    color: var(--accent);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .abort-button {
    padding: 6px 14px;
    background: var(--error);
    color: white;
    border: none;
    border-radius: 5px;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .abort-button:hover {
    background: #d9495f;
    transform: translateY(-1px);
  }

  .abort-button:active {
    transform: translateY(0);
  }

  .question-banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 16px;
    background: rgba(224, 175, 104, 0.12);
    border: 1px solid rgba(224, 175, 104, 0.3);
    border-radius: 6px;
  }

  .question-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(224, 175, 104, 0.2);
    color: var(--warning);
    font-size: 0.8rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  .question-text {
    color: var(--text-primary);
    font-size: 0.8125rem;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .output-container {
    flex: 1;
    overflow: hidden;
    min-height: 0;
    background: #1a1b26;
    border: 1px solid var(--border);
    border-radius: 6px;
    position: relative;
  }

  .empty-state-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    gap: 16px;
    background: #1a1b26;
    z-index: 1;
  }

  .empty-icon {
    width: 64px;
    height: 64px;
    color: var(--text-secondary);
    opacity: 0.4;
  }

  .empty-title {
    color: var(--text-primary);
    font-size: 1rem;
    font-weight: 600;
  }

  .empty-description {
    color: var(--text-secondary);
    font-size: 0.875rem;
    text-align: center;
    max-width: 320px;
    line-height: 1.5;
  }

  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .terminal-wrapper {
    width: 100%;
    height: 100%;
    padding: 8px;
  }
</style>
