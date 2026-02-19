<script lang="ts">
  import { DiffView, DiffModeEnum, SplitSide } from '@git-diff-view/svelte'
  import '@git-diff-view/svelte/styles/diff-view-pure.css'
  import './DiffViewerTheme.css'
  import type { PrFileDiff, ReviewComment, ReviewSubmissionComment } from '../lib/types'
  import { pendingManualComments } from '../lib/stores'
  import { toGitDiffViewData } from '../lib/diffAdapter'
  import { buildExtendData, type CommentDisplayData } from '../lib/diffComments'

  interface Props {
    files?: PrFileDiff[]
    existingComments?: ReviewComment[]
    repoOwner?: string
    repoName?: string
  }

  let { files = [], existingComments = [], repoOwner: _repoOwner = '', repoName: _repoName = '' }: Props = $props()

  let diffViewMode = $state<DiffModeEnum>(DiffModeEnum.Split)
  let commentText = $state('')

  export function scrollToFile(filename: string) {
    const el = document.querySelector(`[data-diff-file="${filename}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
</script>

<div class="diff-viewer">
  <div class="controls">
    <button
      class:active={diffViewMode === DiffModeEnum.Split}
      onclick={() => (diffViewMode = DiffModeEnum.Split)}
    >
      Split
    </button>
    <button
      class:active={diffViewMode === DiffModeEnum.Unified}
      onclick={() => (diffViewMode = DiffModeEnum.Unified)}
    >
      Unified
    </button>
  </div>

  <div class="diff-container">
    {#if files.length === 0}
      <div class="empty">No files to display</div>
    {:else}
      {#each files as file (file.filename)}
        <div data-diff-file={file.filename} class="diff-file-wrapper">
          <DiffView
            data={toGitDiffViewData(file)}
            extendData={buildExtendData(file.filename, existingComments, $pendingManualComments)}
            diffViewMode={diffViewMode}
            diffViewTheme="dark"
            diffViewHighlight={true}
            diffViewAddWidget={true}
            diffViewFontSize={12}
            onAddWidgetClick={(_lineNumber, _side) => {
              commentText = ''
            }}
          >
            {#snippet renderExtendLine({ lineNumber: _ln, side: _side, data, diffFile: _df, onUpdate: _ou }: { lineNumber: number; side: SplitSide; data: CommentDisplayData; diffFile: import('@git-diff-view/core').DiffFile; onUpdate: () => void })}
              <div class="extend-line-content">
                {#each data.comments as comment}
                  <div
                    class="inline-comment"
                    class:existing={comment.type === 'existing'}
                    class:pending={comment.type === 'pending'}
                  >
                    <div class="comment-header">
                      {#if comment.type === 'existing'}
                        <strong class="comment-author">{comment.author}</strong>
                        <span class="comment-time">{comment.createdAt}</span>
                      {:else}
                        <span class="pending-badge">Pending</span>
                        <button
                          class="comment-delete-btn"
                          onclick={() => {
                            $pendingManualComments = $pendingManualComments.filter(
                              (_, i) => i !== comment.index
                            )
                          }}
                        >✕</button>
                      {/if}
                    </div>
                    <div class="comment-body">{comment.body}</div>
                  </div>
                {/each}
              </div>
            {/snippet}

            {#snippet renderWidgetLine({ lineNumber, side, diffFile, onClose }: { lineNumber: number; side: SplitSide; diffFile: import('@git-diff-view/core').DiffFile; onClose: () => void })}
              <div class="comment-form-inner">
                <textarea
                  class="comment-textarea"
                  placeholder="Leave a comment..."
                  rows="3"
                  bind:value={commentText}
                ></textarea>
                <div class="comment-form-actions">
                  <button
                    class="comment-cancel-btn"
                    onclick={() => {
                      onClose()
                    }}
                  >Cancel</button>
                  <button
                    class="comment-submit-btn"
                    onclick={() => {
                      if (!commentText.trim()) return
                      const path = diffFile._newFileName || diffFile._oldFileName || ''
                      const newComment: ReviewSubmissionComment = {
                        path,
                        line: lineNumber,
                        side: side === SplitSide.old ? 'LEFT' : 'RIGHT',
                        body: commentText.trim()
                      }
                      $pendingManualComments = [...$pendingManualComments, newComment]
                      onClose()
                      commentText = ''
                    }}
                  >Add Comment</button>
                </div>
              </div>
            {/snippet}
          </DiffView>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .diff-viewer {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow: hidden;
  }

  .controls {
    display: flex;
    gap: 4px;
    padding: 12px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }

  .controls button {
    all: unset;
    padding: 6px 12px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .controls button:hover {
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .controls button.active {
    color: var(--accent);
    border-color: var(--accent);
    background: rgba(122, 162, 247, 0.1);
  }

  .diff-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--bg-primary);
  }

  .diff-file-wrapper {
    margin-bottom: 1px;
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  /* ── Extend line / comment display ────────────────────────────────────── */

  .extend-line-content {
    width: 100%;
  }

  .inline-comment {
    padding: 10px 16px;
    margin: 6px 16px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.8rem;
  }

  .inline-comment.pending {
    border-color: var(--warning);
    border-left: 3px solid var(--warning);
  }

  .inline-comment.existing {
    border-left: 3px solid var(--accent);
  }

  .comment-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .comment-author {
    color: var(--text-primary);
    font-weight: 600;
    font-size: 0.75rem;
  }

  .comment-time {
    color: var(--text-secondary);
    font-size: 0.7rem;
  }

  .pending-badge {
    padding: 2px 6px;
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--warning);
    background: rgba(224, 175, 104, 0.15);
    border-radius: 3px;
  }

  .comment-delete-btn {
    all: unset;
    margin-left: auto;
    padding: 2px 6px;
    font-size: 0.7rem;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .comment-delete-btn:hover {
    color: var(--error);
  }

  .comment-body {
    color: var(--text-primary);
    line-height: 1.5;
    white-space: pre-wrap;
  }

  /* ── Widget / comment form ─────────────────────────────────────────────── */

  .comment-form-inner {
    padding: 12px 16px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin: 8px 16px;
  }

  .comment-textarea {
    width: 100%;
    min-height: 60px;
    padding: 8px;
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.8rem;
    resize: vertical;
    box-sizing: border-box;
  }

  .comment-textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .comment-form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }

  .comment-cancel-btn {
    all: unset;
    padding: 6px 12px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }

  .comment-cancel-btn:hover {
    color: var(--text-primary);
  }

  .comment-submit-btn {
    all: unset;
    padding: 6px 12px;
    font-size: 0.75rem;
    color: var(--bg-primary);
    background: var(--accent);
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
  }

  .comment-submit-btn:hover {
    opacity: 0.9;
  }
</style>
