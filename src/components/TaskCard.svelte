<script lang="ts">
  import type { Task, AgentSession, PullRequestInfo } from '../lib/types'
  import { openUrl } from '../lib/ipc'

  interface Props {
    task: Task
    session?: AgentSession | null
    pullRequests?: PullRequestInfo[]
    onSelect?: (taskId: string) => void
  }

  let { task, session = null, pullRequests = [], onSelect }: Props = $props()

  function handleClick() {
    onSelect?.(task.id)
  }

  function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + '...' : text
  }

  function stageLabel(stage: string): string {
    const labels: Record<string, string> = {
      read_ticket: 'Reading ticket',
      implement: 'Implementing',
      create_pr: 'Creating PR',
      address_comments: 'Addressing comments',
    }
    return labels[stage] || stage
  }

  let statusClass = $derived(session?.status || 'idle')
  let needsInput = $derived(session?.status === 'paused' && session?.checkpoint_data !== null)
  let hasVisibleStatus = $derived(session !== null && ['running', 'completed', 'paused', 'failed', 'interrupted'].includes(session?.status ?? ''))
</script>

<button class="card" class:running={statusClass === 'running'} class:paused={statusClass === 'paused'} class:failed={statusClass === 'failed'} class:interrupted={statusClass === 'interrupted'} class:completed={statusClass === 'completed'} class:needs-input={needsInput} onclick={handleClick}>
  <div class="card-header">
    <div class="id-row">
      <span class="task-id">{task.id}</span>
      {#if task.jira_key}
        <span class="jira-badge">{task.jira_key}</span>
      {/if}
      {#if needsInput}
        <span class="needs-input-badge">Needs Input</span>
      {/if}
    </div>
    {#if hasVisibleStatus}
      <span class="status-badge {statusClass}">
        {#if statusClass === 'running'}
          Running
        {:else if statusClass === 'completed'}
          Done
        {:else if statusClass === 'paused'}
          Paused
        {:else if statusClass === 'failed'}
          Error
        {:else if statusClass === 'interrupted'}
          Stopped
        {/if}
      </span>
    {/if}
  </div>
  <div class="card-title">{truncate(task.title, 60)}</div>
  {#if session}
    <div class="card-status {statusClass}">
      {#if session.status === 'running'}
        {stageLabel(session.stage)}...
      {:else if session.status === 'paused'}
        Awaiting approval
      {:else if session.status === 'failed'}
        {session.error_message || 'Error'}
      {:else if session.status === 'interrupted'}
        Interrupted
      {:else if session.status === 'completed'}
        Completed
      {/if}
    </div>
  {/if}
  {#if pullRequests.length > 0}
    <div class="card-prs">
      {#each pullRequests as pr}
        <span
          class="pr-link"
          class:pr-open={pr.state === 'open'}
          class:pr-closed={pr.state !== 'open'}
          role="link"
          tabindex="0"
          onclick={(e: MouseEvent) => { e.stopPropagation(); openUrl(pr.url) }}
          onkeydown={(e: KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Enter') openUrl(pr.url) }}
        >
          PR #{pr.id}
        </span>
      {/each}
    </div>
  {/if}
  {#if task.jira_assignee}
    <div class="card-assignee">{task.jira_assignee}</div>
  {/if}
</button>

<style>
  .card {
    all: unset;
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .card:hover {
    border-color: var(--accent);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .card.running {
    border-left: 3px solid var(--success);
    background: linear-gradient(to right, rgba(158, 206, 106, 0.05), transparent 40%);
  }

  .card.completed {
    border-left: 3px solid var(--accent);
    background: linear-gradient(to right, rgba(122, 162, 247, 0.08), transparent 40%);
  }

  .card.paused {
    border-left: 3px solid var(--warning);
    background: linear-gradient(to right, rgba(224, 175, 104, 0.05), transparent 40%);
  }

  .card.failed {
    border-left: 3px solid var(--error);
    background: linear-gradient(to right, rgba(247, 118, 142, 0.05), transparent 40%);
  }

  .card.interrupted {
    border-left: 3px solid var(--text-secondary);
    background: linear-gradient(to right, rgba(86, 95, 137, 0.05), transparent 40%);
  }

  .card.needs-input {
    border: 2px solid var(--warning);
    background: rgba(224, 175, 104, 0.08);
    box-shadow: 0 0 12px rgba(224, 175, 104, 0.15);
    animation: needs-input-pulse 2s ease-in-out infinite;
  }

  @keyframes needs-input-pulse {
    0%, 100% {
      box-shadow: 0 0 12px rgba(224, 175, 104, 0.15);
    }
    50% {
      box-shadow: 0 0 20px rgba(224, 175, 104, 0.3);
    }
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .id-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .task-id {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent);
    letter-spacing: 0.02em;
  }

  .jira-badge {
    font-size: 0.65rem;
    font-weight: 500;
    padding: 1px 5px;
    background: rgba(86, 95, 137, 0.15);
    color: var(--text-secondary);
    border-radius: 3px;
    letter-spacing: 0.01em;
  }

  .needs-input-badge {
    font-size: 0.65rem;
    font-weight: 600;
    padding: 1px 5px;
    background: rgba(224, 175, 104, 0.15);
    color: var(--warning);
    border-radius: 3px;
    letter-spacing: 0.01em;
    animation: pulse 1.5s infinite;
  }

  .status-badge {
    font-size: 0.6rem;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 3px;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    white-space: nowrap;
    line-height: 1.3;
  }

  .status-badge.running {
    background: rgba(158, 206, 106, 0.15);
    color: var(--success);
    animation: badge-pulse 2s ease-in-out infinite;
  }

  .status-badge.completed {
    background: rgba(122, 162, 247, 0.2);
    color: var(--accent);
  }

  .status-badge.paused {
    background: rgba(224, 175, 104, 0.15);
    color: var(--warning);
  }

  .status-badge.failed {
    background: rgba(247, 118, 142, 0.15);
    color: var(--error);
  }

  .status-badge.interrupted {
    background: rgba(86, 95, 137, 0.15);
    color: var(--text-secondary);
  }

  @keyframes badge-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  .card-title {
    font-size: 0.85rem;
    color: var(--text-primary);
    line-height: 1.3;
    margin-bottom: 6px;
  }

  .card-status {
    font-size: 0.7rem;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }

  .card-status.running {
    color: var(--success);
  }

  .card-status.completed {
    color: var(--accent);
  }

  .card-status.failed {
    color: var(--error);
  }

  .card-status.paused {
    color: var(--warning);
  }

  .card-prs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 4px;
  }

  .pr-link {
    font-size: 0.65rem;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 4px;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .pr-link:hover {
    opacity: 0.8;
  }

  .pr-link.pr-open {
    background: rgba(158, 206, 106, 0.15);
    color: var(--success);
  }

  .pr-link.pr-closed {
    background: rgba(86, 95, 137, 0.2);
    color: var(--text-secondary);
  }

  .card-assignee {
    font-size: 0.7rem;
    color: var(--text-secondary);
  }
</style>
