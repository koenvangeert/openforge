<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import { selfReviewDiffFiles, selfReviewGeneralComments } from '../../lib/stores'
  import { getTaskFileContents, getTaskBatchFileContents, getCommitFileContents, getCommitBatchFileContents, openUrl } from '../../lib/ipc'
  import { timeAgo } from '../../lib/timeAgo'
  import { createDiffLoader } from '../../lib/useDiffLoader.svelte'
  import { createCommentSelection } from '../../lib/useCommentSelection.svelte'
  import { prCommentsToReviewComments } from '../../lib/diffComments'
  import type { Task, PrFileDiff } from '../../lib/types'
  import type { FileContents } from '../../lib/diffAdapter'
  import FileTree from '../review/shared/FileTree.svelte'
  import ResizablePanel from '../shared/ui/ResizablePanel.svelte'
  import ResizableBottomPanel from '../shared/ui/ResizableBottomPanel.svelte'
  import DiffViewer from '../review/shared/diff-viewer/DiffViewer.svelte'
  import GeneralCommentsSidebar from '../review/shared/GeneralCommentsSidebar.svelte'
  import SendToAgentPanel from './SendToAgentPanel.svelte'
  import MarkdownContent from '../shared/content/MarkdownContent.svelte'

  interface Props {
    task: Task
    agentStatus: string | null
    onSendToAgent: (prompt: string) => void
  }

  let { task, agentStatus, onSendToAgent }: Props = $props()

  let diffViewer = $state<DiffViewer>()
  let fileTreeVisible = $state(true)
  let includeUncommitted = $state(false)
  let showAddressed = $state(false)

  let sidebarVisible = $state(false)
  let sidebarTab = $state<'pr' | 'notes'>('pr')

  const diffLoader = createDiffLoader({
    getTaskId: () => task.id,
    getIncludeUncommitted: () => includeUncommitted,
  })

  const commentSelection = createCommentSelection({
    getPrComments: () => diffLoader.prComments,
  })

  let inlineReviewComments = $derived(prCommentsToReviewComments(diffLoader.prComments))
  let visibleComments = $derived(showAddressed ? diffLoader.prComments : commentSelection.unaddressedComments)

  let hasAutoOpened = false
  $effect(() => {
    if (commentSelection.unaddressedCount > 0 && !hasAutoOpened) {
      sidebarVisible = true
      hasAutoOpened = true
    }
  })

  function handleFileSelect(filename: string) {
    if (diffViewer) {
      diffViewer.scrollToFile(filename)
    }
  }

  async function fetchTaskFileContents(file: PrFileDiff): Promise<FileContents> {
    const sha = diffLoader.selectedCommitSha
    if (sha !== null) {
      const [oldContent, newContent] = await getCommitFileContents(
        task.id,
        sha,
        file.filename,
        file.previous_filename,
        file.status,
      )
      return { oldContent, newContent }
    }
    const [oldContent, newContent] = await getTaskFileContents(
      task.id,
      file.filename,
      file.previous_filename,
      file.status,
      includeUncommitted,
    )
    return { oldContent, newContent }
  }

  async function batchFetchTaskFileContents(files: PrFileDiff[]): Promise<Map<string, FileContents>> {
    const requests = files.map(f => ({ path: f.filename, oldPath: f.previous_filename ?? null, status: f.status }))
    const sha = diffLoader.selectedCommitSha

    const results = sha !== null
      ? await getCommitBatchFileContents(task.id, sha, requests)
      : await getTaskBatchFileContents(task.id, requests, includeUncommitted)

    const map = new Map<string, FileContents>()
    files.forEach((file, i) => {
      const [oldContent, newContent] = results[i]
      map.set(file.filename, { oldContent, newContent })
    })
    return map
  }

  async function handleCommitSelect(sha: string | null) {
    await diffLoader.selectCommit(sha)
  }

  onMount(async () => {
    await diffLoader.loadDiff()
    if (get(selfReviewDiffFiles).length === 0 && !includeUncommitted) {
      includeUncommitted = true
      await diffLoader.refresh()
    }
    await diffLoader.loadCommits()
  })

  onDestroy(() => {
    diffLoader.cleanup()
  })
</script>

<div class="flex flex-col w-full h-full overflow-hidden">
  <div class="flex flex-1 overflow-hidden">
    <ResizablePanel storageKey="self-review-file-tree" defaultWidth={260} minWidth={160} maxWidth={500} side="left">
          <div class="flex flex-col h-full bg-base-100 border-r border-base-300">
            <div class="px-2 py-1.5 text-[0.65rem] uppercase tracking-wider font-semibold text-base-content/50 border-b border-base-300 bg-base-200">Files</div>
            <div class="flex-1 overflow-hidden">
              {#if fileTreeVisible}
                <FileTree files={$selfReviewDiffFiles} onSelectFile={handleFileSelect} />
              {:else}
                <div class="h-full flex flex-col items-center justify-center gap-2 text-center px-3 text-base-content/50">
                  <div class="text-xs">File explorer hidden</div>
                  <button class="btn btn-ghost btn-xs" onclick={() => { fileTreeVisible = true }}>Show files</button>
                </div>
              {/if}
            </div>
            <ResizableBottomPanel
              storageKey="self-review-commit-history"
              defaultHeight={160}
              minHeight={110}
              maxHeight={320}
              fillParent={false}
              panelTestId="self-review-commit-history-panel"
              handleTestId="self-review-commit-history-handle"
            >
              <div class="h-full flex flex-col border-t border-base-300 bg-base-200/70">
                <div class="px-2 py-1.5 text-[0.65rem] uppercase tracking-wider font-semibold text-base-content/50 border-b border-base-300 bg-base-200">Commit history</div>
                <div class="px-2 py-1.5 border-b border-base-300 bg-base-100/50">
                  {#if diffLoader.selectedCommitSha === null}
                    <label class="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        class="checkbox checkbox-xs"
                        checked={includeUncommitted}
                        onchange={(e: Event) => {
                          includeUncommitted = (e.target as HTMLInputElement).checked
                          diffLoader.refresh()
                        }}
                      />
                      <span class="text-base-content/70 text-[0.65rem]">Include uncommitted changes</span>
                    </label>
                  {:else}
                    <button
                      class="btn btn-ghost btn-xs h-6 min-h-0 px-2 text-[0.65rem] justify-start"
                      onclick={() => handleCommitSelect(null)}
                    >
                      Show all changes
                    </button>
                  {/if}
                </div>
                <div class="flex-1 overflow-y-auto py-1">
                  <button
                    class="flex flex-col w-full text-left px-3 py-2.5 gap-1 border-b border-base-200 last:border-b-0 hover:bg-base-300/50 transition-colors {diffLoader.selectedCommitSha === null ? 'bg-primary/5 text-primary' : 'text-base-content'}"
                    onclick={() => handleCommitSelect(null)}
                  >
                    <div class="text-xs font-semibold leading-snug">All changes</div>
                    <div class="font-mono text-[10px] opacity-60">merge-base..HEAD</div>
                  </button>
                  {#each diffLoader.commits as commit (commit.sha)}
                    <button
                      class="flex flex-col w-full text-left px-3 py-2.5 gap-1 border-b border-base-200 last:border-b-0 hover:bg-base-300/50 transition-colors {diffLoader.selectedCommitSha === commit.sha ? 'bg-primary/5 text-primary' : 'text-base-content'}"
                      onclick={() => handleCommitSelect(commit.sha)}
                      title={commit.message}
                    >
                      <div class="font-mono text-[10px] font-medium opacity-70">{commit.short_sha}</div>
                      <div class="text-xs font-medium truncate w-full leading-snug">{commit.message}</div>
                    </button>
                  {/each}
                </div>
              </div>
            </ResizableBottomPanel>
          </div>
    </ResizablePanel>
    <div class="flex flex-col flex-1 overflow-hidden bg-base-100">
      {#if diffLoader.isLoading}
        <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/50 text-sm">
          <span class="loading loading-spinner loading-md text-primary"></span>
          <span>Loading diff...</span>
        </div>
      {:else if diffLoader.error}
        <div class="flex flex-col items-center justify-center flex-1 gap-3 text-error text-sm text-center p-5">
          <span class="text-5xl">⚠</span>
          <span>{diffLoader.error}</span>
        </div>
      {:else if $selfReviewDiffFiles.length === 0}
            <div class="flex flex-col items-center justify-center flex-1 gap-4 text-base-content/50 text-center p-10">
              <span class="text-6xl">📂</span>
              <h3 class="text-xl font-semibold text-base-content m-0">No changes for current selection</h3>
              <p class="text-sm m-0">
                {#if diffLoader.selectedCommitSha === null}
                  Make changes or enable uncommitted changes from the commit history pane.
                {:else}
                  This commit has no displayable diff. Switch back to All changes from the commit history pane.
                {/if}
              </p>
            </div>
          {:else}
            <DiffViewer
              bind:this={diffViewer}
              files={$selfReviewDiffFiles}
              existingComments={inlineReviewComments}
              {fileTreeVisible}
              onToggleFileTree={() => { fileTreeVisible = !fileTreeVisible }}
              fetchFileContents={fetchTaskFileContents}
              batchFetchFileContents={batchFetchTaskFileContents}
              {includeUncommitted}
            >
              {#snippet toolbarExtra()}
                <div class="w-px h-5 bg-base-300 mx-1 self-center"></div>
                <button
                  class="btn btn-ghost btn-xs gap-1 {sidebarVisible ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
                  onclick={() => { sidebarVisible = !sidebarVisible }}
                  title={sidebarVisible ? 'Hide comments panel' : 'Show comments panel'}
                >
                  Comments
                  {#if commentSelection.unaddressedCount > 0 && !sidebarVisible}
                    <span class="badge badge-error badge-xs">{commentSelection.unaddressedCount}</span>
                  {/if}
                </button>
              {/snippet}
            </DiffViewer>
          {/if}
    </div>
    {#if sidebarVisible}
      <ResizablePanel storageKey="self-review-comments" defaultWidth={360} minWidth={240} maxWidth={600} side="right">
            <div class="border-l border-base-300 overflow-hidden flex flex-col h-full bg-base-100">
              <div class="flex items-center border-b border-base-300 bg-base-200 shrink-0">
                <button class="flex-1 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-center transition-colors {sidebarTab === 'pr' ? 'text-primary border-b-2 border-primary bg-base-100' : 'text-base-content/50 hover:text-base-content hover:bg-base-content/5'}"
                  onclick={() => { sidebarTab = 'pr' }}>
                  PR Comments
                  {#if commentSelection.unaddressedCount > 0}<span class="badge badge-error badge-xs ml-1">{commentSelection.unaddressedCount}</span>{/if}
                </button>
                <button class="flex-1 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-center transition-colors {sidebarTab === 'notes' ? 'text-primary border-b-2 border-primary bg-base-100' : 'text-base-content/50 hover:text-base-content hover:bg-base-content/5'}"
                  onclick={() => { sidebarTab = 'notes' }}>
                  Notes
                  {#if $selfReviewGeneralComments.length > 0}<span class="badge badge-ghost badge-xs ml-1">{$selfReviewGeneralComments.length}</span>{/if}
                </button>
              </div>
              <div class="flex-1 overflow-hidden flex flex-col" class:hidden={sidebarTab !== 'pr'}>
                {#if diffLoader.linkedPr}
                  <div class="flex items-center gap-2 px-3 py-2 bg-base-200/50 border-b border-base-300 shrink-0">
                    {#if commentSelection.selectedCount > 0}
                      <span class="text-[0.7rem] font-semibold text-primary">{commentSelection.selectedCount} selected</span>
                      <button class="btn btn-ghost btn-xs text-base-content/40 hover:text-base-content" onclick={commentSelection.deselectAll}>Clear</button>
                    {:else if commentSelection.unaddressedCount > 0}
                      <button class="btn btn-ghost btn-xs text-base-content/40 hover:text-primary" onclick={commentSelection.selectAll}>Select all</button>
                    {/if}
                    <span class="flex-1"></span>
                    {#if commentSelection.addressedCount > 0}
                      <button
                        class="btn btn-ghost btn-xs text-base-content/40"
                        onclick={() => { showAddressed = !showAddressed }}
                      >
                        {showAddressed ? 'Hide addressed' : `Show ${commentSelection.addressedCount} addressed`}
                      </button>
                    {/if}
                    <span class="text-[0.7rem] text-primary cursor-pointer hover:underline" role="link" tabindex="0"
                      onclick={() => openUrl(diffLoader.linkedPr!.url)}
                      onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && openUrl(diffLoader.linkedPr!.url)}>GitHub ↗</span>
                  </div>
                  {#if diffLoader.prComments.length === 0}
                    <div class="flex flex-col items-center justify-center flex-1 gap-2 px-4 py-8 text-center">
                      <span class="text-2xl opacity-40">💬</span>
                      <p class="m-0 text-xs text-base-content/50">No review comments on this PR yet</p>
                    </div>
                  {:else if visibleComments.length === 0 && commentSelection.addressedCount > 0}
                    <div class="flex flex-col items-center justify-center flex-1 gap-2 px-4 py-8 text-center">
                      <span class="text-2xl opacity-40">✓</span>
                      <p class="m-0 text-xs text-base-content/50">All comments addressed</p>
                    </div>
                  {:else}
                    <div class="flex-1 overflow-y-auto">
                      {#each visibleComments as comment (comment.id)}
                        {@const isSelected = commentSelection.selectedPrCommentIds.has(comment.id)}
                        <div class="px-4 py-3.5 border-b border-base-300 last:border-b-0 {comment.addressed === 1 ? 'opacity-50' : ''}">
                          <div class="flex items-start gap-2">
                            {#if comment.addressed === 0}
                              <input
                                type="checkbox"
                                class="checkbox checkbox-xs checkbox-primary mt-0.5 shrink-0"
                                checked={isSelected}
                                onchange={() => commentSelection.toggleSelected(comment.id)}
                              />
                            {/if}
                            <div class="flex-1 min-w-0">
                              <div class="flex items-center gap-1.5 mb-1.5 flex-wrap">
                                <div class="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center text-[0.6rem] font-bold text-primary shrink-0">
                                  {comment.author.charAt(0).toUpperCase()}
                                </div>
                                <span class="text-xs font-semibold text-base-content">@{comment.author}</span>
                                {#if comment.addressed === 1}<span class="badge badge-success badge-xs">Addressed</span>{/if}
                                <span class="text-[0.65rem] text-base-content/40 ml-auto">{timeAgo(comment.created_at * 1000)}</span>
                              </div>
                              {#if comment.file_path}
                                <div class="flex items-center gap-1 mb-1.5">
                                  {#if comment.line_number}
                                    <button
                                      class="text-xs text-base-content/50 font-mono bg-base-200 rounded px-1.5 py-0.5 overflow-hidden text-ellipsis whitespace-nowrap max-w-full hover:text-primary hover:bg-primary/10 cursor-pointer transition-colors"
                                      onclick={() => diffViewer?.scrollToComment(comment.file_path!, comment.line_number!)}
                                    >{comment.file_path}:{comment.line_number}</button>
                                  {:else}
                                    <span class="text-xs text-base-content/50 font-mono bg-base-200 rounded px-1.5 py-0.5 overflow-hidden text-ellipsis whitespace-nowrap max-w-full">{comment.file_path}</span>
                                  {/if}
                                </div>
                              {/if}
                              <div class="text-sm text-base-content leading-relaxed [&_.markdown-body]:text-sm [&_.markdown-body_pre]:text-xs [&_.markdown-body_code]:text-xs [&_.markdown-body_p]:my-1.5">
                                <MarkdownContent content={comment.body} />
                              </div>
                              {#if comment.addressed === 0}
                                <button
                                  class="btn btn-ghost btn-xs mt-1.5 text-base-content/50 hover:text-success hover:bg-success/10"
                                  onclick={() => commentSelection.markAddressed(comment.id)}
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

              <div class="flex-1 overflow-hidden" class:hidden={sidebarTab !== 'notes'}>
                <GeneralCommentsSidebar taskId={task.id} />
              </div>
            </div>
        </ResizablePanel>
    {/if}
  </div>

  <SendToAgentPanel
    taskId={task.id}
    taskTitle={task.initial_prompt}
    {agentStatus}
    {onSendToAgent}
    onRefresh={diffLoader.refresh}
    selectedPrComments={commentSelection.selectedPrComments}
    onSendComplete={() => { commentSelection.deselectAll() }}
  />
</div>
