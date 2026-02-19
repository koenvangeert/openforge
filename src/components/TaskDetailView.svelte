<script lang="ts">
  import type { Task } from '../lib/types'
  import { selectedTaskId, activeSessions } from '../lib/stores'
  import { getWorktreeForTask } from '../lib/ipc'
  import AgentPanel from './AgentPanel.svelte'
  import TaskInfoPanel from './TaskInfoPanel.svelte'
  import SelfReviewView from './SelfReviewView.svelte'

  interface Props {
    task: Task
    onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { task, onRunAction }: Props = $props()

  let reviewMode = $state(false)
  let hasWorktree = $state(false)
  // Plain variable (not $state) so it's not tracked as a reactive dependency.
  // Used to detect actual task changes vs. same-task prop re-renders.
  let lastTaskId = ''

  let currentSession = $derived($activeSessions.get(task.id))
  let agentStatus = $derived(currentSession?.status ?? null)

  $effect(() => {
    const taskId = task.id
    if (taskId !== lastTaskId) {
      lastTaskId = taskId
      reviewMode = false
      getWorktreeForTask(taskId).then((worktree) => {
        hasWorktree = worktree !== null
      })
    }
  })

  function handleBack() {
    $selectedTaskId = null
  }

  function handleEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      $selectedTaskId = null
    }
  }

  function handleSendToAgent(prompt: string) {
    onRunAction({ taskId: task.id, actionPrompt: prompt, agent: null })
  }

  function getStatusColor(status: string): string {
    if (status === 'running') return 'var(--success)'
    if (status === 'completed') return 'var(--accent)'
    if (status === 'paused') return 'var(--warning)'
    if (status === 'failed') return 'var(--error)'
    return 'var(--text-secondary)'
  }

  function getStatusLabel(status: string): string {
    return status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  }
</script>

<svelte:window onkeydown={handleEscape} />

<div class="task-detail-view">
  <header class="detail-header">
    <button class="back-button" onclick={handleBack}>
      <span class="back-arrow">←</span>
      Back to Board
    </button>
    <div class="task-header-info">
      <span class="task-id">{task.jira_key || task.id}</span>
      <h1 class="task-title">{task.title}</h1>
      <span class="status-badge" style="background: {getStatusColor(task.status)};">
        {getStatusLabel(task.status)}
      </span>
      {#if hasWorktree}
        <div class="mode-toggle">
          <button class="toggle-btn" class:active={!reviewMode} onclick={() => reviewMode = false}>Code</button>
          <button class="toggle-btn" class:active={reviewMode} onclick={() => reviewMode = true}>Review</button>
        </div>
      {/if}
    </div>
  </header>

  <div class="detail-body">
    {#if reviewMode}
      <SelfReviewView {task} {agentStatus} onSendToAgent={handleSendToAgent} />
    {:else}
      <div class="left-column">
        <AgentPanel taskId={task.id} />
      </div>
      <div class="divider"></div>
      <div class="right-column">
        <TaskInfoPanel task={task} />
      </div>
    {/if}
  </div>
</div>

<style>
  .task-detail-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
    background: var(--bg-primary);
    overflow: hidden;
  }

  .detail-header {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px 24px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .back-button {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: 0.875rem;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    width: fit-content;
  }

  .back-button:hover {
    color: var(--accent);
    border-color: var(--accent);
    background: rgba(122, 162, 247, 0.08);
  }

  .back-arrow {
    font-size: 1.1rem;
    line-height: 1;
  }

  .task-header-info {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .task-id {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  }

  .task-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .status-badge {
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    color: white;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .mode-toggle {
    display: inline-flex;
    align-items: center;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 3px;
    gap: 2px;
    flex-shrink: 0;
  }

  .toggle-btn {
    all: unset;
    padding: 5px 16px;
    border-radius: 16px;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.18s ease;
    white-space: nowrap;
  }

  .toggle-btn:hover:not(.active) {
    color: var(--text-primary);
    background: rgba(122, 162, 247, 0.08);
  }

  .toggle-btn.active {
    background: var(--accent);
    color: #1a1b26;
    font-weight: 600;
  }

  .detail-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .left-column {
    flex: 0 0 70%;
    padding: 24px;
    overflow: hidden;
  }

  .divider {
    width: 1px;
    background: var(--border);
    flex-shrink: 0;
  }

  .right-column {
    flex: 0 0 30%;
    padding: 24px;
    overflow-y: auto;
    background: var(--bg-secondary);
  }

  @media (max-width: 800px) {
    .detail-body {
      flex-direction: column;
    }

    .left-column {
      flex: 1 1 auto;
      padding: 16px;
    }

    .divider {
      width: 100%;
      height: 1px;
    }

    .right-column {
      flex: 0 0 auto;
      padding: 16px;
    }

    .task-title {
      font-size: 1.25rem;
    }
  }
</style>
