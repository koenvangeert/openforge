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
  const {
    mergeable = null,
    mergeable_state = null,
    ...restOverrides
  } = overrides

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
    mergeable,
    mergeable_state,
    merged_at: null,
    created_at: 1000,
    updated_at: 2000,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    ...restOverrides,
  }
}

// ============================================================================
// PART 1: Tests for existing getPrState() behavior
// ============================================================================

describe('computeTaskState - getPrState behavior (PART 1)', () => {
  describe('PR state detection', () => {
    it('test 1: no PRs with completed session → agent-done', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs: PullRequestInfo[] = []

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('agent-done')
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
          mergeable_state: 'clean',
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

    it('test 9: closed PR (not merged) → falls to agent-done', () => {
      const task = createTask({ status: 'doing' })
      const session = createSession({ status: 'completed' })
      const prs = [createPr({ state: 'closed' })]

      const state = computeTaskState(task, session, prs)
      expect(state).toBe('agent-done')
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
        mergeable_state: 'clean',
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
        mergeable_state: 'clean',
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
        mergeable_state: 'clean',
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

  it('maps paused to paused', () => {
    expect(taskStateToBorderClass('paused')).toBe('paused')
  })

  it('maps agent-done to completed', () => {
    expect(taskStateToBorderClass('agent-done')).toBe('completed')
  })

  it('maps failed to failed', () => {
    expect(taskStateToBorderClass('failed')).toBe('failed')
  })

  it('maps interrupted to interrupted', () => {
    expect(taskStateToBorderClass('interrupted')).toBe('interrupted')
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

  it('maps merge-conflict to ci-failed', () => {
    expect(taskStateToBorderClass('merge-conflict')).toBe('ci-failed')
  })

  it('maps unaddressed-comments to unaddressed-comments', () => {
    expect(taskStateToBorderClass('unaddressed-comments' as any)).toBe('unaddressed-comments')
  })
})

describe('computeTaskState - unaddressed-comments (PART 5)', () => {
  it('test 1: open PR with unaddressed comments → unaddressed-comments', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', unaddressed_comment_count: 2 })]

    const state = computeTaskState(task, session, prs)
    expect(state).toBe('unaddressed-comments')
  })

  it('test 2: ci-failed takes priority over unaddressed-comments', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', ci_status: 'failure', unaddressed_comment_count: 2 })]

    const state = computeTaskState(task, session, prs)
    expect(state).toBe('ci-failed')
  })

  it('test 3: changes-requested takes priority over unaddressed-comments', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', review_status: 'changes_requested', unaddressed_comment_count: 2 })]

    const state = computeTaskState(task, session, prs)
    expect(state).toBe('changes-requested')
  })

  it('test 4: ready-to-merge takes priority over unaddressed-comments', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', ci_status: 'success', review_status: 'approved', mergeable_state: 'clean', unaddressed_comment_count: 2 })]

    const state = computeTaskState(task, session, prs)
    expect(state).toBe('ready-to-merge')
  })

  it('test 5: unaddressed-comments takes priority over pr-draft', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', draft: true, unaddressed_comment_count: 2 })]

    const state = computeTaskState(task, session, prs)
    expect(state).toBe('unaddressed-comments')
  })

  it('test 6: unaddressed-comments takes priority over ci-running', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', ci_status: 'pending', unaddressed_comment_count: 2 })]

    const state = computeTaskState(task, session, prs)
    expect(state).toBe('unaddressed-comments')
  })

  it('test 7: zero unaddressed comments does not trigger state', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', unaddressed_comment_count: 0 })]

    const state = computeTaskState(task, session, prs)
    expect(state).toBe('pr-open')
  })
})

// ============================================================================
// PART 5: mergeable_state-based ready-to-merge (new behavior)
// ============================================================================

describe('computeTaskState - mergeable_state based ready-to-merge (PART 5)', () => {
  it('test 1: mergeable_state clean → ready-to-merge (without ci_status/review_status)', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'clean' })]
    expect(computeTaskState(task, session, prs)).toBe('ready-to-merge')
  })

  it('test 2: mergeable_state unstable + ci failing → ci-failed', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'unstable', ci_status: 'failure' })]
    expect(computeTaskState(task, session, prs)).toBe('ci-failed')
  })

  it('test 3: mergeable_state clean + is_queued → pr-queued', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'clean', is_queued: true })]
    expect(computeTaskState(task, session, prs)).toBe('pr-queued')
  })

  it('test 4: mergeable_state unstable + ci failing + is_queued → ci-failed (queued does not override CI failure)', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'unstable', ci_status: 'failure', is_queued: true })]
    expect(computeTaskState(task, session, prs)).toBe('ci-failed')
  })

  it('test 5: mergeable_state clean with ci_status failure → ci-failed (CI failure always takes priority)', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'clean', ci_status: 'failure' })]
    expect(computeTaskState(task, session, prs)).toBe('ci-failed')
  })

  it('test 15: mergeable_state clean with ci_status pending → ci-running (pending CI blocks merge readiness)', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'clean', ci_status: 'pending' })]
    expect(computeTaskState(task, session, prs)).toBe('ci-running')
  })

  it('test 6: ISOLATION — mergeable_state clean with review_status review_required → ready-to-merge (trusts GitHub)', () => {
    // review_required with mergeable_state clean = review not needed per branch protection
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'clean', review_status: 'review_required' })]
    expect(computeTaskState(task, session, prs)).toBe('ready-to-merge')
  })

  it('test 7: mergeable_state null — old ci+review conditions NO LONGER trigger ready-to-merge', () => {
    // This proves the old "ci_status: success + review_status: approved" is no longer sufficient
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: null, ci_status: 'success', review_status: 'approved' })]
    expect(computeTaskState(task, session, prs)).not.toBe('ready-to-merge')
  })

  it('test 8: mergeable_state blocked — ci-failed when ci failing', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'blocked', ci_status: 'failure' })]
    expect(computeTaskState(task, session, prs)).toBe('ci-failed')
  })

  it('test 9: mergeable_state blocked — changes-requested when review says so', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'blocked', review_status: 'changes_requested' })]
    expect(computeTaskState(task, session, prs)).toBe('changes-requested')
  })

  it('test 10: mergeable_state unknown → falls to pr-open (conservative)', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'unknown' })]
    expect(computeTaskState(task, session, prs)).toBe('pr-open')
  })

  it('test 11: mergeable_state dirty → falls to intermediate states (ci-failed if failing)', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'dirty', ci_status: 'failure' })]
    expect(computeTaskState(task, session, prs)).toBe('ci-failed')
  })

  it('test 12: UPPERCASE mergeable_state CLEAN is handled (case normalization)', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'CLEAN' })]
    expect(computeTaskState(task, session, prs)).toBe('ready-to-merge')
  })

  it('test 13: mergeable_state behind → ready-to-merge (branch out of date but not blocked)', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'behind' })]
    expect(computeTaskState(task, session, prs)).toBe('ready-to-merge')
  })

  it('test 14: mergeable_state behind + is_queued → pr-queued', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'behind', is_queued: true })]
    expect(computeTaskState(task, session, prs)).toBe('pr-queued')
  })
})

// ============================================================================
// PART 6: merge conflicts
// ============================================================================

describe('computeTaskState - merge-conflict (PART 6)', () => {
  it('test 1: mergeable_state dirty → merge-conflict', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'dirty' })]
    expect(computeTaskState(task, session, prs)).toBe('merge-conflict')
  })

  it('test 2: mergeable_state conflicting → merge-conflict', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'conflicting' })]
    expect(computeTaskState(task, session, prs)).toBe('merge-conflict')
  })

  it('test 3: ci-failed takes priority over merge-conflict', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'dirty', ci_status: 'failure' })]
    expect(computeTaskState(task, session, prs)).toBe('ci-failed')
  })

  it('test 4: changes-requested takes priority over merge-conflict', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'dirty', review_status: 'changes_requested' })]
    expect(computeTaskState(task, session, prs)).toBe('changes-requested')
  })

  it('test 5: merge-conflict takes priority over unaddressed-comments', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'open', mergeable_state: 'dirty', unaddressed_comment_count: 2 })]
    expect(computeTaskState(task, session, prs)).toBe('merge-conflict')
  })

  it('test 6: closed PR with dirty state does not trigger merge-conflict', () => {
    const task = createTask({ status: 'doing' })
    const session = createSession({ status: 'completed' })
    const prs = [createPr({ state: 'closed', mergeable_state: 'dirty' })]
    expect(computeTaskState(task, session, prs)).toBe('agent-done') // fallback since no open PR
  })
})
