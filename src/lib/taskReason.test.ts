import { describe, it, expect } from 'vitest'
import type { Task, AgentSession, PullRequestInfo } from './types'
import { getTaskReasonText } from './taskReason'

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    initial_prompt: overrides.id,
    status: 'doing',
    prompt: null,
    summary: null,
    agent: null,
    permission_mode: null,
    project_id: null,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

function makeSession(overrides: Partial<AgentSession> & { id: string }): AgentSession {
  return {
    ticket_id: 'T-1',
    opencode_session_id: null,
    stage: 'implement',
    status: 'running',
    checkpoint_data: null,
    error_message: null,
    created_at: 1000,
    updated_at: 1000,
    provider: 'claude-code',
    claude_session_id: null,
    ...overrides,
  }
}

function makePr(overrides: Partial<PullRequestInfo> & { id: number }): PullRequestInfo {
  return {
    ticket_id: 'T-1',
    repo_owner: 'test',
    repo_name: 'repo',
    title: 'Test PR',
    url: 'https://github.com/test/repo/pull/1',
    state: 'open',
    head_sha: 'abc123',
    ci_status: null,
    ci_check_runs: null,
    review_status: null,
    mergeable: null,
    mergeable_state: null,
    merged_at: null,
    created_at: 1000,
    updated_at: 1000,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    ...overrides,
  }
}

describe('getTaskReasonText', () => {
  describe('TaskState mappings', () => {
    it('returns "In backlog — not started yet." for egg state', () => {
      const task = makeTask({ id: 'T-1', status: 'backlog' })
      const reason = getTaskReasonText(task, 'egg', null, [])
      expect(reason).toBe('In backlog — not started yet.')
    })

    it('returns "No agent running. Start when ready." for idle state', () => {
      const task = makeTask({ id: 'T-1' })
      const reason = getTaskReasonText(task, 'idle', null, [])
      expect(reason).toBe('No agent running. Start when ready.')
    })

    it('returns "Agent is running — no action needed right now." for active state', () => {
      const task = makeTask({ id: 'T-1' })
      const session = makeSession({ id: 's-1', status: 'running' })
      const reason = getTaskReasonText(task, 'active', session, [])
      expect(reason).toBe('Agent is running — no action needed right now.')
    })

    it('returns "Agent needs your input to continue." for needs-input state', () => {
      const task = makeTask({ id: 'T-1' })
      const session = makeSession({ id: 's-1', status: 'paused', checkpoint_data: '{"question":"help?"}' })
      const reason = getTaskReasonText(task, 'needs-input', session, [])
      expect(reason).toBe('Agent needs your input to continue.')
    })

    it('returns "Agent paused." for paused state', () => {
      const task = makeTask({ id: 'T-1' })
      const session = makeSession({ id: 's-1', status: 'paused', checkpoint_data: null })
      const reason = getTaskReasonText(task, 'paused', session, [])
      expect(reason).toBe('Agent paused.')
    })

    it('returns "Agent completed — review the changes." for agent-done state', () => {
      const task = makeTask({ id: 'T-1' })
      const session = makeSession({ id: 's-1', status: 'completed' })
      const reason = getTaskReasonText(task, 'agent-done', session, [])
      expect(reason).toBe('Agent completed — review the changes.')
    })

    it('returns "Agent failed — check the error log." for failed state', () => {
      const task = makeTask({ id: 'T-1' })
      const session = makeSession({ id: 's-1', status: 'failed' })
      const reason = getTaskReasonText(task, 'failed', session, [])
      expect(reason).toBe('Agent failed — check the error log.')
    })

    it('returns "Agent was interrupted." for interrupted state', () => {
      const task = makeTask({ id: 'T-1' })
      const session = makeSession({ id: 's-1', status: 'interrupted' })
      const reason = getTaskReasonText(task, 'interrupted', session, [])
      expect(reason).toBe('Agent was interrupted.')
    })

    it('returns "Completed." for done state', () => {
      const task = makeTask({ id: 'T-1', status: 'done' })
      const reason = getTaskReasonText(task, 'done', null, [])
      expect(reason).toBe('Completed.')
    })

    it('returns "Pull request is a draft." for pr-draft state', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1, draft: true })
      const reason = getTaskReasonText(task, 'pr-draft', null, [pr])
      expect(reason).toBe('Pull request is a draft.')
    })

    it('returns "Pull request is open — awaiting review." for pr-open state', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1, state: 'open' })
      const reason = getTaskReasonText(task, 'pr-open', null, [pr])
      expect(reason).toBe('Pull request is open — awaiting review.')
    })

    it('returns "CI pipeline is running." for ci-running state', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1, ci_status: 'pending' })
      const reason = getTaskReasonText(task, 'ci-running', null, [pr])
      expect(reason).toBe('CI pipeline is running.')
    })

    it('returns "Waiting on code review." for review-pending state', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1, review_status: 'review_required' })
      const reason = getTaskReasonText(task, 'review-pending', null, [pr])
      expect(reason).toBe('Waiting on code review.')
    })

    it('returns "CI pipeline failed — check the logs." for ci-failed state', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1, ci_status: 'failure' })
      const reason = getTaskReasonText(task, 'ci-failed', null, [pr])
      expect(reason).toBe('CI pipeline failed — check the logs.')
    })

    it('returns "Changes requested on the pull request." for changes-requested state', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1, review_status: 'changes_requested' })
      const reason = getTaskReasonText(task, 'changes-requested', null, [pr])
      expect(reason).toBe('Changes requested on the pull request.')
    })

    it('returns "Ready to merge — all checks passed." for ready-to-merge state', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1, ci_status: 'success', review_status: 'approved' })
      const reason = getTaskReasonText(task, 'ready-to-merge', null, [pr])
      expect(reason).toBe('Ready to merge — all checks passed.')
    })

    it('returns "Pull request is queued for merge." for pr-queued state', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1, is_queued: true })
      const reason = getTaskReasonText(task, 'pr-queued', null, [pr])
      expect(reason).toBe('Pull request is queued for merge.')
    })

    it('returns "Pull request merged." for pr-merged state', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1, state: 'merged' })
      const reason = getTaskReasonText(task, 'pr-merged', null, [pr])
      expect(reason).toBe('Pull request merged.')
    })

    it('returns "Pull request has merge conflicts that must be resolved." for merge-conflict state', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1, mergeable_state: 'dirty' })
      const reason = getTaskReasonText(task, 'merge-conflict', null, [pr])
      expect(reason).toBe('Pull request has merge conflicts that must be resolved.')
    })
  })

  describe('Unaddressed comments prepending', () => {
    it('prepends single unaddressed comment count', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1, unaddressed_comment_count: 1 })
      const reason = getTaskReasonText(task, 'pr-open', null, [pr])
      expect(reason).toBe('1 unaddressed comment(s) need attention. Pull request is open — awaiting review.')
    })

    it('prepends multiple unaddressed comment count', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1, unaddressed_comment_count: 3 })
      const reason = getTaskReasonText(task, 'pr-open', null, [pr])
      expect(reason).toBe('3 unaddressed comment(s) need attention. Pull request is open — awaiting review.')
    })

    it('sums unaddressed comments across multiple PRs', () => {
      const task = makeTask({ id: 'T-1' })
      const pr1 = makePr({ id: 1, unaddressed_comment_count: 2 })
      const pr2 = makePr({ id: 2, unaddressed_comment_count: 3 })
      const reason = getTaskReasonText(task, 'pr-open', null, [pr1, pr2])
      expect(reason).toBe('5 unaddressed comment(s) need attention. Pull request is open — awaiting review.')
    })

    it('does not prepend when unaddressed_comment_count is 0', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1, unaddressed_comment_count: 0 })
      const reason = getTaskReasonText(task, 'pr-open', null, [pr])
      expect(reason).toBe('Pull request is open — awaiting review.')
    })

    it('handles undefined unaddressed_comment_count as 0', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1 })
      delete (pr as any).unaddressed_comment_count
      const reason = getTaskReasonText(task, 'pr-open', null, [pr])
      expect(reason).toBe('Pull request is open — awaiting review.')
    })

    it('prepends unaddressed comments even for non-PR states', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1, unaddressed_comment_count: 2 })
      const reason = getTaskReasonText(task, 'idle', null, [pr])
      expect(reason).toBe('2 unaddressed comment(s) need attention. No agent running. Start when ready.')
    })
  })

  describe('Fallback behavior', () => {
    it('returns fallback for unknown state', () => {
      const task = makeTask({ id: 'T-1' })
      const reason = getTaskReasonText(task, 'unknown-state' as any, null, [])
      expect(reason).toBe('Status: unknown-state')
    })
  })

  describe('getTaskReasonText - unaddressed-comments state', () => {
    it('returns reason text for unaddressed-comments state with no PRs', () => {
      const task = makeTask({ id: 'T-1' })
      const reason = getTaskReasonText(task, 'unaddressed-comments' as any, null, [])
      expect(reason).toBeTruthy()
      expect(typeof reason).toBe('string')
      expect(reason).not.toBe('Status: unaddressed-comments')
    })

    it('does not double-count when state is unaddressed-comments and PR has comments', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1, unaddressed_comment_count: 3 })
      const reason = getTaskReasonText(task, 'unaddressed-comments' as any, null, [pr])
      const countMatches = (reason.match(/3/g) ?? []).length
      expect(countMatches).toBeLessThanOrEqual(1)
    })

    it('still prepends unaddressed count for non-unaddressed-comments state (combo case)', () => {
      const task = makeTask({ id: 'T-1' })
      const pr = makePr({ id: 1, unaddressed_comment_count: 3 })
      const reason = getTaskReasonText(task, 'ci-failed', null, [pr])
      expect(reason).toContain('3 unaddressed comment(s)')
      expect(reason).toContain('CI pipeline failed')
    })
  })
})
