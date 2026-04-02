<script lang="ts">
  import { DiffView, DiffModeEnum, SplitSide } from '@git-diff-view/svelte'
  import '@git-diff-view/svelte/styles/diff-view-pure.css'
  import './DiffViewerTheme.css'
  import type { PrFileDiff, ReviewComment, ReviewSubmissionComment, AgentReviewComment } from '../../../../lib/types'
  import { pendingManualComments, agentReviewComments } from '../../../../lib/stores'
  import { updateAgentReviewCommentStatus } from '../../../../lib/ipc'
  import { isTruncated, getTruncationStats, type FileContents } from '../../../../lib/diffAdapter'
  import { buildExtendData, type CommentDisplayData } from '../../../../lib/diffComments'
  import { timeAgo } from '../../../../lib/timeAgo'
  import MarkdownContent from '../../../shared/content/MarkdownContent.svelte'
  import { diffHighlighter } from '../../../../lib/diffHighlighter'
  import { createDiffSearch } from '../../../../lib/useDiffSearch.svelte'
  import { createDiffWorker } from '../../../../lib/useDiffWorker.svelte'
  import { createFileContentsFetcher } from '../../../../lib/useFileContentsFetcher.svelte'
  import { createVirtualizer } from '../../../../lib/useVirtualizer.svelte'
  import { tick } from 'svelte'
  import { sortFilesAsTree } from '../../../../lib/fileSort'
  import { getFileStatusIcon, getFileStatusColor, getFileStatusLabel } from '../../../../lib/fileStatus'
  import { themeMode, getDiffTheme } from '../../../../lib/theme'
  import type { Snippet } from 'svelte'
  interface Props {
    files?: PrFileDiff[]
    existingComments?: ReviewComment[]
    repoOwner?: string
    repoName?: string
    fileTreeVisible?: boolean
    onToggleFileTree?: () => void
    fetchFileContents?: (file: PrFileDiff) => Promise<FileContents>
    batchFetchFileContents?: (files: PrFileDiff[]) => Promise<Map<string, FileContents>>
    toolbarExtra?: Snippet
    includeUncommitted?: boolean
    agentComments?: AgentReviewComment[]
  }
  let { files = [], existingComments = [], repoOwner: _repoOwner = '', repoName: _repoName = '', fileTreeVisible = true, onToggleFileTree, fetchFileContents, batchFetchFileContents, toolbarExtra, includeUncommitted = false, agentComments = [] }: Props = $props()
  let diffViewMode = $state<DiffModeEnum>(DiffModeEnum.Split)
  let diffViewWrap = $state(false)
  let commentText = $state('')
  let collapsedFiles = $state(new Set<string>())
  let scrollContainerEl = $state<HTMLElement | null>(null)
  let hasAutoCollapsed = false
  const fileContentsFetcher = createFileContentsFetcher({
    getFiles: () => files,
    getIncludeUncommitted: () => includeUncommitted,
    getFetchFileContents: () => fetchFileContents,
    getBatchFetchFileContents: () => batchFetchFileContents,
  })
  const diffWorker = createDiffWorker({
    getFiles: () => files,
    getFileContentsMap: () => fileContentsFetcher.fileContentsMap,
  })
  function toggleCollapse(filename: string) {
    const next = new Set(collapsedFiles)
    if (next.has(filename)) {
      next.delete(filename)
    } else {
      next.add(filename)
    }
    collapsedFiles = next
  }

  // Auto-collapse large files on initial load
  $effect(() => {
    if (hasAutoCollapsed) return
    if (files.length === 0) return

    const largeFiles = new Set<string>()
    for (const file of files) {
      if (file.additions + file.deletions > 500 || file.is_truncated === true) {
        largeFiles.add(file.filename)
      }
    }
    collapsedFiles = largeFiles
    hasAutoCollapsed = true
  })

  export function scrollToFile(filename: string) {
    const index = sortedFiles.findIndex(f => f.filename === filename)
    if (index >= 0) {
      if (collapsedFiles.has(filename)) {
        const next = new Set(collapsedFiles)
        next.delete(filename)
        collapsedFiles = next
      }
      virtualizer.scrollToIndex(index, { align: 'start', behavior: 'smooth' })
    }
  }

  export async function scrollToComment(filename: string, lineNumber: number) {
    const index = sortedFiles.findIndex(f => f.filename === filename)
    if (index < 0) return

    // Uncollapse the file if needed
    if (collapsedFiles.has(filename)) {
      const next = new Set(collapsedFiles)
      next.delete(filename)
      collapsedFiles = next
    }

    // Scroll virtualizer to the file
    virtualizer.scrollToIndex(index, { align: 'start' })

    // Wait for DOM to render (same pattern as useDiffSearch navigateToCurrentMatch)
    await tick()
    await new Promise<void>(r => requestAnimationFrame(() => r()))
    await tick()

    if (!scrollContainerEl) return

    // Find the file container, then the line within it
    const fileEl = scrollContainerEl.querySelector(`[data-diff-file="${CSS.escape(filename)}"]`)
    if (!fileEl) return

    // Try to find the extend line (comment annotation) first, then the content line
    const targetEl =
      fileEl.querySelector(`tr[data-line="${lineNumber}-extend"]`) ??
      fileEl.querySelector(`tr[data-line="${lineNumber}"]`)

    if (!targetEl) return

    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })

    // Flash highlight
    targetEl.classList.add('diff-comment-highlight')
    setTimeout(() => targetEl.classList.remove('diff-comment-highlight'), 2000)
  }

  function autofocus(node: HTMLElement) {
    node.focus()
  }

  function submitInlineComment(filename: string, lineNumber: number, side: SplitSide, onClose: () => void) {
    if (!commentText.trim()) return
    const newComment: ReviewSubmissionComment = {
      path: filename,
      line: lineNumber,
      side: side === SplitSide.old ? 'LEFT' : 'RIGHT',
      body: commentText.trim()
    }
    $pendingManualComments = [...$pendingManualComments, newComment]
    onClose()
    commentText = ''
  }

  // Large diff warning banner calculations
  const totalChanges = $derived(files.reduce((sum, f) => sum + f.additions + f.deletions, 0))
  const totalFiles = $derived(files.length)
  const collapsedCount = $derived(collapsedFiles.size)
  const showLargeDiffWarning = $derived(totalChanges > 5000)
  const sortedFiles = $derived(sortFilesAsTree(files))

  const virtualizer = createVirtualizer({
    getCount: () => sortedFiles.length,
    getScrollElement: () => scrollContainerEl,
    estimateSize: (index) => {
      const file = sortedFiles[index]
      if (!file) return 300
      if (collapsedFiles.has(file.filename)) return 60
      const lineCount = file.patch_line_count ?? (file.additions + file.deletions) * 2
      return 62 + Math.min(lineCount, 200) * 20
    },
    getOverscan: () => 2,
  })
  const search = createDiffSearch({
    isSplitMode: () => diffViewMode === DiffModeEnum.Split,
    getDiffViewWrap: () => diffViewWrap,
    getCollapsedFiles: () => collapsedFiles,
    getSortedFiles: () => sortedFiles,
    getScrollContainer: () => scrollContainerEl,
    getVisibleItems: () => virtualizer.virtualItems,
    scrollToIndex: (index, opts) => virtualizer.scrollToIndex(index, opts),
    onUncollapseFile: (filename) => {
      const next = new Set(collapsedFiles)
      next.delete(filename)
      collapsedFiles = next
    },
  })
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="flex flex-col flex-1 min-w-0 h-full overflow-hidden"
  role="region"
  aria-label="Diff viewer"
  tabindex="-1"
  onkeydown={search.handleRootKeydown}
>
  <div class="flex items-center gap-1 px-3 py-2 bg-base-200 border-b border-base-300">
    {#if onToggleFileTree}
      <button
        class="btn btn-ghost btn-xs {fileTreeVisible ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
        title={fileTreeVisible ? 'Hide file tree' : 'Show file tree'}
        onclick={() => onToggleFileTree!()}
      >
        {fileTreeVisible ? '◧' : '☰'}
      </button>
      <div class="w-px h-5 bg-base-300 mx-1 self-center"></div>
    {/if}
    <button
      class="btn btn-ghost btn-xs {diffViewMode === DiffModeEnum.Split ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
      onclick={() => (diffViewMode = DiffModeEnum.Split)}
    >
      Split
    </button>
    <button
      class="btn btn-ghost btn-xs {diffViewMode === DiffModeEnum.Unified ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
      onclick={() => (diffViewMode = DiffModeEnum.Unified)}
    >
      Unified
    </button>
    <div class="w-px h-5 bg-base-300 mx-1 self-center"></div>
    <button
      class="btn btn-ghost btn-xs {diffViewWrap ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
      onclick={() => (diffViewWrap = !diffViewWrap)}
      title={diffViewWrap ? 'Disable line wrapping' : 'Enable line wrapping'}
    >
      Wrap
    </button>
    <div class="w-px h-5 bg-base-300 mx-1 self-center"></div>
    <button
      class="btn btn-ghost btn-xs text-base-content/50"
      onclick={search.open}
      title="Search (⌘F)"
    >🔍</button>
    {#if search.visible}
      <input
        type="text"
        class="input input-xs input-bordered w-40"
        placeholder="Search diff..."
        value={search.query}
        oninput={(e: Event) => {
          if (!(e.currentTarget instanceof HTMLInputElement)) return
          search.setQuery(e.currentTarget.value)
        }}
        bind:this={search.inputEl}
        onkeydown={search.handleKeydown}
      />
      <span class="text-xs text-base-content/50 tabular-nums">
        {#if search.query && search.matchCount === 0}
          0 results
        {:else if search.matchCount > 0}
          {search.currentIndex + 1} of {search.matchCount}
        {/if}
      </span>
      <button
        class="btn btn-ghost btn-xs"
        onclick={search.goToPrev}
        disabled={search.matchCount === 0}
        title="Previous match (Shift+Enter)"
      >▲</button>
      <button
        class="btn btn-ghost btn-xs"
        onclick={search.goToNext}
        disabled={search.matchCount === 0}
        title="Next match (Enter)"
      >▼</button>
      <button
        class="btn btn-ghost btn-xs"
        onclick={search.close}
        title="Close search (Escape)"
      >✕</button>
    {/if}
    {#if toolbarExtra}
      <div class="ml-auto"></div>
      {@render toolbarExtra()}
    {/if}
  </div>

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div role="presentation" class="flex-1 overflow-y-auto overflow-x-hidden bg-base-100" bind:this={scrollContainerEl} ondblclick={search.handleDoubleClick} onclick={search.handleContainerClick}>
    {#if files.length === 0}
      <div class="flex items-center justify-center h-full text-base-content/50 text-sm">No files to display</div>
    {:else}
      {#if showLargeDiffWarning}
        <div class="alert alert-warning py-2 px-4 rounded-none border-x-0 border-t-0 text-sm">
          <span>Large diff — {totalFiles} files, {totalChanges} total changes. {collapsedCount} files auto-collapsed for performance.</span>
        </div>
      {/if}
      <div style="height: {virtualizer.totalSize}px; width: 100%; position: relative;">
        {#each virtualizer.virtualItems as row (row.key)}
          {@const file = sortedFiles[row.index]}
          {@const truncated = isTruncated(file)}
          {@const truncStats = getTruncationStats(file)}
          <div
            data-diff-file={file.filename}
            data-index={row.index}
            style="position: absolute; top: {row.start}px; width: 100%; padding: 0 0 12px 0;"
            use:virtualizer.measureAction
          >
            <div class="border border-base-300 rounded-md overflow-hidden">
              <button class="w-full flex items-center gap-2 px-4 py-3 bg-base-200 hover:bg-base-300 transition-colors cursor-pointer border-b border-base-300" onclick={() => toggleCollapse(file.filename)}>
                <span class="text-xs text-base-content/50 flex-shrink-0">{collapsedFiles.has(file.filename) ? '▶' : '▼'}</span>
                <span class="font-bold text-sm" style="color: {getFileStatusColor(file.status)}">
                  {getFileStatusIcon(file.status)}
                </span>
                <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-base-content" title={file.filename}>
                  {#if file.previous_filename}
                    <span class="text-base-content/50 line-through">{file.previous_filename}</span>
                    <span class="text-primary mx-1">→</span>
                  {/if}
                  {file.filename}
                </span>
                <span class="text-xs font-semibold uppercase tracking-wider flex-shrink-0" style="color: {getFileStatusColor(file.status)}">{getFileStatusLabel(file.status)}</span>
                <span class="flex gap-2 text-xs flex-shrink-0">
                  {#if file.additions > 0}<span class="text-success">+{file.additions}</span>{/if}
                  {#if file.deletions > 0}<span class="text-error">−{file.deletions}</span>{/if}
                </span>
              </button>
              {#if !collapsedFiles.has(file.filename)}
                {#if truncated}
                  <div class="alert alert-info py-1.5 px-4 rounded-none border-x-0 text-xs">
                    <span>
                      Diff truncated — {truncStats ? `${truncStats.total} lines total, showing first ${truncStats.shown}` : 'showing partial diff'}
                    </span>
                  </div>
                {/if}
                {@const workerDiffFile = diffWorker.getDiffFile(file.filename)}
                {#if workerDiffFile}
                <DiffView
                  diffFile={workerDiffFile}
                  extendData={buildExtendData(file.filename, existingComments, $pendingManualComments, agentComments)}
                  diffViewMode={diffViewMode}
                  diffViewWrap={diffViewWrap}
                  diffViewTheme={getDiffTheme($themeMode)}
                  diffViewHighlight={true}
                  diffViewAddWidget={true}
                  diffViewFontSize={12}
                  registerHighlighter={diffHighlighter}
                  onAddWidgetClick={(_lineNumber, _side) => {
                    commentText = ''
                  }}
                >
                    {#snippet renderExtendLine({ lineNumber: _ln, side: _side, data, diffFile: _df, onUpdate: _ou }: { lineNumber: number; side: SplitSide; data: CommentDisplayData; diffFile: import('@git-diff-view/core').DiffFile; onUpdate: () => void })}
                      <div class="w-full">
                        {#each data.comments as comment}
                          <div class="{comment.isReply ? 'ml-8' : ''} px-4 py-2.5 mx-4 {comment.isReply ? 'mt-0 mb-1.5 border-t-0 rounded-t-none' : 'my-1.5'} bg-base-100 border border-base-300 rounded-md text-[0.8rem] {comment.type === 'pending' ? 'border-l-4 border-l-warning' : comment.type === 'existing' ? 'border-l-4 border-l-primary' : comment.type === 'agent' ? 'border-l-4 border-l-success' : ''}">
                            <div class="flex items-center gap-2 mb-1.5">
                              {#if comment.type === 'existing'}
                                <div class="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center text-[0.6rem] font-bold text-primary shrink-0">
                                  {(comment.author ?? '?').charAt(0).toUpperCase()}
                                </div>
                                <strong class="text-base-content font-semibold text-xs">{comment.author}</strong>
                                {#if comment.createdAt}
                                  <span class="text-base-content/50 text-[0.7rem]">{timeAgo(new Date(comment.createdAt).getTime())}</span>
                                {/if}
                                {#if comment.isReply}
                                  <span class="text-base-content/30 text-[0.65rem]">↩ reply</span>
                                {/if}
                              {:else if comment.type === 'agent'}
                                <span class="badge badge-success badge-sm">AI Review</span>
                                {#if comment.status === 'approved'}
                                  <span class="badge badge-info badge-sm">Approved</span>
                                {/if}
                                <div class="ml-auto flex gap-1">
                                  {#if comment.status !== 'approved'}
                                    <button
                                      class="btn btn-ghost btn-xs text-success hover:text-success/80"
                                      title="Approve — add to pending comments"
                                      onclick={async () => {
                                        if (comment.commentId === undefined) return
                                        try {
                                           await updateAgentReviewCommentStatus(comment.commentId, 'approved')
                                           $pendingManualComments = [...$pendingManualComments, {
                                             path: comment.filePath || file.filename,
                                            line: comment.lineNumber || 0,
                                            side: comment.commentSide || 'RIGHT',
                                            body: comment.body
                                          }]
                                          $agentReviewComments = $agentReviewComments.map(c =>
                                            c.id === comment.commentId ? { ...c, status: 'approved' } : c
                                          )
                                        } catch (e) {
                                          console.error('[DiffViewer] Failed to approve comment:', e)
                                        }
                                      }}
                                    >✓</button>
                                  {/if}
                                  <button
                                    class="btn btn-ghost btn-xs text-base-content/50 hover:text-error"
                                    title="Dismiss"
                                    onclick={async () => {
                                      if (comment.commentId === undefined) return
                                      try {
                                        await updateAgentReviewCommentStatus(comment.commentId, 'dismissed')
                                        $agentReviewComments = $agentReviewComments.map(c =>
                                          c.id === comment.commentId ? { ...c, status: 'dismissed' } : c
                                        )
                                      } catch (e) {
                                        console.error('[DiffViewer] Failed to dismiss comment:', e)
                                      }
                                    }}
                                  >✕</button>
                                </div>
                              {:else}
                                <span class="badge badge-warning badge-sm">Pending</span>
                                <button
                                  class="btn btn-ghost btn-xs text-base-content/50 hover:text-error ml-auto"
                                  onclick={() => {
                                    $pendingManualComments = $pendingManualComments.filter(
                                      (_, i) => i !== comment.index
                                    )
                                  }}
                                >✕</button>
                              {/if}
                            </div>
                            <div class="text-base-content leading-relaxed text-[0.8rem] [&_p]:m-0 [&_p+p]:mt-1.5 [&_pre]:text-[0.75rem] [&_code]:text-[0.75rem] [&_pre]:bg-base-200 [&_pre]:rounded [&_pre]:p-2 [&_pre]:my-1.5 [&_code]:bg-base-200 [&_code]:px-1 [&_code]:rounded [&_ul]:my-1 [&_ol]:my-1 [&_li]:ml-4 [&_blockquote]:border-l-2 [&_blockquote]:border-base-300 [&_blockquote]:pl-3 [&_blockquote]:text-base-content/70 [&_a]:text-primary [&_a]:underline">
                              <MarkdownContent content={comment.body} />
                            </div>
                          </div>
                        {/each}
                      </div>
                    {/snippet}
                    {#snippet renderWidgetLine({ lineNumber, side, diffFile, onClose }: { lineNumber: number; side: SplitSide; diffFile: import('@git-diff-view/core').DiffFile; onClose: () => void })}
                      <div class="p-3 mx-4 my-2 bg-base-100 border border-base-300 rounded-md">
                        <textarea
                          class="textarea textarea-bordered w-full min-h-[60px] text-[0.8rem] resize-y"
                          placeholder="Leave a comment… (⇧Enter to submit)"
                          rows="3"
                          bind:value={commentText}
                          use:autofocus
                          onkeydown={(e: KeyboardEvent) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || e.shiftKey)) {
                              e.preventDefault()
                              submitInlineComment(file.filename, lineNumber, side, onClose)
                            }
                          }}
                        ></textarea>
                        <div class="flex justify-end gap-2 mt-2">
                          <button
                            class="btn btn-ghost btn-xs border border-base-300"
                            onclick={() => {
                              onClose()
                            }}
                          >Cancel</button>
                           <button
                             class="btn btn-primary btn-xs"
                             onclick={() => submitInlineComment(file.filename, lineNumber, side, onClose)}
                          >Add Comment</button>
                        </div>
                      </div>
                    {/snippet}
                  </DiffView>
                {:else}
                  <div class="flex items-center justify-center py-8 text-base-content/40">
                    <span class="loading loading-spinner loading-sm mr-2"></span>
                    <span class="text-xs">Processing diff…</span>
                  </div>
                {/if}
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
