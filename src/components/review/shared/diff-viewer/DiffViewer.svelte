<script lang="ts">
  import SharedDiffViewer from '@openforge/pr-review-ui/DiffViewer.svelte'
  import type { PrFileDiff, ReviewComment, ReviewSubmissionComment, AgentReviewComment } from '../../../../lib/types'
  import { pendingManualComments, agentReviewComments } from '../../../../lib/stores'
  import { updateAgentReviewCommentStatus, openUrl } from '../../../../lib/ipc'
  import { clearSelfReviewInlineCommentDraft, getSelfReviewInlineCommentDraft, setSelfReviewInlineCommentDraft } from '../../../../lib/taskScopedReviewComments'
  import { getDiffTheme, themeMode } from '../../../../lib/theme'
  import type { FileContents } from '@openforge/pr-review-ui/diffAdapter'
  import type { Snippet } from 'svelte'

  interface BaseProps {
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
    onScrollTopChange?: (scrollTop: number) => void
    initialScrollTop?: number
    inlineDraftScopeId?: string
  }

  type PendingCommentsControl =
    | { pendingComments?: undefined; onPendingCommentsChange?: undefined }
    | { pendingComments: ReviewSubmissionComment[]; onPendingCommentsChange: (comments: ReviewSubmissionComment[]) => void }

  type Props = BaseProps & PendingCommentsControl

  let {
    files = [],
    existingComments = [],
    repoOwner = '',
    repoName = '',
    fileTreeVisible = true,
    onToggleFileTree,
    fetchFileContents,
    batchFetchFileContents,
    toolbarExtra,
    includeUncommitted = false,
    agentComments = [],
    pendingComments,
    onPendingCommentsChange,
    onScrollTopChange,
    initialScrollTop = 0,
    inlineDraftScopeId,
  }: Props = $props()

  type SharedDiffViewerHandle = {
    scrollToFile: (filename: string) => void
    scrollToComment: (filename: string, lineNumber: number) => Promise<void>
    getScrollTop: () => number
    setScrollTop: (scrollTop: number) => void
  }

  let sharedViewer = $state<SharedDiffViewerHandle | null>(null)
  const visiblePendingComments = $derived(pendingComments ?? $pendingManualComments)

  function setVisiblePendingComments(comments: ReviewSubmissionComment[]) {
    if (onPendingCommentsChange) {
      onPendingCommentsChange(comments)
    } else {
      $pendingManualComments = comments
    }
  }

  export function scrollToFile(filename: string) {
    sharedViewer?.scrollToFile(filename)
  }

  export function scrollToComment(filename: string, lineNumber: number) {
    return sharedViewer?.scrollToComment(filename, lineNumber) ?? Promise.resolve()
  }

  export function getScrollTop() {
    return sharedViewer?.getScrollTop() ?? 0
  }

  export function setScrollTop(scrollTop: number) {
    sharedViewer?.setScrollTop(scrollTop)
  }
</script>

<SharedDiffViewer
  bind:this={sharedViewer}
  {files}
  {existingComments}
  {repoOwner}
  {repoName}
  {fileTreeVisible}
  {onToggleFileTree}
  {fetchFileContents}
  {batchFetchFileContents}
  {toolbarExtra}
  {includeUncommitted}
  {agentComments}
  pendingComments={visiblePendingComments}
  onPendingCommentsChange={setVisiblePendingComments}
  onAgentCommentsChange={(comments) => { $agentReviewComments = comments }}
  onUpdateAgentCommentStatus={updateAgentReviewCommentStatus}
  onOpenUrl={openUrl}
  {onScrollTopChange}
  {initialScrollTop}
  {inlineDraftScopeId}
  getInlineDraft={getSelfReviewInlineCommentDraft}
  setInlineDraft={setSelfReviewInlineCommentDraft}
  clearInlineDraft={clearSelfReviewInlineCommentDraft}
  diffTheme={getDiffTheme($themeMode)}
/>
