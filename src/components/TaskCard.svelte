<script lang="ts">
  import { Pin } from 'lucide-svelte'
  import type { Task, AgentSession, PullRequestInfo } from '../lib/types'
  import { hasMergeConflicts, isReadyToMerge, isQueuedForMerge } from '../lib/types'
  import { computeTaskState, taskStateToBorderClass } from '../lib/taskState'
  import { openUrl } from '../lib/ipc'
  import { timeAgoFromSeconds } from '../lib/timeAgo'
  import Card from './Card.svelte'

  interface Props {
    task: Task
    session?: AgentSession | null
    pullRequests?: PullRequestInfo[]
    isStarting?: boolean
    isPinned?: boolean
    onTogglePin?: (taskId: string, e: MouseEvent | KeyboardEvent) => void
    onSelect?: (taskId: string) => void
  }

  let { task, session = null, pullRequests = [], isStarting = false, isPinned = false, onTogglePin, onSelect }: Props = $props()

  function handleClick() {
    onSelect?.(task.id)
  }

  function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + '...' : text
  }

  function firstLine(text: string): string {
    return text.split('\n')[0]
  }


  let taskState = $derived(computeTaskState(task, session ?? null, pullRequests))
  let borderClass = $derived(taskStateToBorderClass(taskState))

  let statusClass = $derived(session?.status || 'idle')
  let needsInput = $derived(session?.status === 'paused' && session?.checkpoint_data !== null)
  let hasVisibleStatus = $derived(session !== null && ['running', 'completed', 'paused', 'failed', 'interrupted'].includes(session?.status ?? ''))
  let totalUnaddressed = $derived(
    pullRequests.reduce((sum, pr) => sum + (pr.unaddressed_comment_count || 0), 0)
  )
</script>

<Card
  class="group/card block px-4 py-3.5 {borderClass} {isStarting ? 'starting' : ''} {isPinned ? 'border-primary/30' : ''}"
  onclick={handleClick}
>
  <div class="flex items-center justify-between mb-1">
    <div class="flex items-center gap-1.5">
      <span class="font-mono text-[11px] font-semibold text-primary">{task.id}</span>
      {#if task.jira_key}
        <span class="badge badge-ghost badge-xs">{task.jira_key}</span>
      {/if}
      {#if needsInput}
        <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-paused-bg)]">
          <span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-paused-dot)]"></span>
          <span class="text-[10px] font-medium text-[var(--chip-paused-text)]">Needs Input</span>
        </span>
      {/if}
    </div>
    <div class="flex items-center gap-1.5">
      {#if onTogglePin}
        <button
          type="button"
          class="shrink-0 transition-opacity {isPinned ? 'text-primary opacity-100' : 'text-base-content/40 hover:text-base-content/70 opacity-0 group-hover/card:opacity-100'}"
          aria-label={isPinned ? 'Unpin task' : 'Pin task'}
          data-testid={`pin-btn-${task.id}`}
          onclick={(e: MouseEvent) => { e.stopPropagation(); onTogglePin(task.id, e) }}
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onTogglePin(task.id, e)
            }
          }}
        >
          <Pin size={12} aria-hidden="true" class={isPinned ? 'fill-primary' : ''} />
        </button>
      {/if}
      {#if isStarting}
        <span
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-starting-bg)]"
          style="animation: badge-pulse 2s ease-in-out infinite;"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-starting-dot)]"></span>
          <span class="text-[10px] font-medium text-[var(--chip-starting-text)]">Starting</span>
        </span>
      {:else if hasVisibleStatus}
        {#if statusClass === 'running'}
          <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-running-bg)]" style="animation: badge-pulse 2s ease-in-out infinite;">
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-running-dot)]"></span>
            <span class="text-[10px] font-medium text-[var(--chip-running-text)]">Running</span>
          </span>
        {:else if statusClass === 'completed'}
          <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-done-bg)]">
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-done-dot)]"></span>
            <span class="text-[10px] font-medium text-[var(--chip-done-text)]">Done</span>
          </span>
        {:else if statusClass === 'paused'}
          <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-paused-bg)]">
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-paused-dot)]"></span>
            <span class="text-[10px] font-medium text-[var(--chip-paused-text)]">Paused</span>
          </span>
        {:else if statusClass === 'failed'}
          <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-error-bg)]">
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-error-dot)]"></span>
            <span class="text-[10px] font-medium text-[var(--chip-error-text)]">Error</span>
          </span>
        {:else if statusClass === 'interrupted'}
          <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-stopped-bg)]">
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-stopped-dot)]"></span>
            <span class="text-[10px] font-medium text-[var(--chip-stopped-text)]">Stopped</span>
          </span>
        {/if}
      {/if}
      <span class="text-[11px] font-medium text-base-content/40">{timeAgoFromSeconds(task.updated_at)}</span>
    </div>
  </div>
  <div class="text-[15px] font-medium leading-snug text-base-content mb-1">
    {truncate(firstLine(task.initial_prompt || (task.prompt?.split('\n')[0]) || task.id), 80)}
    {#if task.initial_prompt.includes('\n')}
      <span class="text-[10px] text-base-content/40 ml-1">+{task.initial_prompt.split('\n').length - 1} lines</span>
    {/if}
  </div>
  {#if task.summary}
    <div class="text-xs text-base-content/50 truncate mb-1">{task.summary.replace(/\\n/g, '\n')}</div>
  {/if}
  {#if task.jira_title}
    <div class="text-xs text-base-content/50 leading-relaxed mb-1.5">{truncate(task.jira_title, 80)}</div>
  {/if}

  {#if pullRequests.length > 0}
    <div class="flex flex-wrap gap-1.5 mb-1">
      {#each pullRequests as pr}
        <button
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium cursor-pointer transition-opacity hover:opacity-80 {pr.state === 'open' && !isReadyToMerge(pr) ? 'bg-base-200 text-base-content/70' : ''} {pr.state === 'merged' ? 'bg-base-200/50 text-secondary' : ''} {isReadyToMerge(pr) ? 'bg-info/10 text-info border border-info/40' : ''} {pr.state === 'closed' ? 'bg-base-200/50 text-base-content/40' : ''}"
          type="button"
          onclick={(e: MouseEvent) => { e.stopPropagation(); openUrl(pr.url) }}
          onkeydown={(e: KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Enter') openUrl(pr.url) }}
        >
          <span class="font-mono">#{pr.id}</span>
        </button>
      {/each}
    </div>
    <div class="flex flex-wrap gap-1.5 mb-1">
      {#each pullRequests as pr}
        {#if pr.draft && pr.state === 'open'}
          <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-base-200 text-[10px] font-medium text-base-content/50">Draft</span>
        {/if}
        {#if pr.ci_status && pr.ci_status !== 'none' && pr.state === 'open'}
          <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 {pr.ci_status === 'success' ? 'bg-[var(--chip-running-bg)]' : pr.ci_status === 'failure' ? 'bg-[var(--chip-error-bg)]' : 'bg-[var(--chip-paused-bg)]'}">
            <span class="w-1.5 h-1.5 rounded-full {pr.ci_status === 'success' ? 'bg-[var(--chip-running-dot)]' : pr.ci_status === 'failure' ? 'bg-[var(--chip-error-dot)]' : 'bg-[var(--chip-paused-dot)]'}"></span>
            <span class="text-[10px] font-medium {pr.ci_status === 'success' ? 'text-[var(--chip-running-text)]' : pr.ci_status === 'failure' ? 'text-[var(--chip-error-text)] ci-failure-text' : 'text-[var(--chip-paused-text)] ci-pending-text'}">{pr.ci_status === 'success' ? 'Passed' : pr.ci_status === 'failure' ? 'Failed' : 'Pending'}</span>
          </span>
        {/if}
        {#if pr.review_status && pr.review_status !== 'none' && pr.state === 'open'}
          <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 {pr.review_status === 'approved' ? 'bg-[var(--chip-running-bg)]' : pr.review_status === 'changes_requested' ? 'bg-[var(--chip-paused-bg)]' : 'bg-[var(--chip-stopped-bg)]'}">
            <span class="w-1.5 h-1.5 rounded-full {pr.review_status === 'approved' ? 'bg-[var(--chip-running-dot)]' : pr.review_status === 'changes_requested' ? 'bg-[var(--chip-paused-dot)]' : 'bg-[var(--chip-stopped-dot)]'}"></span>
            <span class="text-[10px] font-medium {pr.review_status === 'approved' ? 'text-[var(--chip-running-text)]' : pr.review_status === 'changes_requested' ? 'text-[var(--chip-paused-text)]' : 'text-[var(--chip-stopped-text)] review-pending-text'}">{pr.review_status === 'approved' ? 'Approved' : pr.review_status === 'changes_requested' ? 'Changes req.' : 'Needs review'}</span>
          </span>
        {/if}
        {#if hasMergeConflicts(pr)}
          <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-error-bg)]">
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-error-dot)]"></span>
            <span class="text-[10px] font-medium text-[var(--chip-error-text)]">Merge Conflict</span>
          </span>
        {/if}
      {/each}
    </div>
    {#each pullRequests as pr}
       {#if pr.state === 'merged'}
         <div class="text-[10px] font-medium px-2 py-0.5 rounded mt-1 text-center text-secondary">merged</div>
       {:else if isQueuedForMerge(pr)}
         <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 mt-1 w-fit bg-[var(--chip-done-bg)]">
           <span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-done-dot)]"></span>
           <span class="text-[10px] font-medium text-[var(--chip-done-text)]">Queued for merge</span>
         </span>
       {:else if isReadyToMerge(pr)}
         <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 mt-1 w-fit bg-[var(--chip-done-bg)]">
           <span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-done-dot)]"></span>
           <span class="text-[10px] font-medium text-[var(--chip-done-text)]">Ready to merge</span>
         </span>
       {/if}
    {/each}
  {/if}
  {#if totalUnaddressed > 0}
    <div class="flex items-center gap-1 mt-1">
      <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-error-bg)]">
        <span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-error-dot)]"></span>
        <span class="text-[10px] font-medium text-[var(--chip-error-text)]">{totalUnaddressed} unaddressed</span>
      </span>
    </div>
  {/if}
  {#if task.jira_assignee}
    <div class="text-[10px] text-base-content/50">@{task.jira_assignee}</div>
  {/if}
</Card>
