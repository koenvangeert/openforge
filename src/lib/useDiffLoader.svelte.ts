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
  getTaskCommits,
  getCommitDiff,
  getActiveSelfReviewComments,
  getArchivedSelfReviewComments,
  getPrComments,
} from './ipc'
import type { CommitInfo, PrComment, PullRequestInfo } from './types'

// ============================================================================
// Interface
// ============================================================================

export interface DiffLoaderState {
  readonly isLoading: boolean
  readonly error: string | null
  readonly prComments: PrComment[]
  readonly linkedPr: PullRequestInfo | null
  readonly commits: CommitInfo[]
  readonly selectedCommitSha: string | null
  loadDiff(): Promise<void>
  loadCommits(): Promise<void>
  selectCommit(sha: string | null): Promise<void>
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
  let commits = $state<CommitInfo[]>([])
  let selectedCommitSha = $state<string | null>(null)

  async function loadDiff(): Promise<void> {
    isLoading = true
    error = null
    try {
      const taskId = deps.getTaskId()

      const diffs = selectedCommitSha !== null
        ? await getCommitDiff(taskId, selectedCommitSha)
        : await getTaskDiff(taskId, deps.getIncludeUncommitted())
      selfReviewDiffFiles.set(diffs)

      if (selectedCommitSha === null) {
        const activeComments = await getActiveSelfReviewComments(taskId)
        selfReviewGeneralComments.set(activeComments.filter(c => c.comment_type === 'general'))

        const archivedComments = await getArchivedSelfReviewComments(taskId)
        selfReviewArchivedComments.set(archivedComments.filter(c => c.comment_type === 'general'))

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
      }
    } catch (e) {
      console.error('Failed to load self-review data:', e)
      error = 'Failed to load diff. Please try again.'
    } finally {
      isLoading = false
    }
  }

  async function loadCommits(): Promise<void> {
    try {
      commits = await getTaskCommits(deps.getTaskId())
    } catch (e) {
      console.error('Failed to load commits:', e)
    }
  }

  async function selectCommit(sha: string | null): Promise<void> {
    selectedCommitSha = sha
    selfReviewDiffFiles.set([])
    await refresh()
  }

  async function refresh(): Promise<void> {
    isLoading = true
    error = null
    try {
      const taskId = deps.getTaskId()
      const diffs = selectedCommitSha !== null
        ? await getCommitDiff(taskId, selectedCommitSha)
        : await getTaskDiff(taskId, deps.getIncludeUncommitted())
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
    selectedCommitSha = null
    commits = []
  }

  return {
    get isLoading() { return isLoading },
    get error() { return error },
    get prComments() { return prComments },
    get linkedPr() { return linkedPr },
    get commits() { return commits },
    get selectedCommitSha() { return selectedCommitSha },
    loadDiff,
    loadCommits,
    selectCommit,
    refresh,
    cleanup,
  }
}
