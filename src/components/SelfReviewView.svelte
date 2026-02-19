<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn, Event } from '@tauri-apps/api/event'
  import { selfReviewDiffFiles, selfReviewGeneralComments, selfReviewArchivedComments, pendingManualComments, ticketPrs } from '../lib/stores'
  import { getTaskDiff, getTaskFileContents, getActiveSelfReviewComments, getArchivedSelfReviewComments, getPrComments, openUrl } from '../lib/ipc'
  import type { Task, PullRequestInfo, PrComment, AgentEvent, PrFileDiff } from '../lib/types'
  import type { FileContents } from '../lib/diffAdapter'
  import FileTree from './FileTree.svelte'
  import DiffViewer from './DiffViewer.svelte'
  import GeneralCommentsSidebar from './GeneralCommentsSidebar.svelte'
  import SendToAgentPanel from './SendToAgentPanel.svelte'

  interface Props {
    task: Task
    agentStatus: string | null
    onSendToAgent: (prompt: string) => void
  }

  let { task, agentStatus, onSendToAgent }: Props = $props()

  let isLoading = $state(false)
  let error = $state<string | null>(null)
  let diffViewer = $state<DiffViewer>()
  let prComments = $state<PrComment[]>([])
  let linkedPr = $state<PullRequestInfo | null>(null)
  let fileTreeVisible = $state(true)
  let unlistenAgentEvent: UnlistenFn | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const DEBOUNCE_MS = 1500

  function handleFileSelect(filename: string) {
    if (diffViewer) {
      diffViewer.scrollToFile(filename)
    }
  }

  async function handleRefresh() {
    isLoading = true
    error = null
    try {
      const diffs = await getTaskDiff(task.id)
      $selfReviewDiffFiles = diffs
    } catch (e) {
      console.error('Failed to refresh diff:', e)
      error = String(e)
    } finally {
      isLoading = false
    }
  }

  function debouncedRefresh() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      handleRefresh()
    }, DEBOUNCE_MS)
  }

  async function fetchTaskFileContents(file: PrFileDiff): Promise<FileContents> {
    const [oldContent, newContent] = await getTaskFileContents(
      task.id,
      file.filename,
      file.previous_filename,
      file.status,
    )
    return { oldContent, newContent }
  }

  onMount(async () => {
    unlistenAgentEvent = await listen<AgentEvent>('agent-event', (event: Event<AgentEvent>) => {
      if (event.payload.task_id === task.id && event.payload.event_type === 'file.edited') {
        debouncedRefresh()
      }
    })
    isLoading = true
    error = null
    try {
      // 1. Load diff
      const diffs = await getTaskDiff(task.id)
      $selfReviewDiffFiles = diffs

      // 2. Load active comments and split by type
      const activeComments = await getActiveSelfReviewComments(task.id)
      $selfReviewGeneralComments = activeComments.filter(c => c.comment_type === 'general')

      // 3. Load archived comments and filter to general
      const archivedComments = await getArchivedSelfReviewComments(task.id)
      $selfReviewArchivedComments = archivedComments.filter(c => c.comment_type === 'general')

      // 4 & 5. Clear then populate pendingManualComments from inline active comments
      $pendingManualComments = activeComments
        .filter(c => c.comment_type === 'inline')
        .map(c => ({
          path: c.file_path!,
          line: c.line_number!,
          body: c.body,
          side: 'RIGHT'
        }))

      // 6. Load GitHub PR comments for the most recently updated open PR
      const taskPrs = $ticketPrs.get(task.id) || []
      const openPrs = taskPrs
        .filter(pr => pr.state === 'open')
        .sort((a, b) => b.updated_at - a.updated_at)
      if (openPrs.length > 0) {
        const pr = openPrs[0]
        linkedPr = pr
        try {
          prComments = await getPrComments(pr.id)
        } catch (e) {
          console.error(`Failed to load comments for PR ${pr.id}:`, e)
          prComments = []
        }
      }
    } catch (e) {
      console.error('Failed to load self-review data:', e)
      error = String(e)
    } finally {
      isLoading = false
    }
  })

  onDestroy(() => {
    if (unlistenAgentEvent) unlistenAgentEvent()
    if (debounceTimer) clearTimeout(debounceTimer)
    $selfReviewDiffFiles = []
    $selfReviewGeneralComments = []
    $selfReviewArchivedComments = []
    $pendingManualComments = []
  })
</script>

<div class="self-review-view">
  <div class="review-content">
    {#if isLoading}
      <div class="loading">
        <div class="spinner"></div>
        <span>Loading diff...</span>
      </div>
    {:else if error}
      <div class="error-state">
        <span class="error-icon">⚠</span>
        <span>{error}</span>
      </div>
    {:else if $selfReviewDiffFiles.length === 0}
      <div class="empty-state">
        <span class="empty-icon">📂</span>
        <h3>No changes on this branch yet</h3>
        <p>Make some changes and they will appear here automatically.</p>
      </div>
    {:else}
      <div class="detail-content">
        {#if fileTreeVisible}
          <FileTree files={$selfReviewDiffFiles} onSelectFile={handleFileSelect} />
        {/if}
        <DiffViewer
          bind:this={diffViewer}
          files={$selfReviewDiffFiles}
          existingComments={[]}
          {fileTreeVisible}
          onToggleFileTree={() => { fileTreeVisible = !fileTreeVisible }}
          fetchFileContents={fetchTaskFileContents}
        />
        <div class="sidebar-container">
          {#if linkedPr}
            <div class="github-comments-section">
              <div class="github-header">
                <span class="github-title">GitHub PR Comments</span>
                <span class="pr-badge">#{linkedPr.id}</span>
                <span class="gh-link" role="link" tabindex="0" onclick={() => openUrl(linkedPr!.url)} onkeydown={(e) => e.key === 'Enter' && openUrl(linkedPr!.url)}>View on GitHub ↗</span>
              </div>
              {#if prComments.length === 0}
                <div class="no-comments">No review comments on this PR yet</div>
              {:else}
                <div class="github-comments-list">
                  {#each prComments as comment (comment.id)}
                    <div class="github-comment-item">
                      <div class="comment-header">
                        <span class="comment-author">@{comment.author}</span>
                        {#if comment.file_path}
                          <span class="comment-location">{comment.file_path}{#if comment.line_number}:{comment.line_number}{/if}</span>
                        {/if}
                      </div>
                      <div class="comment-body">{comment.body}</div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
          <GeneralCommentsSidebar taskId={task.id} />
        </div>
      </div>
    {/if}
  </div>

  <SendToAgentPanel
    taskId={task.id}
    taskTitle={task.title}
    {agentStatus}
    {onSendToAgent}
    onRefresh={handleRefresh}
  />
</div>

<style>
  .self-review-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .review-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .detail-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .sidebar-container {
    width: 280px;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 12px;
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 16px;
    color: var(--text-secondary);
    text-align: center;
    padding: 40px;
  }

  .empty-icon {
    font-size: 4rem;
  }

  .empty-state h3 {
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .empty-state p {
    font-size: 0.9rem;
    margin: 0;
  }

  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 12px;
    color: var(--error);
    font-size: 0.85rem;
    text-align: center;
    padding: 20px;
  }

  .error-icon {
    font-size: 3rem;
  }

  .github-comments-section {
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .github-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }

  .github-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex: 1;
  }

  .pr-badge {
    font-size: 0.7rem;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    border-radius: 4px;
    padding: 1px 5px;
    font-weight: 600;
  }

  .gh-link {
    font-size: 0.7rem;
    color: var(--accent);
    cursor: pointer;
    text-decoration: none;
  }

  .gh-link:hover {
    text-decoration: underline;
  }

  .no-comments {
    padding: 12px;
    font-size: 0.78rem;
    color: var(--text-secondary);
    text-align: center;
  }

  .github-comments-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow-y: auto;
    max-height: 240px;
  }

  .github-comment-item {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-card);
  }

  .github-comment-item:last-child {
    border-bottom: none;
  }

  .comment-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 5px;
    flex-wrap: wrap;
  }

  .comment-author {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent);
  }

  .comment-location {
    font-size: 0.68rem;
    color: var(--text-secondary);
    font-family: monospace;
    background: var(--bg-secondary);
    border-radius: 3px;
    padding: 1px 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 150px;
  }

  .comment-body {
    font-size: 0.78rem;
    color: var(--text-primary);
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
