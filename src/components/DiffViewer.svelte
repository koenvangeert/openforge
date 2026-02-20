<script lang="ts">
  import { DiffView, DiffModeEnum, SplitSide } from '@git-diff-view/svelte'
  import { setEnableFastDiffTemplate } from '@git-diff-view/core'
  import '@git-diff-view/svelte/styles/diff-view-pure.css'
  import './DiffViewerTheme.css'
  import type { PrFileDiff, ReviewComment, ReviewSubmissionComment } from '../lib/types'
  import { pendingManualComments } from '../lib/stores'
  import { toGitDiffViewData, isTruncated, getTruncationStats, type FileContents } from '../lib/diffAdapter'
  import { buildExtendData, type CommentDisplayData } from '../lib/diffComments'
  import { diffHighlighter } from '../lib/diffHighlighter'

  setEnableFastDiffTemplate(true)

  interface Props {
    files?: PrFileDiff[]
    existingComments?: ReviewComment[]
    repoOwner?: string
    repoName?: string
    fileTreeVisible?: boolean
    onToggleFileTree?: () => void
    fetchFileContents?: (file: PrFileDiff) => Promise<FileContents>
  }

  let { files = [], existingComments = [], repoOwner: _repoOwner = '', repoName: _repoName = '', fileTreeVisible = true, onToggleFileTree, fetchFileContents }: Props = $props()

  let diffViewMode = $state<DiffModeEnum>(DiffModeEnum.Split)
  let commentText = $state('')
  let fileContentsMap = $state<Map<string, FileContents>>(new Map())
  let collapsedFiles = $state(new Set<string>())

  // Auto-collapse large files on initial load (plain let, not $state — only a guard)
  let hasAutoCollapsed = false

  function getStatusIcon(status: string): string {
    switch (status) {
      case 'added': return '+'
      case 'removed': return '−'
      case 'modified': return '±'
      case 'renamed': return '→'
      default: return '•'
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'added': return 'var(--success)'
      case 'removed': return 'var(--error)'
      case 'modified': return 'var(--warning)'
      case 'renamed': return 'var(--accent)'
      default: return 'var(--text-secondary)'
    }
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case 'added': return 'Added'
      case 'removed': return 'Deleted'
      case 'modified': return 'Modified'
      case 'renamed': return 'Renamed'
      default: return status
    }
  }

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

  // Fetch file contents for all files with patches
  let fetchedKeys = new Set<string>()

  $effect(() => {
    if (!fetchFileContents || files.length === 0) return

    const fetcher = fetchFileContents
    for (const file of files) {
      if (!file.patch || fetchedKeys.has(file.filename)) continue
      fetchedKeys.add(file.filename)

      fetcher(file).then(contents => {
        fileContentsMap = new Map(fileContentsMap).set(file.filename, contents)
      }).catch(err => {
        console.error(`Failed to fetch content for ${file.filename}:`, err)
      })
    }
  })

  export function scrollToFile(filename: string) {
    const el = document.querySelector(`[data-diff-file="${filename}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  // Large diff warning banner calculations
  const totalChanges = $derived(files.reduce((sum, f) => sum + f.additions + f.deletions, 0))
  const totalFiles = $derived(files.length)
  const collapsedCount = $derived(collapsedFiles.size)
  const showLargeDiffWarning = $derived(totalChanges > 5000)
</script>

<div class="flex flex-col flex-1 min-w-0 h-full overflow-hidden">
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
  </div>

  <div class="flex-1 overflow-y-auto overflow-x-hidden bg-base-100">
    {#if files.length === 0}
      <div class="flex items-center justify-center h-full text-base-content/50 text-sm">No files to display</div>
    {:else}
      {#if showLargeDiffWarning}
        <div class="alert alert-warning py-2 px-4 rounded-none border-x-0 border-t-0 text-sm">
          <span>Large diff — {totalFiles} files, {totalChanges} total changes. {collapsedCount} files auto-collapsed for performance.</span>
        </div>
      {/if}
      {#each files as file (file.filename)}
        {@const truncated = isTruncated(file)}
        {@const truncStats = getTruncationStats(file)}
        <div data-diff-file={file.filename} class="border border-base-300 rounded-md overflow-hidden mb-3">
          <button class="w-full flex items-center gap-2 px-4 py-3 bg-base-200 hover:bg-base-300 transition-colors cursor-pointer border-b border-base-300" onclick={() => toggleCollapse(file.filename)}>
            <span class="text-xs text-base-content/50 flex-shrink-0">{collapsedFiles.has(file.filename) ? '▶' : '▼'}</span>
            <span class="font-bold text-sm" style="color: {getStatusColor(file.status)}">
              {getStatusIcon(file.status)}
            </span>
            <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-base-content" title={file.filename}>
              {#if file.previous_filename}
                <span class="text-base-content/50 line-through">{file.previous_filename}</span>
                <span class="text-primary mx-1">→</span>
              {/if}
              {file.filename}
            </span>
            <span class="text-xs font-semibold uppercase tracking-wider flex-shrink-0" style="color: {getStatusColor(file.status)}">{getStatusLabel(file.status)}</span>
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
              data={toGitDiffViewData(file, fileContentsMap.get(file.filename))}
              extendData={buildExtendData(file.filename, existingComments, $pendingManualComments)}
              diffViewMode={diffViewMode}
              diffViewTheme="light"
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
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>
