import type { Task, AgentSession, PullRequestInfo } from './types'
import { isReadyToMerge, hasMergeConflicts } from './types'

export type TaskState =
  | 'egg' | 'idle' | 'active' | 'needs-input' | 'paused' | 'agent-done' | 'failed' | 'interrupted' | 'done'
  | 'pr-draft' | 'pr-open' | 'ci-failed' | 'changes-requested' | 'ready-to-merge' | 'pr-queued' | 'pr-merged' | 'ci-running' | 'review-pending' | 'unaddressed-comments' | 'merge-conflict'

export const ALL_TASK_STATES: TaskState[] = [
  'idle',
  'active',
  'needs-input',
  'paused',
  'agent-done',
  'failed',
  'interrupted',
  'pr-draft',
  'pr-open',
  'ci-running',
  'review-pending',
  'ci-failed',
  'changes-requested',
  'unaddressed-comments',
  'ready-to-merge',
  'pr-queued',
  'pr-merged',
  'merge-conflict',
]

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  egg: 'New',
  idle: 'Idle',
  active: 'Running',
  'needs-input': 'Needs Input',
  'paused': 'Paused',
  'agent-done': 'Agent Done',
  'failed': 'Failed',
  'interrupted': 'Interrupted',
  done: 'Done',
  'pr-draft': 'PR Draft',
  'pr-open': 'PR Open',
  'ci-running': 'CI Running',
  'review-pending': 'Awaiting Review',
  'ci-failed': 'CI Failed',
  'changes-requested': 'Changes Requested',
  'unaddressed-comments': 'Unaddressed Comments',
  'ready-to-merge': 'Ready to Merge',
  'pr-queued': 'In Merge Queue',
  'pr-merged': 'PR Merged',
  'merge-conflict': 'Merge Conflict',
}

function getPrState(prs: PullRequestInfo[]): TaskState | null {
  // Find the most relevant PR: prefer open, then merged, then closed
  const openPr = prs.find(pr => pr.state === 'open')
  const mergedPr = prs.find(pr => pr.state === 'merged')
  const pr = openPr ?? mergedPr

  if (!pr) return null

  if (pr.state === 'merged') return 'pr-merged'

  // CI failures always take priority over merge readiness
  if (pr.ci_status === 'failure') return 'ci-failed'

  // GitHub's source of truth: mergeable_state tells us if all requirements are met
  // But only when CI is not pending — pending CI means the result isn't final yet
  if (isReadyToMerge(pr) && pr.ci_status !== 'pending')
    return pr.is_queued ? 'pr-queued' : 'ready-to-merge'

  // Open PR checks in priority order (when not merge-ready)
  if (pr.review_status === 'changes_requested') return 'changes-requested'
  if (hasMergeConflicts(pr)) return 'merge-conflict'
  if ((pr.unaddressed_comment_count ?? 0) > 0) return 'unaddressed-comments'
  if (pr.draft) return 'pr-draft'
  if (pr.ci_status === 'pending') return 'ci-running'
  if (pr.ci_status === 'success' && pr.review_status === 'review_required') return 'review-pending'
  return 'pr-open'
}

const BORDER_CLASS: Record<string, string> = {
  'active': 'running',
  'needs-input': 'needs-input',
  'paused': 'paused',
  'agent-done': 'completed',
  'failed': 'failed',
  'interrupted': 'interrupted',
  'ci-failed': 'ci-failed',
  'ci-running': 'ci-running',
  'review-pending': 'review-pending',
  'unaddressed-comments': 'unaddressed-comments',
  'ready-to-merge': 'ready-to-merge',
  'pr-queued': 'ready-to-merge',
  'merge-conflict': 'ci-failed',
}

export function taskStateToBorderClass(state: TaskState): string {
  return BORDER_CLASS[state] ?? ''
}

export function computeTaskState(task: Task, session: AgentSession | null, prs: PullRequestInfo[]): TaskState {
  // Done tasks are always done
  if (task.status === 'done') {
    return 'done'
  }

  // Backlog tasks are always eggs
  if (task.status === 'backlog') {
    return 'egg'
  }

  // Doing tasks map to various states based on session
  if (task.status === 'doing') {
    if (session !== null) {
      switch (session.status) {
        case 'running':
          return 'active'
        case 'paused':
          return session.checkpoint_data !== null ? 'needs-input' : 'paused'
        case 'failed':
          return 'failed'
        case 'interrupted':
          return 'interrupted'
        case 'completed':
          // Fall through to PR checks below
          break
        default:
          // Unknown session status — check PRs before falling back to idle
          break
      }
    }

    // PR-based states (after session-completed or no session)
    const prState = getPrState(prs)
    if (prState) return prState

    // Session completed with no PR context
    if (session?.status === 'completed') return 'agent-done'

    // No session, no PR
    return 'idle'
  }

  // Fallback for any other task status
  return 'idle'
}
