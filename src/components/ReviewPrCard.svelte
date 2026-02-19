<script lang="ts">
  import type { ReviewPullRequest } from '../lib/types'
  import Card from './Card.svelte'

  interface Props {
    pr: ReviewPullRequest
    selected?: boolean
    onClick: () => void
  }

  let { pr, selected = false, onClick }: Props = $props()

  function timeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }
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
  </div>

  <div class="flex items-start">
    <h3 class="text-[0.9rem] font-medium text-base-content m-0 leading-snug">{pr.title}</h3>
  </div>

  <div class="flex items-center gap-2 text-xs text-base-content/50">
    <span class="font-semibold text-base-content">#{pr.number}</span>
    <span class="text-base-300">•</span>
    <span class="font-medium">{pr.user_login}</span>
    <span class="text-base-300">•</span>
    <span>{timeAgo(pr.created_at)}</span>
  </div>

  <div class="flex items-center gap-2 text-xs">
    <span class="font-medium text-base-content/50">{pr.changed_files} {pr.changed_files === 1 ? 'file' : 'files'}</span>
    <span class="text-base-300">•</span>
    <span class="font-medium text-success">+{pr.additions}</span>
    <span class="font-medium text-error">−{pr.deletions}</span>
  </div>
</Card>
