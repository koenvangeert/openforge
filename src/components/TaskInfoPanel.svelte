<script lang="ts">
  import { onMount } from 'svelte'
  import type { Task, PrComment, KanbanColumn, WorktreeInfo } from '../lib/types'
  import { COLUMN_LABELS, parseCheckRuns } from '../lib/types'
  import { ticketPrs } from '../lib/stores'
  import { 
    updateTaskStatus, 
    getPrComments, 
    markCommentAddressed, 
    openUrl, 
    getWorktreeForTask 
  } from '../lib/ipc'
  import CopyButton from './CopyButton.svelte'

  interface Props {
    task: Task
  }

  let { task }: Props = $props()

  let worktree = $state<WorktreeInfo | null>(null)
  let prCommentsByPr = $state<Map<number, PrComment[]>>(new Map())

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

  $effect(() => {
    loadWorktree(task.id)
  })

  $effect(() => {
    // Reload PR comments when task changes or ticketPrs updates
    const prs = $ticketPrs.get(task.id)
    if (prs) {
      loadPrComments()
    }
  })


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

  let statusLabel = $derived(COLUMN_LABELS[task.status as KanbanColumn] || task.status)
  let taskPrs = $derived($ticketPrs.get(task.id) || [])
</script>

<div class="info-panel">
  <!-- Title / Initial Prompt Section -->
  <section class="section">
    <h3 class="section-title">Initial Prompt</h3>
    <div class="task-title-full">{task.title}</div>
  </section>

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
        <div class="copyable-field">
          <span class="value monospace">{worktree.branch_name}</span>
          <CopyButton text={worktree.branch_name} label="Copy branch name" />
        </div>
      </div>
      <div class="field">
        <span class="label">Worktree Path</span>
        <div class="copyable-field">
          <span class="value monospace small">{worktree.worktree_path}</span>
          <CopyButton text={worktree.worktree_path} label="Copy path" />
        </div>
      </div>
      {#if worktree.opencode_port}
        <div class="field">
          <span class="label">Server</span>
          <span class="value">Port {worktree.opencode_port} · {worktree.status}</span>
        </div>
      {/if}
    {/if}
  </section>


  {#if task.status !== 'done'}
    <section class="section">
      <button class="btn-done" onclick={() => handleStatusChange('done')}>
        Move to Done
      </button>
    </section>
  {/if}

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
            <button class="pr-link" onclick={() => openUrl(pr.url)}>
              {pr.url}
            </button>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Pipeline Status Section -->
  {#if taskPrs.some(pr => pr.ci_status)}
    <section class="section">
      <h3 class="section-title">Pipeline Status</h3>
      {#each taskPrs as pr (pr.id)}
        {#if pr.ci_status}
          {@const checkRuns = parseCheckRuns(pr.ci_check_runs)}
          <div class="pipeline-group">
            <div class="pipeline-header">
              <span class="pipeline-pr-name">{pr.title}</span>
              <span class="pipeline-status-badge pipeline-{pr.ci_status}">
                {#if pr.ci_status === 'success'}✓ Passing
                {:else if pr.ci_status === 'failure'}✗ Failing
                {:else if pr.ci_status === 'pending'}⏳ Running
                {:else if pr.ci_status === 'none'}— No CI
                {/if}
              </span>
            </div>
            {#if checkRuns.length > 0}
              <div class="check-runs-list">
                {#each checkRuns as check (check.id)}
                  <div class="check-run-item">
                    <span class="check-status-icon"
                      class:check-success={check.conclusion === 'success'}
                      class:check-failure={check.conclusion === 'failure'}
                      class:check-pending={check.status !== 'completed'}
                      class:check-neutral={check.conclusion === 'neutral' || check.conclusion === 'skipped'}
                    >
                      {#if check.conclusion === 'success'}✓
                      {:else if check.conclusion === 'failure'}✗
                      {:else if check.status !== 'completed'}⏳
                      {:else}—{/if}
                    </span>
                    <span class="check-name">{check.name}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {/each}
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
                      onclick={() => handleMarkAddressed(comment.id, pr.id)}>
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

  .task-title-full {
    font-size: 0.85rem;
    color: var(--text-primary);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
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

  .copyable-field {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }

  .copyable-field .value {
    flex: 1;
    min-width: 0;
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

  .btn-done {
    width: 100%;
    padding: 14px 20px;
    border: none;
    border-radius: 8px;
    font-size: 0.95rem;
    font-weight: 700;
    cursor: pointer;
    background: var(--success);
    color: white;
    transition: all 0.2s ease;
    letter-spacing: 0.02em;
  }

  .btn-done:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  .btn-done:active {
    transform: translateY(0);
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

  .pipeline-group {
    margin-bottom: 12px;
  }

  .pipeline-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }

  .pipeline-pr-name {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .pipeline-status-badge {
    font-size: 0.65rem;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 3px;
  }

  .pipeline-success {
    background: rgba(158, 206, 106, 0.15);
    color: var(--success);
  }

  .pipeline-failure {
    background: rgba(247, 118, 142, 0.15);
    color: var(--error);
  }

  .pipeline-pending {
    background: rgba(224, 175, 104, 0.15);
    color: var(--warning);
  }

  .pipeline-none {
    background: rgba(86, 95, 137, 0.15);
    color: var(--text-secondary);
  }

  .check-runs-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .check-run-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
  }

  .check-status-icon {
    width: 16px;
    text-align: center;
    font-weight: 600;
  }

  .check-success {
    color: var(--success);
  }

  .check-failure {
    color: var(--error);
  }

  .check-pending {
    color: var(--warning);
  }

  .check-neutral {
    color: var(--text-secondary);
  }

  .check-name {
    color: var(--text-primary);
  }
</style>
