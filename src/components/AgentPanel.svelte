<script lang="ts">
  import { onMount, onDestroy, afterUpdate } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import type { AgentEvent } from '../lib/types'
  import { activeSessions } from '../lib/stores'
  import { abortImplementation } from '../lib/ipc'

  export let taskId: string

  let outputText = ''
  let status: 'idle' | 'running' | 'complete' | 'error' = 'idle'
  let errorMessage: string | null = null
  let outputContainer: HTMLDivElement
  let unlisten: UnlistenFn | null = null
  let autoScroll = true

  $: session = $activeSessions.get(taskId) || null
  $: console.log('[AgentPanel] session reactive update for task:', taskId, 'session:', session ? `id=${session.id} status=${session.status} stage=${session.stage}` : 'null')

  onMount(async () => {
    console.log('[AgentPanel] Mounted for task:', taskId)
    unlisten = await listen<AgentEvent>('agent-event', (event) => {
      if (event.payload.task_id !== taskId) return

      const eventType = event.payload.event_type
      const data = event.payload.data
      console.log('[AgentPanel] agent-event for task:', taskId, 'type:', eventType, 'data length:', data.length)

      if (eventType === 'message.part.delta') {
        // Try to parse as JSON content
        try {
          const parsed = JSON.parse(data)
          if (parsed.content && Array.isArray(parsed.content)) {
            for (const part of parsed.content) {
              if (part.type === 'text' && part.text) {
                outputText += part.text
              }
            }
          }
        } catch {
          // JSON parse failed, append raw data
          outputText += data
        }
        status = 'running'
      } else if (eventType === 'session.idle') {
        console.log('[AgentPanel] Session idle (complete) for task:', taskId)
        status = 'complete'
      } else if (eventType === 'session.error') {
        console.log('[AgentPanel] Session error for task:', taskId, 'error:', data)
        status = 'error'
        errorMessage = data
      }
    })
  })

  onDestroy(() => {
    if (unlisten) {
      unlisten()
    }
  })

  afterUpdate(() => {
    if (outputContainer && autoScroll) {
      outputContainer.scrollTop = outputContainer.scrollHeight
    }
  })

  async function handleAbort() {
    try {
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
          </div>
        {/if}
      </div>
    </div>
    <div class="controls">
      <label class="auto-scroll-toggle">
        <input type="checkbox" bind:checked={autoScroll} />
        <span>Auto-scroll</span>
      </label>
      {#if status === 'running'}
        <button class="abort-button" on:click={handleAbort}>
          Abort
        </button>
      {/if}
    </div>
  </div>

  <div class="output-container" bind:this={outputContainer}>
    {#if !session && !outputText}
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="empty-title">No active agent session</div>
        <div class="empty-description">Start an implementation from the Kanban board context menu</div>
      </div>
    {:else if status === 'complete' && session?.status === 'completed'}
      <div class="completion-banner">
        <svg class="completion-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M22 11.08V12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C15.0395 2 17.7281 3.45492 19.4787 5.69495" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M22 4L12 14.01L9 11.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Session completed</span>
      </div>
      <pre class="output-text">{outputText}</pre>
    {:else if status === 'error' || session?.status === 'failed'}
      {#if outputText}
        <pre class="output-text">{outputText}</pre>
      {/if}
      {#if errorMessage || session?.error_message}
        <div class="error-banner">
          <svg class="error-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 8V12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M12 16H12.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <div class="error-content">
            <div class="error-title">Session failed</div>
            <div class="error-message-text">{errorMessage || session?.error_message}</div>
          </div>
        </div>
      {/if}
    {:else}
      <pre class="output-text">{outputText}</pre>
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

  .badge-default {
    background: rgba(122, 162, 247, 0.15);
    color: var(--accent);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .auto-scroll-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    user-select: none;
    padding: 4px 8px;
    border-radius: 4px;
    transition: background 0.2s;
  }

  .auto-scroll-toggle:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .auto-scroll-toggle input[type="checkbox"] {
    appearance: none;
    width: 14px;
    height: 14px;
    border: 1.5px solid var(--border);
    border-radius: 3px;
    cursor: pointer;
    position: relative;
    transition: all 0.2s;
  }

  .auto-scroll-toggle input[type="checkbox"]:checked {
    background: var(--accent);
    border-color: var(--accent);
  }

  .auto-scroll-toggle input[type="checkbox"]:checked::after {
    content: '';
    position: absolute;
    left: 3px;
    top: 0px;
    width: 4px;
    height: 8px;
    border: solid white;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }

  .auto-scroll-toggle span {
    color: var(--text-secondary);
    font-size: 0.75rem;
    font-weight: 500;
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

  .output-container {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 16px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    gap: 16px;
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

  .completion-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    background: rgba(158, 206, 106, 0.1);
    border: 1px solid rgba(158, 206, 106, 0.3);
    border-radius: 6px;
    margin-bottom: 16px;
    color: var(--success);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .completion-icon {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
  }

  .error-banner {
    display: flex;
    gap: 12px;
    padding: 14px 16px;
    background: rgba(247, 118, 142, 0.08);
    border: 1px solid rgba(247, 118, 142, 0.3);
    border-left: 4px solid var(--error);
    border-radius: 6px;
    margin-bottom: 16px;
  }

  .error-icon {
    width: 24px;
    height: 24px;
    color: var(--error);
    flex-shrink: 0;
    margin-top: 2px;
  }

  .error-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }

  .error-title {
    color: var(--error);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .error-message-text {
    color: var(--text-primary);
    font-size: 0.8125rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .output-text {
    margin: 0;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 0.8125rem;
    line-height: 1.6;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
