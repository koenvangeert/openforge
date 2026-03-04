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

  function firstLine(text: string): string {
    return text.split('\n')[0]
  }


  let statusClass = $derived(session?.status || 'idle')
  let needsInput = $derived(session?.status === 'paused' && session?.checkpoint_data !== null)
  let hasVisibleStatus = $derived(session !== null && ['running', 'completed', 'paused', 'failed', 'interrupted'].includes(session?.status ?? ''))
  let hasCiFailure = $derived(pullRequests.some(pr => pr.ci_status === 'failure' && pr.state === 'open'))
  let hasPendingCi = $derived(pullRequests.some(pr => pr.ci_status === 'pending' && pr.state === 'open'))
  let totalUnaddressed = $derived(
    pullRequests.reduce((sum, pr) => sum + (pr.unaddressed_comment_count || 0), 0)
  )
</script>

<Card
  class="block px-3.5 py-3 {hasCiFailure && !hasPendingCi && statusClass !== 'running' && !needsInput ? 'ci-failed' : ''} {statusClass === 'running' ? 'running' : ''} {statusClass === 'paused' && !needsInput ? 'paused' : ''} {statusClass === 'failed' ? 'failed' : ''} {statusClass === 'interrupted' ? 'interrupted' : ''} {statusClass === 'completed' ? 'completed' : ''} {needsInput ? 'needs-input' : ''}"
  onclick={handleClick}
>
  <div class="flex items-center justify-between mb-1">
    <div class="flex items-center gap-1.5">
      <span class="font-mono text-xs font-semibold text-primary">{task.id}</span>
      {#if task.jira_key}
        <span class="badge badge-ghost badge-xs font-mono">{task.jira_key}</span>
      {/if}
      {#if needsInput}
        <span class="badge badge-warning badge-xs font-mono animate-pulse">Needs Input</span>
      {/if}
    </div>
    {#if hasVisibleStatus}
      <span
        class="font-mono text-[0.6rem] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap leading-tight {statusClass === 'running' ? 'bg-success/15 text-success' : ''} {statusClass === 'completed' ? 'bg-primary/20 text-primary' : ''} {statusClass === 'paused' ? 'bg-warning/15 text-warning' : ''} {statusClass === 'failed' ? 'bg-error/15 text-error' : ''} {statusClass === 'interrupted' ? 'bg-base-content/15 text-base-content/50' : ''}"
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
  <div class="font-mono text-sm font-medium leading-relaxed text-base-content mb-1">
    {truncate(firstLine(task.title), 80)}
    {#if task.title.includes('\n')}
      <span class="font-mono text-[0.6rem] text-base-content/40 ml-1">+{task.title.split('\n').length - 1} lines</span>
    {/if}
  </div>
  {#if task.jira_title}
    <div class="text-secondary font-mono text-[11px] leading-relaxed mb-1.5">// {truncate(task.jira_title, 80)}</div>
  {/if}

  {#if pullRequests.length > 0}
    <div class="flex flex-wrap gap-1 mb-1">
      {#each pullRequests as pr}
        <span
          class="font-mono text-[10px] font-semibold px-1.5 py-px rounded cursor-pointer transition-opacity hover:opacity-80 {pr.state === 'open' && !isReadyToMerge(pr) ? 'text-primary' : ''} {pr.state === 'merged' ? 'text-secondary' : ''} {isReadyToMerge(pr) ? 'text-primary border border-primary/40' : ''} {pr.state === 'closed' ? 'text-base-content/40' : ''}"
          role="link"
          tabindex="0"
          onclick={(e: MouseEvent) => { e.stopPropagation(); openUrl(pr.url) }}
          onkeydown={(e: KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Enter') openUrl(pr.url) }}
        >
          $ pr #{pr.id}
          {#if pr.ci_status && pr.ci_status !== 'none' && pr.state === 'open'}
            <span class="text-base-content/30 mx-px">::</span>
            <span
              class="font-mono {pr.ci_status === 'success' ? 'text-success' : ''} {pr.ci_status === 'failure' ? 'text-error ci-failure-text' : ''} {pr.ci_status === 'pending' ? 'text-warning ci-pending-text' : ''}"
            >{pr.ci_status === 'success' ? 'Passed' : pr.ci_status === 'failure' ? 'Failed' : 'Pending'}</span>
          {/if}
          {#if pr.review_status && pr.review_status !== 'none' && pr.state === 'open'}
            <span class="text-base-content/30 mx-px">::</span>
            <span
              class="font-mono {pr.review_status === 'approved' ? 'text-success' : ''} {pr.review_status === 'changes_requested' ? 'text-warning' : ''} {pr.review_status === 'review_required' ? 'text-base-content/50 review-pending-text' : ''}"
            >{pr.review_status === 'approved' ? 'Approved' : pr.review_status === 'changes_requested' ? 'Changes req.' : 'Needs review'}</span>
          {/if}
        </span>
      {/each}
    </div>
    {#each pullRequests as pr}
      {#if pr.state === 'merged'}
        <div class="font-mono text-[10px] font-semibold px-2 py-0.5 rounded mt-1 text-center text-secondary">// merged</div>
      {:else if isReadyToMerge(pr)}
        <div class="font-mono text-[10px] font-semibold px-2 py-0.5 rounded mt-1 text-center text-primary border border-primary/30">$ ready to merge</div>
      {/if}
    {/each}
  {/if}
  {#if totalUnaddressed > 0}
    <div class="flex items-center gap-1 mt-1">
      <span class="font-mono text-[10px] text-error">! {totalUnaddressed} unaddressed</span>
    </div>
  {/if}
  {#if task.jira_assignee}
    <div class="text-secondary font-mono text-[10px]">@{task.jira_assignee}</div>
  {/if}
</Card>
