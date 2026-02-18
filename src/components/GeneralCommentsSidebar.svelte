<script lang="ts">
  import { selfReviewGeneralComments, selfReviewArchivedComments } from '../lib/stores'
  import {
    addSelfReviewComment,
    deleteSelfReviewComment,
    getActiveSelfReviewComments,
    getArchivedSelfReviewComments
  } from '../lib/ipc'
  import type { SelfReviewComment } from '../lib/types'

  interface Props {
    taskId: string
  }

  let { taskId }: Props = $props()

  let newCommentBody = $state('')
  let isAdding = $state(false)
  let isDeleting = $state<number | null>(null)
  let loadError = $state<string | null>(null)
  let addError = $state<string | null>(null)
  let archivedExpanded = $state(false)

  let archivedCount = $derived($selfReviewArchivedComments.length)
  let canAdd = $derived(newCommentBody.trim().length > 0 && !isAdding)

  function formatTimestamp(ts: number): string {
    const date = new Date(ts * 1000)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  async function loadComments() {
    loadError = null
    try {
      const [active, archived] = await Promise.all([
        getActiveSelfReviewComments(taskId),
        getArchivedSelfReviewComments(taskId)
      ])
      $selfReviewGeneralComments = active.filter((c: SelfReviewComment) => c.comment_type === 'general')
      $selfReviewArchivedComments = archived.filter((c: SelfReviewComment) => c.comment_type === 'general')
    } catch (e) {
      console.error('Failed to load self-review comments:', e)
      loadError = String(e)
    }
  }

  async function handleAdd() {
    const body = newCommentBody.trim()
    if (!body || isAdding) return

    isAdding = true
    addError = null
    try {
      await addSelfReviewComment(taskId, 'general', null, null, body)
      newCommentBody = ''
      // Re-fetch to get the full comment object with id, round, created_at
      const active = await getActiveSelfReviewComments(taskId)
      $selfReviewGeneralComments = active.filter((c: SelfReviewComment) => c.comment_type === 'general')
    } catch (e) {
      console.error('Failed to add comment:', e)
      addError = String(e)
    } finally {
      isAdding = false
    }
  }

  async function handleDelete(commentId: number) {
    if (isDeleting !== null) return

    isDeleting = commentId
    try {
      await deleteSelfReviewComment(commentId)
      $selfReviewGeneralComments = $selfReviewGeneralComments.filter(
        (c: SelfReviewComment) => c.id !== commentId
      )
    } catch (e) {
      console.error('Failed to delete comment:', e)
    } finally {
      isDeleting = null
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleAdd()
    }
  }

  function toggleArchived() {
    archivedExpanded = !archivedExpanded
  }

  $effect(() => {
    // Re-run whenever taskId changes
    const id = taskId
    if (id) {
      loadComments()
    }
  })
</script>

<div class="sidebar">
  {#if archivedCount > 0}
    <div class="archived-section">
      <button class="archived-toggle" onclick={toggleArchived}>
        <span class="toggle-icon">{archivedExpanded ? '▾' : '▸'}</span>
        <span class="toggle-label">Previous Round ({archivedCount})</span>
      </button>
      {#if archivedExpanded}
        <div class="archived-list">
          {#each $selfReviewArchivedComments as comment (comment.id)}
            <div class="comment-item archived">
              <div class="comment-meta">
                <span class="comment-index">#{comment.id}</span>
                <span class="comment-timestamp">{formatTimestamp(comment.created_at)}</span>
              </div>
              <div class="comment-body">{comment.body}</div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <div class="comments-list">
    {#if loadError}
      <div class="load-error">
        <span class="error-icon">⚠</span>
        <span>{loadError}</span>
      </div>
    {:else if $selfReviewGeneralComments.length === 0}
      <div class="empty-state">
        <span class="empty-icon">📝</span>
        <p class="empty-text">No comments yet. Add notes from manual testing.</p>
      </div>
    {:else}
      {#each $selfReviewGeneralComments as comment, i (comment.id)}
        <div class="comment-item">
          <div class="comment-header">
            <span class="comment-index">#{i + 1}</span>
            <span class="comment-timestamp">{formatTimestamp(comment.created_at)}</span>
            <button
              class="delete-btn"
              onclick={() => handleDelete(comment.id)}
              disabled={isDeleting === comment.id}
              title="Delete comment"
            >
              {isDeleting === comment.id ? '…' : '×'}
            </button>
          </div>
          <div class="comment-body">{comment.body}</div>
        </div>
      {/each}
    {/if}
  </div>

  <div class="add-comment-area">
    {#if addError}
      <div class="add-error">
        <span class="error-icon">⚠</span>
        <span>{addError}</span>
      </div>
    {/if}
    <textarea
      class="comment-input"
      placeholder="Add a testing note… (Cmd+Enter to submit)"
      rows={3}
      bind:value={newCommentBody}
      disabled={isAdding}
      onkeydown={handleKeydown}
    ></textarea>
    <div class="add-actions">
      <button
        class="add-btn"
        onclick={handleAdd}
        disabled={!canAdd}
      >
        {isAdding ? 'Adding…' : 'Add'}
      </button>
    </div>
  </div>
</div>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-secondary);
    overflow: hidden;
  }

  .archived-section {
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .archived-toggle {
    all: unset;
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 10px 16px;
    cursor: pointer;
    transition: background 0.1s;
    box-sizing: border-box;
  }

  .archived-toggle:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .toggle-icon {
    font-size: 0.75rem;
    color: var(--text-secondary);
    width: 10px;
    flex-shrink: 0;
  }

  .toggle-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .archived-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0 12px 12px;
    max-height: 220px;
    overflow-y: auto;
  }

  .comments-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 12px;
    min-height: 0;
  }

  .comment-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 8px;
  }

  .comment-item:last-child {
    margin-bottom: 0;
  }

  .comment-item.archived {
    opacity: 0.5;
    background: transparent;
    border-color: transparent;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    padding: 8px 4px;
  }

  .comment-item.archived:last-child {
    border-bottom: none;
  }

  .comment-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .comment-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .comment-index {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--accent);
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }

  .comment-timestamp {
    font-size: 0.7rem;
    color: var(--text-secondary);
    margin-left: auto;
    flex-shrink: 0;
  }

  .comment-header .comment-timestamp {
    flex: 1;
    text-align: right;
  }

  .comment-body {
    font-size: 0.82rem;
    color: var(--text-primary);
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .comment-item.archived .comment-body {
    color: var(--text-secondary);
  }

  .delete-btn {
    all: unset;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    font-size: 1rem;
    line-height: 1;
    color: var(--text-secondary);
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.15s, background 0.15s;
  }

  .delete-btn:hover:not(:disabled) {
    color: var(--error);
    background: rgba(247, 118, 142, 0.12);
  }

  .delete-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex: 1;
    padding: 32px 16px;
    text-align: center;
  }

  .empty-icon {
    font-size: 1.5rem;
    opacity: 0.4;
  }

  .empty-text {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .load-error,
  .add-error {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: rgba(247, 118, 142, 0.1);
    border: 1px solid rgba(247, 118, 142, 0.25);
    border-radius: 6px;
    color: var(--error);
    font-size: 0.78rem;
    margin-bottom: 8px;
  }

  .error-icon {
    flex-shrink: 0;
  }

  .add-comment-area {
    flex-shrink: 0;
    padding: 12px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .comment-input {
    width: 100%;
    min-height: 72px;
    padding: 9px 11px;
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-family: inherit;
    font-size: 0.82rem;
    line-height: 1.5;
    resize: vertical;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }

  .comment-input::placeholder {
    color: var(--text-secondary);
    opacity: 0.7;
  }

  .comment-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .comment-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .add-actions {
    display: flex;
    justify-content: flex-end;
  }

  .add-btn {
    all: unset;
    padding: 7px 18px;
    font-size: 0.8rem;
    font-weight: 600;
    border-radius: 6px;
    cursor: pointer;
    background: var(--accent);
    color: var(--bg-primary);
    transition: opacity 0.15s, transform 0.1s;
  }

  .add-btn:hover:not(:disabled) {
    opacity: 0.88;
    transform: translateY(-1px);
  }

  .add-btn:active:not(:disabled) {
    transform: translateY(0);
  }

  .add-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
  }
</style>
