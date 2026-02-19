<script lang="ts">
  import type { Task, Action } from '../lib/types'
  import { selectedTaskId, activeSessions, activeProjectId } from '../lib/stores'
  import { getWorktreeForTask } from '../lib/ipc'
  import { loadActions, getEnabledActions } from '../lib/actions'
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
  let actions = $state<Action[]>([])

  let currentSession = $derived($activeSessions.get(task.id))
  let agentStatus = $derived(currentSession?.status ?? null)
  let isSessionBusy = $derived(currentSession?.status === 'running' || currentSession?.status === 'paused')
  let busyReason = $derived(currentSession?.status === 'running' ? 'Agent is busy' : currentSession?.status === 'paused' ? 'Answer pending question first' : '')

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

  $effect(() => {
    if ($activeProjectId) {
      loadActions($activeProjectId).then(a => { actions = getEnabledActions(a) })
    }
  })

  function handleBack() {
    $selectedTaskId = null
  }

  function handleActionClick(action: Action) {
    onRunAction({ taskId: task.id, actionPrompt: action.prompt, agent: action.agent ?? null })
  }

  function handleEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      $selectedTaskId = null
    }
  }

  function handleSendToAgent(prompt: string) {
    onRunAction({ taskId: task.id, actionPrompt: prompt, agent: null })
  }

  function getStatusLabel(status: string): string {
    return status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  }
</script>

<svelte:window onkeydown={handleEscape} />

<div class="flex flex-col flex-1 h-full bg-base-100 overflow-hidden">
  <header class="flex flex-col gap-4 px-6 py-5 bg-base-200 border-b border-base-300 shrink-0">
    <button class="btn btn-ghost btn-sm gap-2 w-fit border border-base-300" onclick={handleBack}>
      <span class="text-lg leading-none">←</span>
      Back to Board
    </button>
    <div class="flex items-center gap-3">
      <span class="text-[0.8125rem] font-semibold text-base-content/50 font-mono">{task.jira_key || task.id}</span>
      <h1 class="text-2xl font-bold text-base-content m-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap min-w-0 max-[800px]:text-xl">{task.title}</h1>
      <span class="badge {task.status === 'doing' ? 'badge-success' : task.status === 'done' ? 'badge-primary' : 'badge-ghost'} uppercase tracking-wider text-xs font-semibold">
        {getStatusLabel(task.status)}
      </span>
      {#if hasWorktree}
        <div class="inline-flex items-center bg-base-300 border border-base-300 rounded-full p-0.5 gap-0.5 shrink-0">
          <button class="btn btn-ghost btn-xs rounded-full px-4 {!reviewMode ? 'btn-active bg-primary text-primary-content font-semibold' : ''}" onclick={() => reviewMode = false}>Code</button>
          <button class="btn btn-ghost btn-xs rounded-full px-4 {reviewMode ? 'btn-active bg-primary text-primary-content font-semibold' : ''}" onclick={() => reviewMode = true}>Review</button>
        </div>
      {/if}
      {#if actions.length > 0}
        <div class="action-buttons">
          {#each actions as action (action.id)}
            <button
              class="header-action-btn"
              disabled={isSessionBusy}
              title={isSessionBusy ? busyReason : action.name}
              onclick={() => handleActionClick(action)}
            >
              {action.name}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </header>

  <div class="flex flex-1 overflow-hidden max-[800px]:flex-col">
    {#if reviewMode}
      <SelfReviewView {task} {agentStatus} onSendToAgent={handleSendToAgent} />
    {:else}
      <div class="basis-[70%] p-6 overflow-hidden max-[800px]:basis-auto max-[800px]:p-4">
        <AgentPanel taskId={task.id} />
      </div>
      <div class="w-px bg-base-300 shrink-0 max-[800px]:w-full max-[800px]:h-px"></div>
      <div class="basis-[30%] p-6 overflow-y-auto bg-base-200 max-[800px]:basis-auto max-[800px]:p-4">
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

  .action-buttons {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .header-action-btn {
    all: unset;
    display: inline-flex;
    align-items: center;
    padding: 5px 12px;
    font-size: 0.8rem;
    font-weight: 500;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }

  .header-action-btn:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent);
    background: rgba(122, 162, 247, 0.08);
  }

  .header-action-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
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
>>>>>>> 81868ca (feat(ui): add action buttons to task detail view header)
