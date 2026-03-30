<script lang="ts">
  import type { AuthoredPullRequest } from '../../../lib/types'
  import { hasMergeConflicts } from '../../../lib/types'
  import Card from '../../shared/ui/Card.svelte'
  import { timeAgoFromSeconds } from '../../../lib/timeAgo'

  interface Props {
    pr: AuthoredPullRequest
    selected?: boolean
    onClick: () => void
  }

  let { pr, selected = false, onClick }: Props = $props()

  let hasConflict = $derived(hasMergeConflicts(pr))
</script>

<Card
  class="flex flex-col gap-2.5 p-4 duration-150 {!selected ? 'hover:-translate-y-px' : ''}"
  {selected}
  onclick={onClick}
>
  <div class="flex items-center gap-2">
    <span class="inline-flex items-center px-2 py-0.5 text-[0.7rem] font-semibold text-primary bg-primary/15 rounded">{pr.repo_owner}/{pr.repo_name}</span>
    {#if pr.draft}
      <span class="inline-flex items-center px-2 py-0.5 text-[0.7rem] font-semibold text-base-content/50 bg-base-200 border border-base-300 rounded">Draft</span>
    {/if}
    {#if pr.task_id}
      <span class="inline-flex items-center px-2 py-0.5 text-[0.7rem] font-semibold text-secondary bg-secondary/15 rounded">{pr.task_id}</span>
    {/if}
  </div>

  <div class="flex items-start">
    <h3 class="text-[0.9rem] font-medium text-base-content m-0 leading-snug">{pr.title}</h3>
  </div>

  <div class="flex items-center gap-2 text-xs text-base-content/50">
    <span class="font-semibold text-base-content">#{pr.number}</span>
    <span class="text-base-300">•</span>
    <span class="font-medium">{pr.head_ref}</span>
    <span class="text-base-300">•</span>
    <span>{timeAgoFromSeconds(pr.created_at)}</span>
  </div>

  <div class="flex items-center gap-2 text-xs">
    {#if pr.ci_status === 'success'}
      <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-running-bg)]"><span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-running-dot)]"></span><span class="text-[10px] font-medium text-[var(--chip-running-text)]">CI Passed</span></span>
    {:else if pr.ci_status === 'failure'}
      <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-error-bg)]"><span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-error-dot)]"></span><span class="text-[10px] font-medium text-[var(--chip-error-text)]">CI Failed</span></span>
    {:else if pr.ci_status === 'pending'}
      <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-paused-bg)]"><span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-paused-dot)]"></span><span class="text-[10px] font-medium text-[var(--chip-paused-text)]">CI Pending</span></span>
    {/if}

    {#if pr.review_status === 'approved'}
      <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-running-bg)]"><span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-running-dot)]"></span><span class="text-[10px] font-medium text-[var(--chip-running-text)]">Approved</span></span>
    {:else if pr.review_status === 'changes_requested'}
      <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-paused-bg)]"><span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-paused-dot)]"></span><span class="text-[10px] font-medium text-[var(--chip-paused-text)]">Changes Req.</span></span>
    {:else if pr.review_status === 'pending'}
      <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-stopped-bg)]"><span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-stopped-dot)]"></span><span class="text-[10px] font-medium text-[var(--chip-stopped-text)]">Pending Review</span></span>
    {/if}

    {#if pr.is_queued && pr.state === 'open'}
      <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-done-bg)]"><span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-done-dot)]"></span><span class="text-[10px] font-medium text-[var(--chip-done-text)]">Queued</span></span>
    {/if}

    {#if hasConflict}
      <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[var(--chip-error-bg)]"><span class="w-1.5 h-1.5 rounded-full bg-[var(--chip-error-dot)]"></span><span class="text-[10px] font-medium text-[var(--chip-error-text)]">Merge Conflict</span></span>
    {/if}

    <span class="flex-1"></span>
    <span class="font-medium text-base-content/50">{pr.changed_files} {pr.changed_files === 1 ? 'file' : 'files'}</span>
    <span class="text-base-300">•</span>
    <span class="font-medium text-success">+{pr.additions}</span>
    <span class="font-medium text-error">−{pr.deletions}</span>
  </div>
</Card>
