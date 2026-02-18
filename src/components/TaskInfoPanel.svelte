<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte'
  import type { Task, PrComment, KanbanColumn, WorktreeInfo } from '../lib/types'
  import { COLUMNS, COLUMN_LABELS } from '../lib/types'
  import { selectedTaskId, ticketPrs } from '../lib/stores'
  import { 
    updateTaskStatus, 
    deleteTask, 
    getPrComments, 
    markCommentAddressed, 
    openUrl, 
    getWorktreeForTask 
  } from '../lib/ipc'

  export let task: Task

  const dispatch = createEventDispatcher()

  let worktree: WorktreeInfo | null = null
  let prCommentsByPr: Map<number, PrComment[]> = new Map()

  async function loadWorktree(taskId: string) {
    try {
      worktree = await getWorktreeForTask(taskId)
    } catch (e) {
      console.error('Failed to load worktree:', e)
      worktree = null
    }
  }

  async function loadPrComments() {
    const prs = $ticketPrs.get(task.id) || []
    prCommentsByPr = new Map()
    
    for (const pr of prs) {
      try {
        const comments = await getPrComments(pr.id)
        prCommentsByPr.set(pr.id, comments)
      } catch (e) {
        console.error(`Failed to load comments for PR ${pr.id}:`, e)
      }
    }
    prCommentsByPr = prCommentsByPr
  }

  $: loadWorktree(task.id)
  $: {
    // Reload PR comments when task changes or ticketPrs updates
    const prs = $ticketPrs.get(task.id)
    if (prs) {
      loadPrComments()
    }
  }

  onMount(() => {
    loadPrComments()
  })

  async function handleStatusChange(newStatus: KanbanColumn) {
    if (newStatus === task.status) return
    try {
      await updateTaskStatus(task.id, newStatus)
    } catch (e) {
      console.error('Failed to update status:', e)
    }
  }

  async function handleDelete() {
    const confirmed = confirm(`Are you sure you want to delete task "${task.title}"?`)
    if (!confirmed) return

    try {
      await deleteTask(task.id)
      $selectedTaskId = null
    } catch (e) {
      console.error('Failed to delete task:', e)
    }
  }

  async function handleMarkAddressed(commentId: number, prId: number) {
    try {
      await markCommentAddressed(commentId)
      // Reload comments for this PR
      const comments = await getPrComments(prId)
      prCommentsByPr.set(prId, comments)
      prCommentsByPr = prCommentsByPr
    } catch (e) {
      console.error('Failed to mark comment as addressed:', e)
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString()
  }

  function getUnaddressedCount(comments: PrComment[]): number {
    return comments.filter(c => c.addressed === 0).length
  }

  $: statusLabel = COLUMN_LABELS[task.status as KanbanColumn] || task.status
  $: taskPrs = $ticketPrs.get(task.id) || []
</script>

<div class="info-panel">
  <!-- Metadata Section -->
  <section class="section">
    <h3 class="section-title">Task Info</h3>
    
    <div class="field">
      <span class="label">Status</span>
      <span class="value status-badge">{statusLabel}</span>
    </div>

    {#if task.jira_key}
      <div class="field">
        <span class="label">JIRA</span>
        <span class="value">{task.jira_key}</span>
      </div>
      {#if task.jira_status}
        <div class="field">
          <span class="label">JIRA Status</span>
          <span class="value">{task.jira_status}</span>
        </div>
      {/if}
      {#if task.jira_assignee}
        <div class="field">
          <span class="label">JIRA Assignee</span>
          <span class="value">{task.jira_assignee}</span>
        </div>
      {/if}
    {/if}

    <div class="field">
      <span class="label">Created</span>
      <span class="value">{formatDate(task.created_at)}</span>
    </div>

    <div class="field">
      <span class="label">Updated</span>
      <span class="value">{formatDate(task.updated_at)}</span>
    </div>

    {#if worktree}
      <div class="field">
        <span class="label">Worktree Branch</span>
        <span class="value monospace">{worktree.branch_name}</span>
      </div>
      <div class="field">
        <span class="label">Worktree Path</span>
        <span class="value monospace small">{worktree.worktree_path}</span>
      </div>
      {#if worktree.opencode_port}
        <div class="field">
          <span class="label">Server</span>
          <span class="value">Port {worktree.opencode_port} · {worktree.status}</span>
        </div>
      {/if}
    {/if}
  </section>

  <!-- Status Change Section -->
  <section class="section">
    <h3 class="section-title">Change Status</h3>
    <div class="status-actions">
      {#each COLUMNS as col}
        <button 
          class="status-btn" 
          class:active={task.status === col}
          on:click={() => handleStatusChange(col)}
          disabled={task.status === col}>
          {COLUMN_LABELS[col]}
        </button>
      {/each}
    </div>
  </section>

  <!-- Action Row -->
  <section class="section">
    <div class="action-row">
      <button class="btn btn-edit" on:click={() => dispatch('edit')}>Edit Task</button>
      <button class="btn btn-delete" on:click={handleDelete}>Delete</button>
    </div>
  </section>

  <!-- PR Links Section -->
  {#if taskPrs.length > 0}
    <section class="section">
      <h3 class="section-title">Pull Requests</h3>
      <div class="pr-list">
        {#each taskPrs as pr (pr.id)}
          <div class="pr-item">
            <div class="pr-header">
              <span class="pr-state" class:open={pr.state === 'open'} class:closed={pr.state === 'closed'}>
                {pr.state}
              </span>
              <span class="pr-title">{pr.title}</span>
            </div>
            <button class="pr-link" on:click={() => openUrl(pr.url)}>
              {pr.url}
            </button>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- PR Comments Section -->
  {#if taskPrs.length > 0}
    <section class="section">
      <h3 class="section-title">PR Comments</h3>
      {#each taskPrs as pr (pr.id)}
        {@const comments = prCommentsByPr.get(pr.id) || []}
        {@const unaddressedCount = getUnaddressedCount(comments)}
        {#if comments.length > 0}
          <div class="pr-comments-group">
            <div class="pr-comments-header">
              <span class="pr-name">{pr.title}</span>
              {#if unaddressedCount > 0}
                <span class="unaddressed-badge">{unaddressedCount} unaddressed</span>
              {/if}
            </div>
            <div class="comments-list">
              {#each comments as comment (comment.id)}
                <div class="comment-item" class:addressed={comment.addressed === 1}>
                  <div class="comment-header">
                    <span class="comment-author">@{comment.author}</span>
                    {#if comment.file_path}
                      <span class="comment-location">
                        {comment.file_path}{#if comment.line_number}:{comment.line_number}{/if}
                      </span>
                    {/if}
                  </div>
                  <div class="comment-body">{comment.body}</div>
                  {#if comment.addressed === 0}
                    <button 
                      class="btn-mark-addressed" 
                      on:click={() => handleMarkAddressed(comment.id, pr.id)}>
                      Mark Addressed
                    </button>
                  {:else}
                    <span class="addressed-label">✓ Addressed</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    </section>
  {/if}
</div>

<style>
  .info-panel {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 20px;
    overflow-y: auto;
    background: var(--bg-secondary);
    height: 100%;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .label {
    font-size: 0.7rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .value {
    font-size: 0.8rem;
    color: var(--text-primary);
  }

  .value.monospace {
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  }

  .value.small {
    font-size: 0.75rem;
    word-break: break-all;
  }

  .status-badge {
    display: inline-block;
    padding: 4px 8px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-weight: 500;
    width: fit-content;
  }

  .btn {
    padding: 10px 20px;
    border: none;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .status-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .status-btn {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 500;
    cursor: pointer;
    background: var(--bg-card);
    color: var(--text-secondary);
    transition: all 0.2s ease;
  }

  .status-btn:hover:not(:disabled) {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .status-btn.active {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .status-btn:disabled {
    cursor: not-allowed;
    opacity: 0.8;
  }

  .action-row {
    display: flex;
    gap: 8px;
  }

  .btn-edit {
    background: var(--accent);
    color: white;
    flex: 1;
  }

  .btn-edit:hover {
    opacity: 0.9;
  }

  .btn-delete {
    background: transparent;
    color: var(--error);
    border: 1px solid var(--error);
    flex: 1;
  }

  .btn-delete:hover {
    background: var(--error);
    color: white;
  }

  .pr-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .pr-item {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .pr-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pr-state {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 3px;
    letter-spacing: 0.03em;
  }

  .pr-state.open {
    background: var(--success);
    color: white;
  }

  .pr-state.closed {
    background: var(--error);
    color: white;
  }

  .pr-title {
    font-size: 0.8rem;
    color: var(--text-primary);
    font-weight: 500;
  }

  .pr-link {
    all: unset;
    font-size: 0.7rem;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    word-break: break-all;
  }

  .pr-link:hover {
    opacity: 0.8;
  }

  .pr-comments-group {
    margin-bottom: 16px;
  }

  .pr-comments-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }

  .pr-name {
    font-size: 0.75rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .unaddressed-badge {
    font-size: 0.65rem;
    font-weight: 600;
    background: var(--error);
    color: white;
    padding: 2px 6px;
    border-radius: 8px;
  }

  .comments-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .comment-item {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .comment-item.addressed {
    opacity: 0.6;
  }

  .comment-header {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .comment-author {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent);
  }

  .comment-location {
    font-size: 0.7rem;
    color: var(--text-secondary);
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  }

  .comment-body {
    font-size: 0.8rem;
    color: var(--text-primary);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .btn-mark-addressed {
    all: unset;
    font-size: 0.7rem;
    color: var(--accent);
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    width: fit-content;
    font-weight: 500;
  }

  .btn-mark-addressed:hover {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .addressed-label {
    font-size: 0.7rem;
    color: var(--success);
    font-weight: 500;
  }
</style>
