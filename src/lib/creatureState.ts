import type { Task, AgentSession, PullRequestInfo } from './types'

export type CreatureState =
  | 'egg' | 'idle' | 'active' | 'needs-input' | 'resting' | 'celebrating' | 'sad' | 'frozen' | 'done'
  | 'pr-draft' | 'pr-open' | 'ci-failed' | 'changes-requested' | 'ready-to-merge' | 'pr-merged'

export type CreatureRoom = 'forge' | 'warRoom' | 'nursery'

function getPrState(prs: PullRequestInfo[]): CreatureState | null {
  // Find the most relevant PR: prefer open, then merged, then closed
  const openPr = prs.find(pr => pr.state === 'open')
  const mergedPr = prs.find(pr => pr.state === 'merged')
  const pr = openPr ?? mergedPr

  if (!pr) return null

  if (pr.state === 'merged') return 'pr-merged'

  // Open PR checks in priority order
  if (pr.ci_status === 'failure') return 'ci-failed'
  if (pr.review_status === 'changes_requested') return 'changes-requested'
  if (pr.ci_status === 'success' && pr.review_status === 'approved') return 'ready-to-merge'
  if (pr.draft) return 'pr-draft'
  return 'pr-open'
}

export function computeCreatureState(task: Task, session: AgentSession | null, prs: PullRequestInfo[]): CreatureState {
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
          return session.checkpoint_data !== null ? 'needs-input' : 'resting'
        case 'failed':
          return 'sad'
        case 'interrupted':
          return 'frozen'
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
    if (session?.status === 'completed') return 'celebrating'

    // No session, no PR
    return 'idle'
  }

  // Fallback for any other task status
  return 'idle'
}

export function computeCreatureRoom(task: Task, session: AgentSession | null, prs: PullRequestInfo[]): CreatureRoom {
  const state = computeCreatureState(task, session, prs)

  if (task.status === 'backlog') return 'nursery'
  if (state === 'ci-failed' || state === 'changes-requested') return 'warRoom'
  if (state === 'needs-input' || state === 'resting' || state === 'sad' || state === 'frozen') return 'warRoom'
  return 'forge'
}
