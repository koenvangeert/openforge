<script lang="ts">
  import type { AuthoredPullRequest } from '../lib/types'
  import Card from './Card.svelte'
  import { timeAgoFromSeconds } from '../lib/timeAgo'

  interface Props {
    pr: AuthoredPullRequest
    selected?: boolean
    onClick: () => void
  }

  let { pr, selected = false, onClick }: Props = $props()
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
      <span class="inline-flex items-center px-1.5 py-0.5 font-semibold text-success bg-success/15 rounded">CI Passed</span>
    {:else if pr.ci_status === 'failure'}
      <span class="inline-flex items-center px-1.5 py-0.5 font-semibold text-error bg-error/15 rounded">CI Failed</span>
    {:else if pr.ci_status === 'pending'}
      <span class="inline-flex items-center px-1.5 py-0.5 font-semibold text-warning bg-warning/15 rounded">CI Pending</span>
    {/if}

    {#if pr.review_status === 'approved'}
      <span class="inline-flex items-center px-1.5 py-0.5 font-semibold text-success bg-success/15 rounded">Approved</span>
    {:else if pr.review_status === 'changes_requested'}
      <span class="inline-flex items-center px-1.5 py-0.5 font-semibold text-warning bg-warning/15 rounded">Changes Req.</span>
    {:else if pr.review_status === 'pending'}
      <span class="inline-flex items-center px-1.5 py-0.5 font-semibold text-base-content/50 bg-base-content/10 rounded">Pending Review</span>
    {/if}

    <span class="flex-1"></span>
    <span class="font-medium text-base-content/50">{pr.changed_files} {pr.changed_files === 1 ? 'file' : 'files'}</span>
    <span class="text-base-300">•</span>
    <span class="font-medium text-success">+{pr.additions}</span>
    <span class="font-medium text-error">−{pr.deletions}</span>
  </div>
</Card>
