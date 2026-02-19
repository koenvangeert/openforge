<script lang="ts">
  import { DiffView, DiffModeEnum, SplitSide } from '@git-diff-view/svelte'
  import '@git-diff-view/svelte/styles/diff-view-pure.css'
  import './DiffViewerTheme.css'
  import type { PrFileDiff, ReviewComment, ReviewSubmissionComment } from '../lib/types'
  import { pendingManualComments } from '../lib/stores'
  import { toGitDiffViewData, type FileContents } from '../lib/diffAdapter'
  import { buildExtendData, type CommentDisplayData } from '../lib/diffComments'

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
      {#each files as file (file.filename)}
        <div data-diff-file={file.filename} class="mb-px">
          <DiffView
            data={toGitDiffViewData(file, fileContentsMap.get(file.filename))}
            extendData={buildExtendData(file.filename, existingComments, $pendingManualComments)}
            diffViewMode={diffViewMode}
            diffViewTheme="light"
            diffViewHighlight={true}
            diffViewAddWidget={true}
            diffViewFontSize={12}
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
        </div>
      {/each}
    {/if}
  </div>
</div>
