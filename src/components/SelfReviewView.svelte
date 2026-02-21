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
  let includeUncommitted = $state(false)
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
      const diffs = await getTaskDiff(task.id, includeUncommitted)
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
      includeUncommitted,
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
      const diffs = await getTaskDiff(task.id, includeUncommitted)
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

<div class="flex flex-col w-full h-full overflow-hidden">
  <div class="flex flex-1 overflow-hidden">
    {#if isLoading}
      <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/50 text-sm">
        <span class="loading loading-spinner loading-md text-primary"></span>
        <span>Loading diff...</span>
      </div>
    {:else if error}
      <div class="flex flex-col items-center justify-center flex-1 gap-3 text-error text-sm text-center p-5">
        <span class="text-5xl">⚠</span>
        <span>{error}</span>
      </div>
    {:else if $selfReviewDiffFiles.length === 0}
      <div class="flex flex-col items-center justify-center flex-1 gap-4 text-base-content/50 text-center p-10">
        <span class="text-6xl">📂</span>
        <h3 class="text-xl font-semibold text-base-content m-0">No changes on this branch yet</h3>
        <p class="text-sm m-0">Make some changes and they will appear here automatically.</p>
      </div>
    {:else}
      <div class="flex flex-1 overflow-hidden">
        {#if fileTreeVisible}
          <FileTree files={$selfReviewDiffFiles} onSelectFile={handleFileSelect} />
        {/if}
        {#key includeUncommitted}
          <DiffViewer
            bind:this={diffViewer}
            files={$selfReviewDiffFiles}
            existingComments={[]}
            {fileTreeVisible}
            onToggleFileTree={() => { fileTreeVisible = !fileTreeVisible }}
            fetchFileContents={fetchTaskFileContents}
          />
        {/key}
        <div class="w-[280px] shrink-0 border-l border-base-300 overflow-hidden flex flex-col">
          {#if linkedPr}
            <div class="border-b border-base-300 shrink-0">
              <div class="flex items-center gap-1.5 px-3 py-2.5 bg-base-200 border-b border-base-300 flex-wrap">
                <span class="text-xs font-semibold text-base-content uppercase tracking-wider flex-1">GitHub PR Comments</span>
                <span class="badge badge-primary badge-sm">#{linkedPr.id}</span>
                <span
                  class="text-xs text-primary cursor-pointer hover:underline"
                  role="link"
                  tabindex="0"
                  onclick={() => openUrl(linkedPr!.url)}
                  onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && openUrl(linkedPr!.url)}
                >View on GitHub ↗</span>
              </div>
              {#if prComments.length === 0}
                <div class="px-3 py-3 text-xs text-base-content/50 text-center">No review comments on this PR yet</div>
              {:else}
                <div class="flex flex-col overflow-y-auto max-h-60">
                  {#each prComments as comment (comment.id)}
                    <div class="px-3 py-2.5 border-b border-base-300 bg-base-100 last:border-b-0">
                      <div class="flex items-center gap-1.5 mb-1 flex-wrap">
                        <span class="text-xs font-semibold text-primary">@{comment.author}</span>
                        {#if comment.file_path}
                          <span class="text-[0.68rem] text-base-content/50 font-mono bg-base-200 rounded px-1 overflow-hidden text-ellipsis whitespace-nowrap max-w-[150px]">{comment.file_path}{#if comment.line_number}:{comment.line_number}{/if}</span>
                        {/if}
                      </div>
                      <div class="text-xs text-base-content leading-snug whitespace-pre-wrap break-words">{comment.body}</div>
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

  {#if !isLoading && !error}
    <div class="flex items-center gap-2 px-3 py-1.5 border-t border-base-300 bg-base-200 text-xs">
      <label class="flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" class="checkbox checkbox-xs" checked={includeUncommitted} onchange={(e: Event) => { includeUncommitted = (e.target as HTMLInputElement).checked; handleRefresh() }} />
        <span class="text-base-content/70">Include uncommitted changes</span>
      </label>
    </div>
  {/if}

  <SendToAgentPanel
    taskId={task.id}
    taskTitle={task.title}
    {agentStatus}
    {onSendToAgent}
    onRefresh={handleRefresh}
  />
</div>
