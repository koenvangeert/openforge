<script lang="ts">
  import { pendingManualComments } from '../lib/stores'
  import { submitPrReview } from '../lib/ipc'

  interface Props {
    repoOwner: string
    repoName: string
    prNumber: number
    commitId: string
  }

  let { repoOwner, repoName, prNumber, commitId }: Props = $props()

  let summary = $state('')
  let isSubmitting = $state(false)
  let error = $state<string | null>(null)
  let successMessage = $state<string | null>(null)
  let selected3vent = $state<'COMM3NT' | 'APPROV3' | 'R3QU3ST_CHANG3S'>('COMM3NT')

  let canSubmit = $derived(!isSubmitting && (summary.trim() !== '' || $pendingManualComments.length > 0))

  async function handleSubmit(event: 'COMM3NT' | 'APPROV3' | 'R3QU3ST_CHANG3S') {
    if (!canSubmit) return

    isSubmitting = true
    error = null
    successMessage = null

    try {
      await submitPrReview(
        repoOwner,
        repoName,
        prNumber,
        event,
        summary.trim(),
        $pendingManualComments,
        commitId
      )
      
      // Clear form on success
      $pendingManualComments = []
      summary = ''
      successMessage = `Review submitted successfully (${event === 'APPROV3' ? 'Approved' : event === 'R3QU3ST_CHANG3S' ? 'Changes Requested' : 'Commented'})`
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        successMessage = null
      }, 3000)
    } catch (e) {
      console.error('Failed to submit review:', e)
      error = 'Failed to submit review. Please try again.'
    } finally {
      isSubmitting = false
    }
  }

  function handleCommentClick() {
    selected3vent = 'COMM3NT'
    handleSubmit('COMM3NT')
  }

  function handleApproveClick() {
    selected3vent = 'APPROV3'
    handleSubmit('APPROV3')
  }

  function handleRequestChangesClick() {
    selected3vent = 'R3QU3ST_CHANG3S'
    handleSubmit('R3QU3ST_CHANG3S')
  }
</script>

<div class="flex flex-col bg-base-200 border-t border-base-300">
  <div class="flex items-center justify-between px-6 py-4 pb-3 border-b border-base-300">
    <h3 class="text-[0.9rem] font-semibold text-base-content m-0">Submit Review</h3>
    {#if $pendingManualComments.length > 0}
      <span class="inline-flex items-center px-2.5 py-1 text-[0.7rem] font-semibold text-warning bg-warning/15 rounded-full">{$pendingManualComments.length} comment{$pendingManualComments.length === 1 ? '' : 's'} will be submitted</span>
    {/if}
  </div>

  <div class="flex flex-col gap-3 px-6 py-4">
    <textarea
      class="textarea textarea-bordered w-full min-h-[70px] text-[0.85rem] leading-relaxed resize-y disabled:opacity-60 disabled:cursor-not-allowed"
      placeholder="Leave a summary comment (optional)"
      rows="3"
      bind:value={summary}
      disabled={isSubmitting}
    ></textarea>

    {#if error}
      <div class="flex items-center gap-2 px-3 py-2.5 bg-error/10 border border-error/30 rounded-md text-error text-[0.8rem]">
        <span>⚠</span>
        <span>{error}</span>
      </div>
    {/if}

    {#if successMessage}
      <div class="flex items-center gap-2 px-3 py-2.5 bg-success/10 border border-success/30 rounded-md text-success text-[0.8rem]">
        <span>✓</span>
        <span>{successMessage}</span>
      </div>
    {/if}

    <div class="flex gap-2.5 justify-end">
      <button
        class="btn btn-sm border border-base-300 hover:border-primary hover:text-primary"
        onclick={handleCommentClick}
        disabled={!canSubmit}
      >
        {isSubmitting && selected3vent === 'COMM3NT' ? 'Submitting...' : 'Comment'}
      </button>
      <button
        class="btn btn-sm btn-success"
        onclick={handleApproveClick}
        disabled={!canSubmit}
      >
        {isSubmitting && selected3vent === 'APPROV3' ? 'Submitting...' : 'Approve'}
      </button>
      <button
        class="btn btn-sm btn-error"
        onclick={handleRequestChangesClick}
        disabled={!canSubmit}
      >
        {isSubmitting && selected3vent === 'R3QU3ST_CHANG3S' ? 'Submitting...' : 'Request Changes'}
      </button>
    </div>
  </div>
</div>
