<script lang="ts">
  import type { Task, AgentSession, PullRequestInfo } from '../lib/types'
  import { openUrl } from '../lib/ipc'
  import { createEventDispatcher } from 'svelte'

  export let task: Task
  export let session: AgentSession | null = null
  export let pullRequests: PullRequestInfo[] = []

  const dispatch = createEventDispatcher()

  function handleClick() {
    dispatch('select', task.id)
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

  $: statusClass = session?.status || 'idle'
  $: needsInput = session?.status === 'paused' && session?.checkpoint_data !== null
</script>

<button class="card" class:running={statusClass === 'running'} class:paused={statusClass === 'paused'} class:failed={statusClass === 'failed'} on:click={handleClick}>
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
    {#if session}
      <span class="status-dot {statusClass}"></span>
    {/if}
  </div>
  <div class="card-title">{truncate(task.title, 60)}</div>
  {#if session}
    <div class="card-status">
      {#if session.status === 'running'}
        {stageLabel(session.stage)}...
      {:else if session.status === 'paused'}
        Awaiting approval
      {:else if session.status === 'failed'}
        {session.error_message || 'Error'}
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
          on:click|stopPropagation={() => openUrl(pr.url)}
          on:keydown|stopPropagation={(e) => e.key === 'Enter' && openUrl(pr.url)}
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
  }

  .card.paused {
    border-left: 3px solid var(--warning);
  }

  .card.failed {
    border-left: 3px solid var(--error);
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

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-dot.running {
    background: var(--success);
    animation: pulse 1.5s infinite;
  }

  .status-dot.paused {
    background: var(--warning);
  }

  .status-dot.failed {
    background: var(--error);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
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
