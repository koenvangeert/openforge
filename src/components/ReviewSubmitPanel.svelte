<script lang="ts">
  import { pendingManualComments } from '../lib/stores'
  import { submitPrReview } from '../lib/ipc'
  import type { ReviewSubmissionComment } from '../lib/types'

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
  let selectedEvent = $state<'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'>('COMMENT')

  let canSubmit = $derived(!isSubmitting && (summary.trim() !== '' || $pendingManualComments.length > 0))

  async function handleSubmit(event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES') {
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
      successMessage = `Review submitted successfully (${event === 'APPROVE' ? 'Approved' : event === 'REQUEST_CHANGES' ? 'Changes Requested' : 'Commented'})`
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        successMessage = null
      }, 3000)
    } catch (e) {
      console.error('Failed to submit review:', e)
      error = String(e)
    } finally {
      isSubmitting = false
    }
  }

  function handleCommentClick() {
    selectedEvent = 'COMMENT'
    handleSubmit('COMMENT')
  }

  function handleApproveClick() {
    selectedEvent = 'APPROVE'
    handleSubmit('APPROVE')
  }

  function handleRequestChangesClick() {
    selectedEvent = 'REQUEST_CHANGES'
    handleSubmit('REQUEST_CHANGES')
  }
</script>

<div class="review-submit-panel">
  <div class="panel-header">
    <h3 class="panel-title">Submit Review</h3>
    {#if $pendingManualComments.length > 0}
      <span class="comment-count">{$pendingManualComments.length} comment{$pendingManualComments.length === 1 ? '' : 's'} will be submitted</span>
    {/if}
  </div>

  <div class="panel-body">
    <textarea 
      class="summary-input"
      placeholder="Leave a summary comment (optional)"
      rows="3"
      bind:value={summary}
      disabled={isSubmitting}
    />

    {#if error}
      <div class="error-message">
        <span class="error-icon">⚠</span>
        <span>{error}</span>
      </div>
    {/if}

    {#if successMessage}
      <div class="success-message">
        <span class="success-icon">✓</span>
        <span>{successMessage}</span>
      </div>
    {/if}

    <div class="action-buttons">
      <button 
        class="submit-btn comment-btn"
        onclick={handleCommentClick}
        disabled={!canSubmit}
      >
        {isSubmitting && selectedEvent === 'COMMENT' ? 'Submitting...' : 'Comment'}
      </button>
      <button 
        class="submit-btn approve-btn"
        onclick={handleApproveClick}
        disabled={!canSubmit}
      >
        {isSubmitting && selectedEvent === 'APPROVE' ? 'Submitting...' : 'Approve'}
      </button>
      <button 
        class="submit-btn request-changes-btn"
        onclick={handleRequestChangesClick}
        disabled={!canSubmit}
      >
        {isSubmitting && selectedEvent === 'REQUEST_CHANGES' ? 'Submitting...' : 'Request Changes'}
      </button>
    </div>
  </div>
</div>

<style>
  .review-submit-panel {
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px 12px;
    border-bottom: 1px solid var(--border);
  }

  .panel-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .comment-count {
    padding: 4px 10px;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--warning);
    background: rgba(224, 175, 104, 0.15);
    border-radius: 12px;
  }

  .panel-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 24px;
  }

  .summary-input {
    width: 100%;
    min-height: 70px;
    padding: 10px 12px;
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-family: inherit;
    font-size: 0.85rem;
    line-height: 1.5;
    resize: vertical;
    transition: border-color 0.15s;
  }

  .summary-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .summary-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .error-message {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(247, 118, 142, 0.1);
    border: 1px solid rgba(247, 118, 142, 0.3);
    border-radius: 6px;
    color: var(--error);
    font-size: 0.8rem;
  }

  .error-icon {
    font-size: 1rem;
  }

  .success-message {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(158, 206, 106, 0.1);
    border: 1px solid rgba(158, 206, 106, 0.3);
    border-radius: 6px;
    color: var(--success);
    font-size: 0.8rem;
  }

  .success-icon {
    font-size: 1rem;
  }

  .action-buttons {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .submit-btn {
    all: unset;
    padding: 8px 16px;
    font-size: 0.8rem;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
    border: 1px solid;
  }

  .submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .comment-btn {
    color: var(--text-primary);
    background: var(--bg-card);
    border-color: var(--border);
  }

  .comment-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .approve-btn {
    color: var(--bg-primary);
    background: var(--success);
    border-color: var(--success);
  }

  .approve-btn:hover:not(:disabled) {
    opacity: 0.9;
  }

  .request-changes-btn {
    color: var(--bg-primary);
    background: var(--error);
    border-color: var(--error);
  }

  .request-changes-btn:hover:not(:disabled) {
    opacity: 0.9;
  }
</style>
