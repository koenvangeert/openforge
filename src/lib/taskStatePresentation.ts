import { getStateDrivingPr } from './taskState'
import type { TaskState } from './taskState'
import type { PullRequestInfo } from './types'

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  egg: 'Backlog',
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

export const TASK_STATE_COMPACT_LABELS: Record<TaskState, string> = {
  egg: 'Backlog',
  idle: 'Idle',
  active: 'Active',
  'needs-input': 'Needs Input',
  'paused': 'Paused',
  'agent-done': 'Done',
  'failed': 'Failed',
  'interrupted': 'Stopped',
  done: 'Done',
  'pr-draft': 'PR Draft',
  'pr-open': 'PR Open',
  'ci-running': 'CI Running',
  'review-pending': 'Review Pending',
  'ci-failed': 'CI Failed',
  'changes-requested': 'Changes Req.',
  'unaddressed-comments': 'Unaddressed Comments',
  'ready-to-merge': 'Ready to Merge',
  'pr-queued': 'Queued',
  'pr-merged': 'Merged',
  'merge-conflict': 'Merge Conflict',
}

export interface TaskListItemPresentation {
  stateLabel: string
  reasonText: string
}

export function getTaskListItemPresentation(
  state: TaskState,
  reasonText: string,
  isMerging: boolean,
): TaskListItemPresentation {
  if (isMerging) {
    return {
      stateLabel: 'Merging...',
      reasonText: 'Pull request merge is in progress.',
    }
  }

  return {
    stateLabel: TASK_STATE_COMPACT_LABELS[state] ?? state,
    reasonText,
  }
}

export function getTaskStateBadgeClass(state: TaskState): string {
  switch (state) {
    case 'active': return 'badge-success'
    case 'needs-input': return 'badge-warning'
    case 'unaddressed-comments': return 'badge-warning'
    case 'ci-failed':
    case 'failed':
    case 'changes-requested':
    case 'merge-conflict': return 'badge-error'
    case 'agent-done': return 'badge-success'
    case 'ready-to-merge': return 'badge-info'
    case 'pr-queued': return 'badge-info'
    case 'egg': return 'badge-ghost'
    default: return ''
  }
}

const STATE_REASONS: Record<TaskState, string> = {
  'egg': 'In backlog — not started yet.',
  'idle': 'No agent running. Start when ready.',
  'active': 'Agent is running — no action needed right now.',
  'needs-input': 'Agent needs your input to continue.',
  'paused': 'Agent paused.',
  'agent-done': 'Agent completed — review the changes.',
  'failed': 'Agent failed — check the error log.',
  'interrupted': 'Agent was interrupted.',
  'done': 'Completed.',
  'pr-draft': 'Pull request is a draft.',
  'pr-open': 'Pull request is open — awaiting review.',
  'ci-running': 'CI pipeline is running.',
  'review-pending': 'Waiting on code review.',
  'ci-failed': 'CI pipeline failed — check the logs.',
  'changes-requested': 'Changes requested on the pull request.',
  'unaddressed-comments': 'Unaddressed comments on the pull request.',
  'ready-to-merge': 'Ready to merge — all checks passed.',
  'pr-queued': 'Pull request is queued for merge.',
  'pr-merged': 'Pull request merged.',
  'merge-conflict': 'Pull request has merge conflicts that must be resolved.',
}

export function getTaskReasonText(
  state: TaskState,
  prs: PullRequestInfo[]
): string {
  const baseReason = STATE_REASONS[state] ?? `Status: ${state}`

  const drivingPr = getStateDrivingPr(prs)
  const drivingPrUnaddressed = drivingPr?.unaddressed_comment_count ?? 0

  if (state === 'unaddressed-comments' && drivingPrUnaddressed > 0) {
    return `${drivingPrUnaddressed} unaddressed comment(s) on the pull request.`
  }

  return baseReason
}
