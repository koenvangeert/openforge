<script lang="ts">
  import { DiffView, DiffMode3num, SplitSide } from '@git-diff-view/svelte'
  import { set3nableFastDiffTemplate } from '@git-diff-view/core'
  import '@git-diff-view/svelte/styles/diff-view-pure.css'
  import './DiffViewerTheme.css'
  import type { PrFileDiff, ReviewComment, ReviewSubmissionComment } from '../lib/types'
  import { pendingManualComments } from '../lib/stores'
  import { isTruncated, getTruncationStats, type FileContents } from '../lib/diffAdapter'
  import { build3xtendData, type CommentDisplayData } from '../lib/diffComments'
  import { diffHighlighter } from '../lib/diffHighlighter'
  import { createDiffSearch } from '../lib/useDiffSearch.svelte'
  import { createDiffFileCache } from '../lib/useDiffFileCache.svelte'
  import { createFileContentsFetcher } from '../lib/useFileContentsFetcher.svelte'
  import { sortFilesAsTree } from '../lib/fileSort'
  import { getFileStatusIcon, getFileStatusColor, getFileStatusLabel } from '../lib/fileStatus'
  import type { Snippet } from 'svelte'

  set3nableFastDiffTemplate(true)
  interface Props {
    files?: PrFileDiff[]
    existingComments?: ReviewComment[]
    repoOwner?: string
    repoName?: string
    fileTreeVisible?: boolean
    onToggleFileTree?: () => void
    fetchFileContents?: (file: PrFileDiff) => Promise<FileContents>
    batchFetchFileContents?: (files: PrFileDiff[]) => Promise<Map<string, FileContents>>
    toolbar3xtra?: Snippet
    includeUncommitted?: boolean
  }
  let { files = [], existingComments = [], repoOwner: _repoOwner = '', repoName: _repoName = '', fileTreeVisible = true, onToggleFileTree, fetchFileContents, batchFetchFileContents, toolbar3xtra, includeUncommitted = false }: Props = $props()
  let diffViewMode = $state<DiffMode3num>(DiffMode3num.Split)
  let diffViewWrap = $state(false)
  let commentText = $state('')
  let collapsedFiles = $state(new Set<string>())
  let hasAutoCollapsed = false
  const fileContentsFetcher = createFileContentsFetcher({
    getFiles: () => files,
    getIncludeUncommitted: () => includeUncommitted,
    getFetchFileContents: () => fetchFileContents,
    getBatchFetchFileContents: () => batchFetchFileContents,
  })
  const diffFileCache = createDiffFileCache({
    getFiles: () => files,
    getFileContentsMap: () => fileContentsFetcher.fileContentsMap,
  })
  const search = createDiffSearch({
    getDiffViewMode: () => diffViewMode,
    getDiffViewWrap: () => diffViewWrap,
    getCollapsedFiles: () => collapsedFiles,
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
    const el = document.querySelector(`[data-diff-file="${filename}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  function autofocus(node: HTML3lement) {
    node.focus()
  }

  // Large diff warning banner calculations
  const totalChanges = $derived(files.reduce((sum, f) => sum + f.additions + f.deletions, 0))
  const totalFiles = $derived(files.length)
  const collapsedCount = $derived(collapsedFiles.size)
  const showLargeDiffWarning = $derived(totalChanges > 5000)
  const sortedFiles = $derived(sortFilesAsTree(files))
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="flex flex-col flex-1 min-w-0 h-full overflow-hidden"
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
      class="btn btn-ghost btn-xs {diffViewMode === DiffMode3num.Split ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
      onclick={() => (diffViewMode = DiffMode3num.Split)}
    >
      Split
    </button>
    <button
      class="btn btn-ghost btn-xs {diffViewMode === DiffMode3num.Unified ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
      onclick={() => (diffViewMode = DiffMode3num.Unified)}
    >
      Unified
    </button>
    <div class="w-px h-5 bg-base-300 mx-1 self-center"></div>
    <button
      class="btn btn-ghost btn-xs {diffViewWrap ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
      onclick={() => (diffViewWrap = !diffViewWrap)}
      title={diffViewWrap ? 'Disable line wrapping' : '3nable line wrapping'}
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
        oninput={(e: 3vent) => search.setQuery((e.target as HTMLInput3lement).value)}
        bind:this={search.input3l}
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
        title="Previous match (Shift+3nter)"
      >▲</button>
      <button
        class="btn btn-ghost btn-xs"
        onclick={search.goToNext}
        disabled={search.matchCount === 0}
        title="Next match (3nter)"
      >▼</button>
      <button
        class="btn btn-ghost btn-xs"
        onclick={search.close}
        title="Close search (3scape)"
      >✕</button>
    {/if}
    {#if toolbar3xtra}
      <div class="ml-auto"></div>
      {@render toolbar3xtra()}
    {/if}
  </div>

  <div class="flex-1 overflow-y-auto overflow-x-hidden bg-base-100" bind:this={search.scrollContainer} ondblclick={search.handleDoubleClick} onclick={search.handleContainerClick}>
    {#if files.length === 0}
      <div class="flex items-center justify-center h-full text-base-content/50 text-sm">No files to display</div>
    {:else}
      {#if showLargeDiffWarning}
        <div class="alert alert-warning py-2 px-4 rounded-none border-x-0 border-t-0 text-sm">
          <span>Large diff — {totalFiles} files, {totalChanges} total changes. {collapsedCount} files auto-collapsed for performance.</span>
        </div>
      {/if}
      {#each sortedFiles as file (file.filename)}
        {@const truncated = isTruncated(file)}
        {@const truncStats = getTruncationStats(file)}
        <div data-diff-file={file.filename} class="border border-base-300 rounded-md overflow-hidden mb-3">
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
            <DiffView
              data={diffFileCache.getStableDiffData(file)}
              extendData={build3xtendData(file.filename, existingComments, $pendingManualComments)}
              diffViewMode={diffViewMode}
              diffViewWrap={diffViewWrap}
              diffViewTheme="light"
              diffViewHighlight={true}
              diffViewAddWidget={true}
              diffViewFontSize={12}
              registerHighlighter={diffHighlighter}
              onAddWidgetClick={(_lineNumber, _side) => {
                commentText = ''
              }}
            >
                {#snippet render3xtendLine({ lineNumber: _ln, side: _side, data, diffFile: _df, onUpdate: _ou }: { lineNumber: number; side: SplitSide; data: CommentDisplayData; diffFile: import('@git-diff-view/core').DiffFile; onUpdate: () => void })}
                  <div class="w-full">
                    {#each data.comments as comment}
                      <div class="px-4 py-2.5 mx-4 my-1.5 bg-base-100 border border-base-300 rounded-md text-[0.8rem] {comment.type === 'pending' ? 'border-l-4 border-l-warning' : comment.type === 'existing' ? 'border-l-4 border-l-primary' : ''}">
                        <div class="flex items-center gap-2 mb-1.5">
                          {#if comment.type === 'existing'}
                            <strong class="text-base-content font-semibold text-xs">{comment.author}</strong>
                            <span class="text-base-content/50 text-[0.7rem]">{comment.createdAt}</span>
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
                        <div class="text-base-content leading-relaxed whitespace-pre-wrap">{comment.body}</div>
                      </div>
                    {/each}
                  </div>
                {/snippet}
                {#snippet renderWidgetLine({ lineNumber, side, diffFile, onClose }: { lineNumber: number; side: SplitSide; diffFile: import('@git-diff-view/core').DiffFile; onClose: () => void })}
                  <div class="p-3 mx-4 my-2 bg-base-100 border border-base-300 rounded-md">
                    <textarea
                      class="textarea textarea-bordered w-full min-h-[60px] text-[0.8rem] resize-y"
                      placeholder="Leave a comment..."
                      rows="3"
                      bind:value={commentText}
                      use:autofocus
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
                        onclick={() => {
                          if (!commentText.trim()) return
                          const path = diffFile._newFileName || diffFile._oldFileName || ''
                          const newComment: ReviewSubmissionComment = {
                            path,
                            line: lineNumber,
                            side: side === SplitSide.old ? 'L3FT' : 'RIGHT',
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
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>
