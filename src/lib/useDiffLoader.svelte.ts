import { get } from 'svelte/store'
import {
  selfReviewDiffFiles,
  selfReviewGeneralComments,
  selfReviewArchivedComments,
  pendingManualComments,
  ticketPrs,
} from './stores'
import {
  getTaskDiff,
  getActiveSelfReviewComments,
  getArchivedSelfReviewComments,
  getPrComments,
} from './ipc'
import type { PrComment, PullRequestInfo } from './types'

// ============================================================================
// Interface
// ============================================================================

export interface DiffLoaderState {
  readonly isLoading: boolean
  readonly error: string | null
  readonly prComments: PrComment[]
  readonly linkedPr: PullRequestInfo | null
  loadDiff(): Promise<void>
  refresh(): Promise<void>
  cleanup(): void
}

// ============================================================================
// Factory
// ============================================================================

export function createDiffLoader(deps: {
  getTaskId: () => string
  getIncludeUncommitted: () => boolean
}): DiffLoaderState {
  let isLoading = $state(false)
  let error = $state<string | null>(null)
  let prComments = $state<PrComment[]>([])
  let linkedPr = $state<PullRequestInfo | null>(null)

  async function loadDiff(): Promise<void> {
    isLoading = true
    error = null
    try {
      const taskId = deps.getTaskId()
      const includeUncommitted = deps.getIncludeUncommitted()

      // 1. Load diff
      const diffs = await getTaskDiff(taskId, includeUncommitted)
      selfReviewDiffFiles.set(diffs)

      // 2. Load active comments and split by type
      const activeComments = await getActiveSelfReviewComments(taskId)
      selfReviewGeneralComments.set(activeComments.filter(c => c.comment_type === 'general'))

      // 3. Load archived comments and filter to general
      const archivedComments = await getArchivedSelfReviewComments(taskId)
      selfReviewArchivedComments.set(archivedComments.filter(c => c.comment_type === 'general'))

      // 4. Clear then populate pendingManualComments from inline active comments
      pendingManualComments.set(
        activeComments
          .filter(c => c.comment_type === 'inline')
          .map(c => ({
            path: c.file_path!,
            line: c.line_number!,
            body: c.body,
            side: 'RIGHT',
          }))
      )

      // 5. Load GitHub PR comments for the most recently updated open PR
      const taskPrs = get(ticketPrs).get(taskId) || []
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
      error = 'Failed to load diff. Please try again.'
    } finally {
      isLoading = false
    }
  }

  async function refresh(): Promise<void> {
    isLoading = true
    error = null
    try {
      const diffs = await getTaskDiff(deps.getTaskId(), deps.getIncludeUncommitted())
      selfReviewDiffFiles.set(diffs)
    } catch (e) {
      console.error('Failed to refresh diff:', e)
      error = 'Failed to refresh diff.'
    } finally {
      isLoading = false
    }
  }

  function cleanup(): void {
    selfReviewDiffFiles.set([])
    selfReviewGeneralComments.set([])
    selfReviewArchivedComments.set([])
    pendingManualComments.set([])
  }

  return {
    get isLoading() { return isLoading },
    get error() { return error },
    get prComments() { return prComments },
    get linkedPr() { return linkedPr },
    loadDiff,
    refresh,
    cleanup,
  }
}
