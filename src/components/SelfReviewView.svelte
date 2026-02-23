<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { selfReviewDiffFiles, selfReviewGeneralComments, selfReviewArchivedComments, pendingManualComments, ticketPrs } from '../lib/stores'
  import { getTaskDiff, getTaskFileContents, getActiveSelfReviewComments, getArchivedSelfReviewComments, getPrComments, markCommentAddressed, openUrl } from '../lib/ipc'
  import type { Task, PullRequestInfo, PrComment, PrFileDiff } from '../lib/types'
  import type { FileContents } from '../lib/diffAdapter'
  import FileTree from './FileTree.svelte'
  import DiffViewer from './DiffViewer.svelte'
  import GeneralCommentsSidebar from './GeneralCommentsSidebar.svelte'
  import SendToAgentPanel from './SendToAgentPanel.svelte'
  import MarkdownContent from './MarkdownContent.svelte'

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

  // Sidebar state
  let sidebarVisible = $state(false)
  let sidebarTab = $state<'pr' | 'notes'>('pr')
  let selectedPrCommentIds = $state<Set<number>>(new Set())

  let unaddressedComments = $derived(prComments.filter(c => c.addressed === 0))
  let unaddressedCount = $derived(unaddressedComments.length)
  let selectedCount = $derived(selectedPrCommentIds.size)
  let selectedPrComments = $derived(prComments.filter(c => selectedPrCommentIds.has(c.id)))

  let hasAutoOpened = false
  $effect(() => {
    if (unaddressedCount > 0 && !hasAutoOpened) {
      sidebarVisible = true
      hasAutoOpened = true
    }
  })

  function timeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() / 1000) - timestamp)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  async function handleMarkAddressed(commentId: number) {
    try {
      await markCommentAddressed(commentId)
      prComments = prComments.map(c =>
        c.id === commentId ? { ...c, addressed: 1 } : c
      )
      // Remove from selection if it was selected
      if (selectedPrCommentIds.has(commentId)) {
        const next = new Set(selectedPrCommentIds)
        next.delete(commentId)
        selectedPrCommentIds = next
      }
    } catch (e) {
      console.error('Failed to mark comment addressed:', e)
    }
  }

  function handleFileSelect(filename: string) {
    if (diffViewer) {
      diffViewer.scrollToFile(filename)
    }
  }

  function togglePrCommentSelected(commentId: number) {
    const next = new Set(selectedPrCommentIds)
    if (next.has(commentId)) next.delete(commentId)
    else next.add(commentId)
    selectedPrCommentIds = next
  }

  function selectAllUnaddressed() {
    selectedPrCommentIds = new Set(unaddressedComments.map(c => c.id))
  }

  function deselectAll() {
    selectedPrCommentIds = new Set()
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
          >
            {#snippet toolbarExtra()}
              <div class="w-px h-5 bg-base-300 mx-1 self-center"></div>
              <button
                class="btn btn-ghost btn-xs gap-1 {sidebarVisible ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
                onclick={() => { sidebarVisible = !sidebarVisible }}
                title={sidebarVisible ? 'Hide comments panel' : 'Show comments panel'}
              >
                Comments
                {#if unaddressedCount > 0 && !sidebarVisible}
                  <span class="badge badge-error badge-xs">{unaddressedCount}</span>
                {/if}
              </button>
            {/snippet}
          </DiffViewer>
        {/key}
        {#if sidebarVisible}
          <div class="w-[380px] shrink-0 border-l border-base-300 overflow-hidden flex flex-col bg-base-100">
            <div class="flex items-center border-b border-base-300 bg-base-200 shrink-0">
              <button class="flex-1 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-center transition-colors {sidebarTab === 'pr' ? 'text-primary border-b-2 border-primary bg-base-100' : 'text-base-content/50 hover:text-base-content hover:bg-base-content/5'}"
                onclick={() => { sidebarTab = 'pr' }}>
                PR Comments
                {#if unaddressedCount > 0}<span class="badge badge-error badge-xs ml-1">{unaddressedCount}</span>{/if}
              </button>
              <button class="flex-1 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-center transition-colors {sidebarTab === 'notes' ? 'text-primary border-b-2 border-primary bg-base-100' : 'text-base-content/50 hover:text-base-content hover:bg-base-content/5'}"
                onclick={() => { sidebarTab = 'notes' }}>
                Notes
                {#if $selfReviewGeneralComments.length > 0}<span class="badge badge-ghost badge-xs ml-1">{$selfReviewGeneralComments.length}</span>{/if}
              </button>
            </div>
            <div class="flex-1 overflow-hidden flex flex-col" class:hidden={sidebarTab !== 'pr'}>
              {#if linkedPr}
                <div class="flex items-center gap-2 px-3 py-2 bg-base-200/50 border-b border-base-300 shrink-0">
                  {#if selectedCount > 0}
                    <span class="text-[0.7rem] font-semibold text-primary">{selectedCount} selected</span>
                    <button class="btn btn-ghost btn-xs text-base-content/40 hover:text-base-content" onclick={deselectAll}>Clear</button>
                  {:else if unaddressedCount > 0}
                    <button class="btn btn-ghost btn-xs text-base-content/40 hover:text-primary" onclick={selectAllUnaddressed}>Select all</button>
                  {/if}
                  <span class="flex-1"></span>
                  <span class="text-[0.7rem] text-primary cursor-pointer hover:underline" role="link" tabindex="0"
                    onclick={() => openUrl(linkedPr!.url)}
                    onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && openUrl(linkedPr!.url)}>GitHub ↗</span>
                </div>
                {#if prComments.length === 0}
                  <div class="flex flex-col items-center justify-center flex-1 gap-2 px-4 py-8 text-center">
                    <span class="text-2xl opacity-40">💬</span>
                    <p class="m-0 text-xs text-base-content/50">No review comments on this PR yet</p>
                  </div>
                {:else}
                  <div class="flex-1 overflow-y-auto">
                    {#each prComments as comment (comment.id)}
                      {@const isSelected = selectedPrCommentIds.has(comment.id)}
                      <div class="px-3 py-3 border-b border-base-300 last:border-b-0 {comment.addressed === 1 ? 'opacity-40' : ''}">
                        <div class="flex items-start gap-2">
                          {#if comment.addressed === 0}
                            <input
                              type="checkbox"
                              class="checkbox checkbox-xs checkbox-primary mt-0.5 shrink-0"
                              checked={isSelected}
                              onchange={() => togglePrCommentSelected(comment.id)}
                            />
                          {/if}
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-1.5 mb-1.5 flex-wrap">
                              <div class="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center text-[0.6rem] font-bold text-primary shrink-0">
                                {comment.author.charAt(0).toUpperCase()}
                              </div>
                              <span class="text-xs font-semibold text-base-content">@{comment.author}</span>
                              <span class="text-[0.65rem] text-base-content/40 ml-auto">{timeAgo(comment.created_at)}</span>
                            </div>
                            {#if comment.file_path}
                              <div class="flex items-center gap-1 mb-1.5">
                                <span class="text-[0.65rem] text-base-content/50 font-mono bg-base-200 rounded px-1.5 py-0.5 overflow-hidden text-ellipsis whitespace-nowrap max-w-full">{comment.file_path}{#if comment.line_number}:{comment.line_number}{/if}</span>
                              </div>
                            {/if}
                            <div class="text-xs text-base-content leading-relaxed [&_.markdown-body]:text-xs [&_.markdown-body_pre]:text-[0.7rem] [&_.markdown-body_code]:text-[0.7rem] [&_.markdown-body_p]:my-1">
                              <MarkdownContent content={comment.body} />
                            </div>
                            {#if comment.addressed === 0}
                              <button
                                class="btn btn-ghost btn-xs mt-1.5 text-base-content/50 hover:text-success hover:bg-success/10"
                                onclick={() => handleMarkAddressed(comment.id)}
                              >✓ Mark addressed</button>
                            {:else}
                              <span class="text-[0.65rem] text-success font-medium mt-1">✓ Addressed</span>
                            {/if}
                          </div>
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}
              {:else}
                <div class="flex flex-col items-center justify-center flex-1 gap-2 px-4 py-8 text-center">
                  <p class="m-0 text-xs text-base-content/50">No linked PR found</p>
                </div>
              {/if}
            </div>

            <!-- Notes tab content (keep mounted to preserve textarea draft) -->
            <div class="flex-1 overflow-hidden" class:hidden={sidebarTab !== 'notes'}>
              <GeneralCommentsSidebar taskId={task.id} />
            </div>
          </div>
        {/if}
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
    {selectedPrComments}
    onSendComplete={() => { selectedPrCommentIds = new Set() }}
  />
</div>
