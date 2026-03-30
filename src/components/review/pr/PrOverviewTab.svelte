<script lang="ts">
  import { onMount } from 'svelte'
  import { prOverviewComments } from '../../../lib/stores'
  import { getPrOverviewComments } from '../../../lib/ipc'
  import { timeAgo, timeAgoFromSeconds } from '../../../lib/timeAgo'
  import type { ReviewPullRequest, PrOverviewComment } from '../../../lib/types'
  import MarkdownContent from '../../shared/content/MarkdownContent.svelte'

  interface Props {
    pr: ReviewPullRequest
  }

  let { pr }: Props = $props()

  let isLoading = $state(false)
  let error = $state<string | null>(null)

  async function loadComments() {
    isLoading = true
    error = null
    try {
      const comments = await getPrOverviewComments(pr.repo_owner, pr.repo_name, pr.number)
      $prOverviewComments = comments
    } catch (e) {
      console.error('Failed to load PR overview comments:', e)
      error = 'Failed to load PR overview.'
    } finally {
      isLoading = false
    }
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr)
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }



  function commentIcon(comment: PrOverviewComment): string {
    if (comment.comment_type === 'review_body') return '📋'
    if (comment.comment_type === 'review_comment') return '💬'
    return '🗨'
  }

  function commentTypeLabel(comment: PrOverviewComment): string {
    if (comment.comment_type === 'review_body') return 'Review summary'
    if (comment.comment_type === 'review_comment') return 'Code review comment'
    return 'General comment'
  }

  onMount(() => {
    loadComments()
  })
</script>

<div class="flex-1 overflow-y-auto">
  <div class="max-w-[900px] mx-auto p-6 flex flex-col gap-6">
    <div class="bg-base-100 border border-base-300 rounded-lg overflow-hidden">
      <div class="flex items-center gap-3 px-5 py-3 bg-base-200 border-b border-base-300">
        <div class="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary shrink-0">
          {pr.user_login.charAt(0).toUpperCase()}
        </div>
        <div class="flex items-center gap-2 text-sm flex-wrap">
          <span class="font-semibold text-base-content">{pr.user_login}</span>
          <span class="text-base-content/50">opened this pull request</span>
          <span class="text-base-content/50" title={formatDate(new Date(pr.created_at * 1000).toISOString())}>{timeAgoFromSeconds(pr.created_at)}</span>
        </div>
      </div>
      <div class="px-5 py-4">
        {#if pr.body}
          <MarkdownContent content={pr.body} />
        {:else}
          <p class="text-sm text-base-content/50 italic m-0">No description provided.</p>
        {/if}
      </div>
    </div>

    <div class="flex items-center gap-3 flex-wrap text-xs">
      <span class="badge badge-outline gap-1">
        <span class="text-base-content/50">{pr.head_ref}</span>
        <span class="text-base-content/30">→</span>
        <span class="text-base-content/50">{pr.base_ref}</span>
      </span>
      <span class="badge badge-outline gap-1">
        <span class="text-success">+{pr.additions}</span>
        <span class="text-error">−{pr.deletions}</span>
      </span>
      <span class="badge badge-outline">{pr.changed_files} {pr.changed_files === 1 ? 'file' : 'files'} changed</span>
    </div>

    {#if isLoading}
      <div class="flex flex-col items-center justify-center gap-3 py-10 text-base-content/50 text-sm">
        <span class="loading loading-spinner loading-md text-primary"></span>
        <span>Loading comments...</span>
      </div>
    {:else if error}
      <div class="flex flex-col items-center justify-center gap-3 py-10 text-error text-sm text-center">
        <span class="text-3xl">⚠</span>
        <span>{error}</span>
      </div>
    {:else if $prOverviewComments.length === 0}
      <div class="text-sm text-base-content/50 text-center py-6">No comments on this pull request yet.</div>
    {:else}
      <div class="flex flex-col gap-4">
        {#each $prOverviewComments as comment (comment.id)}
          <div class="bg-base-100 border border-base-300 rounded-lg overflow-hidden {comment.comment_type === 'review_comment' ? 'border-l-4 border-l-primary/40' : comment.comment_type === 'review_body' ? 'border-l-4 border-l-accent/40' : ''}">
            <div class="flex items-center gap-3 px-5 py-3 bg-base-200 border-b border-base-300">
              <div class="w-7 h-7 rounded-full bg-base-300 flex items-center justify-center text-xs font-bold text-base-content/70 shrink-0">
                {comment.author.charAt(0).toUpperCase()}
              </div>
              <div class="flex items-center gap-2 text-sm flex-wrap flex-1 min-w-0">
                <span class="font-semibold text-base-content">{comment.author}</span>
                <span class="text-base-content/50">{comment.comment_type === 'review_body' ? 'submitted a review' : 'commented'}</span>
                <span class="text-base-content/50" title={formatDate(comment.created_at)}>{timeAgo(new Date(comment.created_at).getTime())}</span>
              </div>
              <span class="text-xs shrink-0" title={commentTypeLabel(comment)}>
                {commentIcon(comment)}
              </span>
            </div>
            {#if comment.file_path}
              <div class="px-5 py-1.5 bg-base-200/50 border-b border-base-300 text-xs font-mono text-base-content/60">
                {comment.file_path}{#if comment.line_number}:{comment.line_number}{/if}
              </div>
            {/if}
            <div class="px-5 py-4">
              <MarkdownContent content={comment.body} />
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
