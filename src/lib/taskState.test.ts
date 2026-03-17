import { describe, it, expect } from 'vitest'
import type { Task, AgentSession, PullRequestInfo } from './types'
import { computeTaskState, taskStateToBorderClass } from './taskState'

// ============================================================================
// Factory Helpers
// ============================================================================

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    initial_prompt: 'Test task',
    status: 'doing',
    jira_key: null,
    jira_title: null,
    jira_status: null,
    jira_assignee: null,
    jira_description: null,
    prompt: null,
    summary: null,
    agent: null,
    permission_mode: null,
    project_id: null,
    created_at: 1000,
    updated_at: 2000,
    ...overrides,
  }
}

function createSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'session-1',
    ticket_id: 'task-1',
    opencode_session_id: null,
    stage: 'implementation',
    status: 'completed',
    checkpoint_data: null,
    error_message: null,
    created_at: 1000,
    updated_at: 2000,
    provider: 'claude-code',
    claude_session_id: null,
    ...overrides,
  }
}

function createPr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 1,
    ticket_id: 'task-1',
    repo_owner: 'test',
    repo_name: 'repo',
    title: 'Test PR',
    url: 'https://github.com/test/repo/pull/1',
    state: 'open',
    head_sha: 'abc123',
    ci_status: null,
    ci_check_runs: null,
    review_status: null,
    merged_at: null,
    created_at: 1000,
    updated_at: 2000,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    ...overrides,
  }
}

// ============================================================================
// PART 1: Tests for existing getPrState() behavior
// ============================================================================

describe('computeTaskState - getPrState behavior (PART 1)', () => {
  describe('PR state detection', () => {
    it('test 1: no PRs with completed session → celebrating', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs: PullRequestInfo[] = []

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('celebrating')
    })

    it('test 2: merged PR → pr-merged', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs = [createPr({ state: 'merged', merged_at: 3000 })]

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('pr-merged')
    })

    it('test 3: open PR with CI failure → ci-failed', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs = [createPr({ state: 'open', ci_status: 'failure' })]

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('ci-failed')
    })

    it('test 4: open PR with changes requested → changes-requested', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs = [createPr({ state: 'open', review_status: 'changes_requested' })]

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('changes-requested')
    })

    it('test 5: open PR with CI success and approved → ready-to-merge', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs = [
        createPr({
          state: 'open',
          ci_status: 'success',
          review_status: 'approved',
        }),
      ]

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('ready-to-merge')
    })

    it('test 6: open PR in draft → pr-draft', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs = [createPr({ state: 'open', draft: true })]

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('pr-draft')
    })

    it('test 7: open PR with no special conditions → pr-open', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs = [createPr({ state: 'open' })]

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('pr-open')
    })

    it('test 8: CI failure takes priority over changes_requested', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs = [
        createPr({
          state: 'open',
          ci_status: 'failure',
          review_status: 'changes_requested',
        }),
      ]

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('ci-failed')
    })

    it('test 9: closed PR (not merged) → falls to celebrating', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs = [createPr({ state: 'closed' })]

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('celebrating')
    })

    it('test 10: prefers open PR over merged PR when both exist', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs = [
        createPr({ state: 'merged', merged_at: 3000 }),
        createPr({ state: 'open', id: 2 }),
      ]

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('pr-open')
    })
  })
})

// ============================================================================
// PART 2: Failing tests for ci-running and review-pending (RED phase)
// ============================================================================

describe('computeTaskState - ci-running and review-pending (PART 2 - EXPECTED FAILURES)', () => {
  describe('New PR states (not yet implemented)', () => {
    it('test 1: open PR with pending CI → ci-running (WILL FAIL)', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs = [createPr({ state: 'open', ci_status: 'pending', draft: false })]

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('ci-running')
    })

    it('test 2: open PR with CI success and review_required → review-pending (WILL FAIL)', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs = [
        createPr({
          state: 'open',
          ci_status: 'success',
          review_status: 'review_required',
        }),
      ]

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('review-pending')
    })

    it('test 3: pending CI with changes_requested → changes-requested (should PASS)', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs = [
        createPr({
          state: 'open',
          ci_status: 'pending',
          review_status: 'changes_requested',
        }),
      ]

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('changes-requested')
    })

    it('test 4: pending CI with draft → pr-draft (should PASS)', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs = [createPr({ state: 'open', ci_status: 'pending', draft: true })]

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('pr-draft')
    })

    it('test 5: CI success with review_status none → pr-open (should PASS)', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs = [
        createPr({
          state: 'open',
          ci_status: 'success',
          review_status: 'none',
        }),
      ]

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('pr-open')
    })
  })
})

// ============================================================================
// PART 3: Tests for pr-queued (merge queue support)
// ============================================================================

describe('computeTaskState - pr-queued (PART 3)', () => {
  it('test 1: open PR with CI success + approved + is_queued → pr-queued', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [
      createPr({
        state: 'open',
        ci_status: 'success',
        review_status: 'approved',
        is_queued: true,
      }),
    ]

    const state = computeTaskState(task, session, prs)
    expect(state).toBe('pr-queued')
  })

  it('test 2: open PR with CI success + approved + NOT is_queued → ready-to-merge', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [
      createPr({
        state: 'open',
        ci_status: 'success',
        review_status: 'approved',
        is_queued: false,
      }),
    ]

    const state = computeTaskState(task, session, prs)
    expect(state).toBe('ready-to-merge')
  })

  it('test 3: CI failure takes priority over is_queued → ci-failed', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [
      createPr({
        state: 'open',
        ci_status: 'failure',
        review_status: 'approved',
        is_queued: true,
      }),
    ]

    const state = computeTaskState(task, session, prs)
    expect(state).toBe('ci-failed')
  })

  it('test 4: changes_requested takes priority over is_queued → changes-requested', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [
      createPr({
        state: 'open',
        ci_status: 'success',
        review_status: 'changes_requested',
        is_queued: true,
      }),
    ]

    const state = computeTaskState(task, session, prs)
    expect(state).toBe('changes-requested')
  })

  it('test 5: is_queued with no session → pr-queued', () => {
    const task = createTask({ status: 'doing' })
    const prs = [
      createPr({
        state: 'open',
        ci_status: 'success',
        review_status: 'approved',
        is_queued: true,
      }),
    ]

    const state = computeTaskState(task, null, prs)
    expect(state).toBe('pr-queued')
  })
})

// ============================================================================
// PART 4: taskStateToBorderClass mapping
// ============================================================================

describe('taskStateToBorderClass', () => {
  it('maps active to running', () => {
    expect(taskStateToBorderClass('active')).toBe('running')
  })

  it('maps needs-input to needs-input', () => {
    expect(taskStateToBorderClass('needs-input')).toBe('needs-input')
  })

  it('maps resting to paused', () => {
    expect(taskStateToBorderClass('resting')).toBe('paused')
  })

  it('maps celebrating to completed', () => {
    expect(taskStateToBorderClass('celebrating')).toBe('completed')
  })

  it('maps sad to failed', () => {
    expect(taskStateToBorderClass('sad')).toBe('failed')
  })

  it('maps frozen to interrupted', () => {
    expect(taskStateToBorderClass('frozen')).toBe('interrupted')
  })

  it('maps ci-failed to ci-failed', () => {
    expect(taskStateToBorderClass('ci-failed')).toBe('ci-failed')
  })

  it('maps ci-running to ci-running', () => {
    expect(taskStateToBorderClass('ci-running')).toBe('ci-running')
  })

  it('maps review-pending to review-pending', () => {
    expect(taskStateToBorderClass('review-pending')).toBe('review-pending')
  })

  it('maps ready-to-merge to ready-to-merge', () => {
    expect(taskStateToBorderClass('ready-to-merge')).toBe('ready-to-merge')
  })

  it('maps pr-queued to ready-to-merge', () => {
    expect(taskStateToBorderClass('pr-queued')).toBe('ready-to-merge')
  })

  it('returns empty string for egg', () => {
    expect(taskStateToBorderClass('egg')).toBe('')
  })

  it('returns empty string for idle', () => {
    expect(taskStateToBorderClass('idle')).toBe('')
  })

  it('returns empty string for done', () => {
    expect(taskStateToBorderClass('done')).toBe('')
  })

  it('returns empty string for pr-draft', () => {
    expect(taskStateToBorderClass('pr-draft')).toBe('')
  })

  it('returns empty string for pr-open', () => {
    expect(taskStateToBorderClass('pr-open')).toBe('')
  })

  it('returns empty string for pr-merged', () => {
    expect(taskStateToBorderClass('pr-merged')).toBe('')
  })

  it('returns empty string for changes-requested', () => {
    expect(taskStateToBorderClass('changes-requested')).toBe('')
  })
})
