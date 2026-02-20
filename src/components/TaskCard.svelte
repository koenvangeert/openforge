<script lang="ts">
  import type { Task, AgentSession, PullRequestInfo } from '../lib/types'
  import { isReadyToMerge } from '../lib/types'
  import { openUrl } from '../lib/ipc'
  import Card from './Card.svelte'

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

  let statusClass = $derived(session?.status || 'idle')
  let needsInput = $derived(session?.status === 'paused' && session?.checkpoint_data !== null)
  let hasVisibleStatus = $derived(session !== null && ['running', 'completed', 'paused', 'failed', 'interrupted'].includes(session?.status ?? ''))
  let hasCiFailure = $derived(pullRequests.some(pr => pr.ci_status === 'failure' && pr.state === 'open'))
  let totalUnaddressed = $derived(
    pullRequests.reduce((sum, pr) => sum + (pr.unaddressed_comment_count || 0), 0)
  )
</script>

<Card
  class="block px-3 py-2.5 {hasCiFailure && statusClass !== 'running' && !needsInput ? 'ci-failed' : ''} {statusClass === 'running' ? 'running' : ''} {statusClass === 'paused' && !needsInput ? 'paused' : ''} {statusClass === 'failed' ? 'failed' : ''} {statusClass === 'interrupted' ? 'interrupted' : ''} {statusClass === 'completed' ? 'completed' : ''} {needsInput ? 'needs-input' : ''}"
  onclick={handleClick}
>
  <div class="flex items-center justify-between mb-1">
    <div class="flex items-center gap-1.5">
      <span class="text-xs font-semibold text-primary tracking-wide">{task.id}</span>
      {#if task.jira_key}
        <span class="badge badge-ghost badge-xs">{task.jira_key}</span>
      {/if}
      {#if needsInput}
        <span class="badge badge-warning badge-xs animate-pulse">Needs Input</span>
      {/if}
    </div>
    {#if hasVisibleStatus}
      <span
        class="text-[0.6rem] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap leading-tight {statusClass === 'running' ? 'bg-success/15 text-success' : ''} {statusClass === 'completed' ? 'bg-primary/20 text-primary' : ''} {statusClass === 'paused' ? 'bg-warning/15 text-warning' : ''} {statusClass === 'failed' ? 'bg-error/15 text-error' : ''} {statusClass === 'interrupted' ? 'bg-base-content/15 text-base-content/50' : ''}"
        style={statusClass === 'running' ? 'animation: badge-pulse 2s ease-in-out infinite;' : ''}
      >
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
  <div class="text-sm text-base-content leading-tight mb-1">{truncate(task.title, 60)}</div>
  {#if task.jira_title}
    <div class="text-xs text-base-content/50 leading-tight mb-1.5">{truncate(task.jira_title, 80)}</div>
  {/if}

  {#if pullRequests.length > 0}
    <div class="flex flex-wrap gap-1 mb-1">
      {#each pullRequests as pr}
        <span
          class="text-[0.65rem] font-semibold px-1.5 py-px rounded cursor-pointer transition-opacity hover:opacity-80 {pr.state === 'open' && !isReadyToMerge(pr) ? 'bg-success/15 text-success' : ''} {pr.state === 'merged' ? 'bg-secondary/15 text-secondary' : ''} {isReadyToMerge(pr) ? 'bg-success/25 text-success border border-success/40' : ''} {pr.state === 'closed' ? 'bg-base-content/20 text-base-content/50' : ''}"
          role="link"
          tabindex="0"
          onclick={(e: MouseEvent) => { e.stopPropagation(); openUrl(pr.url) }}
          onkeydown={(e: KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Enter') openUrl(pr.url) }}
        >
          PR #{pr.id}
          {#if pr.ci_status && pr.ci_status !== 'none' && pr.state === 'open'}
            <span class="text-base-content/30 mx-px">·</span>
            <span
              class="{pr.ci_status === 'success' ? 'text-success' : ''} {pr.ci_status === 'failure' ? 'text-error ci-failure-text' : ''} {pr.ci_status === 'pending' ? 'text-warning ci-pending-text' : ''}"
            >{pr.ci_status === 'success' ? 'Passed' : pr.ci_status === 'failure' ? 'Failed' : 'Pending'}</span>
          {/if}
          {#if pr.review_status && pr.review_status !== 'none' && pr.state === 'open'}
            <span class="text-base-content/30 mx-px">·</span>
            <span
              class="{pr.review_status === 'approved' ? 'text-success' : ''} {pr.review_status === 'changes_requested' ? 'text-warning' : ''} {pr.review_status === 'review_required' ? 'text-base-content/50 review-pending-text' : ''}"
            >{pr.review_status === 'approved' ? 'Approved' : pr.review_status === 'changes_requested' ? 'Changes req.' : 'Needs review'}</span>
          {/if}
        </span>
      {/each}
    </div>
    {#each pullRequests as pr}
      {#if pr.state === 'merged'}
        <div class="text-[0.7rem] font-semibold px-2 py-0.5 rounded mt-1 text-center bg-secondary/15 text-secondary">Merged</div>
      {:else if isReadyToMerge(pr)}
        <div class="text-[0.7rem] font-semibold px-2 py-0.5 rounded mt-1 text-center bg-success/15 text-success border border-success/30">Ready to merge</div>
      {/if}
    {/each}
  {/if}
  {#if totalUnaddressed > 0}
    <div class="flex items-center gap-1 mt-1">
      <span class="badge badge-error badge-xs">{totalUnaddressed} unaddressed</span>
    </div>
  {/if}
  {#if task.jira_assignee}
    <div class="text-[0.7rem] text-base-content/50">{task.jira_assignee}</div>
  {/if}
</Card>

<style>
  /* Status border indicators — daisyUI v5 vars are full oklch() values, use var() directly */
  :global(.running) {
    border: 2px solid var(--color-success);
    background-color: var(--color-base-100);
    background-image: linear-gradient(to right, color-mix(in oklch, var(--color-success) 5%, transparent), transparent 40%);
    animation: border-pulse-success 2s ease-in-out infinite;
  }
  :global(.completed) {
    border-left: 3px solid var(--color-primary);
    background-image: linear-gradient(to right, color-mix(in oklch, var(--color-primary) 8%, transparent), transparent 40%);
  }
  :global(.paused) {
    border-left: 3px solid var(--color-warning);
    background-image: linear-gradient(to right, color-mix(in oklch, var(--color-warning) 5%, transparent), transparent 40%);
  }
  :global(.failed) {
    border-left: 3px solid var(--color-error);
    background-image: linear-gradient(to right, color-mix(in oklch, var(--color-error) 5%, transparent), transparent 40%);
  }
  :global(.interrupted) {
    border-left: 3px solid color-mix(in oklch, var(--color-base-content) 30%, transparent);
    background-image: linear-gradient(to right, color-mix(in oklch, var(--color-base-content) 3%, transparent), transparent 40%);
  }
  :global(.needs-input) {
    border: 2px solid var(--color-warning);
    background-color: var(--color-base-100);
    animation: border-pulse-warning 2s ease-in-out infinite;
  }
  :global(.ci-failed) {
    border: 2px solid var(--color-error);
    background-image: linear-gradient(to right, color-mix(in oklch, var(--color-error) 8%, transparent), transparent 40%);
  }
  @keyframes border-pulse-success {
    0%, 100% {
      border-color: var(--color-success);
      box-shadow: 0 0 8px color-mix(in oklch, var(--color-success) 30%, transparent);
    }
    50% {
      border-color: color-mix(in oklch, var(--color-success) 40%, transparent);
      box-shadow: 0 0 3px color-mix(in oklch, var(--color-success) 10%, transparent);
    }
  }
  @keyframes border-pulse-warning {
    0%, 100% {
      border-color: var(--color-warning);
      box-shadow: 0 0 8px color-mix(in oklch, var(--color-warning) 30%, transparent);
    }
    50% {
      border-color: color-mix(in oklch, var(--color-warning) 40%, transparent);
      box-shadow: 0 0 3px color-mix(in oklch, var(--color-warning) 10%, transparent);
    }
  }
  @keyframes badge-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  @keyframes ci-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  /* CI/Review text animations */
  :global(.ci-failure-text) {
    animation: ci-pulse 1.5s ease-in-out infinite;
  }
  :global(.ci-pending-text) {
    animation: ci-pulse 2s ease-in-out infinite;
  }
  :global(.review-pending-text) {
    animation: ci-pulse 2s ease-in-out infinite;
  }
</style>
