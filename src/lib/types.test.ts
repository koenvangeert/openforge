import { describe, expect, it } from 'vitest'
import { type PullRequestInfo, type CheckRunInfo, hasMergeConflicts, isReadyToMerge, isQueuedForMerge, splitCheckRuns } from './types'

function createPullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 1,
    ticket_id: 'T-1',
    repo_owner: 'acme',
    repo_name: 'repo',
    title: 'Test PR',
    url: 'https://github.com/acme/repo/pull/1',
    state: 'open',
    head_sha: 'abc123',
    ci_status: 'success',
    ci_check_runs: null,
    review_status: 'approved',
    mergeable: true,
    mergeable_state: 'clean',
    merged_at: null,
    created_at: 1000,
    updated_at: 2000,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    ...overrides,
  }
}

describe('pull request merge conflict helpers', () => {
  it('detects conflicts from a dirty mergeable_state', () => {
    expect(hasMergeConflicts({ state: 'open', mergeable: false, mergeable_state: 'dirty' })).toBe(true)
  })

  it('does not treat unknown mergeability as a conflict', () => {
    expect(hasMergeConflicts({ state: 'open', mergeable: null, mergeable_state: 'unknown' })).toBe(false)
  })

  it('does not report conflicts for closed pull requests', () => {
    expect(hasMergeConflicts({ state: 'closed', mergeable: false, mergeable_state: 'dirty' })).toBe(false)
  })

  it('does not consider a conflicted PR ready to merge', () => {
    expect(
      isReadyToMerge({
        id: 1,
        ticket_id: 'T-1',
        repo_owner: 'acme',
        repo_name: 'repo',
        title: 'Conflicted PR',
        url: 'https://github.com/acme/repo/pull/1',
        state: 'open',
        head_sha: 'abc123',
        ci_status: 'success',
        ci_check_runs: null,
        review_status: 'approved',
        mergeable: false,
        mergeable_state: 'dirty',
        merged_at: null,
        created_at: 1000,
        updated_at: 2000,
        draft: false,
        is_queued: false,
        unaddressed_comment_count: 0,
      }),
    ).toBe(false)
  })

  it('considers a PR ready to merge if approved and mergeable', () => {
    expect(isReadyToMerge(createPullRequest())).toBe(true)
  })

  it('considers a PR ready to merge if no review required and mergeable', () => {
    expect(isReadyToMerge(createPullRequest({ review_status: 'none' }))).toBe(true)
  })

  it('considers a PR ready to merge if GitHub reports mergeable even when review is still required', () => {
    expect(isReadyToMerge(createPullRequest({ review_status: 'review_required' }))).toBe(true)
  })

  it('does not consider a PR ready to merge if mergeable is null or false, even without conflicts', () => {
    expect(isReadyToMerge(createPullRequest({ mergeable: null, mergeable_state: 'unknown' }))).toBe(false)
  })

  // ISOLATION: mergeable_state: 'clean' WITHOUT ci_status: 'success' — currently FAILS
  it('considers a PR ready to merge based on clean mergeable_state regardless of ci_status', () => {
    expect(isReadyToMerge(createPullRequest({ ci_status: 'failure', mergeable_state: 'clean' }))).toBe(true)
  })

  // ISOLATION: mergeable_state: 'unstable' — CI is failing
  it('does not consider a PR with unstable mergeable_state ready to merge (CI is failing)', () => {
    expect(isReadyToMerge(createPullRequest({ mergeable_state: 'unstable' }))).toBe(false)
  })

  // ISOLATION: mergeable_state: 'clean' with mergeable: false — currently FAILS
  it('considers a PR ready to merge based on mergeable_state even when mergeable boolean is false', () => {
    expect(isReadyToMerge(createPullRequest({ mergeable: false, mergeable_state: 'clean' }))).toBe(true)
  })

  // CASE NORMALIZATION: uppercase — currently FAILS (string comparison will fail)
  it('handles uppercase mergeable_state values for clean', () => {
    expect(isReadyToMerge(createPullRequest({ mergeable_state: 'CLEAN' }))).toBe(true)
  })

  it('does not consider PR with uppercase UNSTABLE ready to merge', () => {
    expect(isReadyToMerge(createPullRequest({ mergeable_state: 'UNSTABLE' }))).toBe(false)
  })

  // NOT READY cases — explicit documentation
  it('does not consider a PR ready to merge if mergeable_state is blocked', () => {
    expect(isReadyToMerge(createPullRequest({ mergeable_state: 'blocked', ci_status: 'success' }))).toBe(false)
  })

  it('considers a PR ready to merge if mergeable_state is behind (branch out of date but not blocked)', () => {
    expect(isReadyToMerge(createPullRequest({ mergeable_state: 'behind', ci_status: 'success' }))).toBe(true)
  })

  it('does not consider a PR ready to merge if mergeable_state is null', () => {
    expect(isReadyToMerge(createPullRequest({ mergeable_state: null, ci_status: 'success' }))).toBe(false)
  })

  it('does not consider a closed PR ready to merge even if mergeable_state is clean', () => {
    expect(isReadyToMerge(createPullRequest({ state: 'closed', mergeable_state: 'clean' }))).toBe(false)
  })
})

describe('isQueuedForMerge', () => {
  it('returns true when state is open and is_queued is true with mergeable null', () => {
    const pr = createPullRequest({ state: 'open', is_queued: true, mergeable: null, mergeable_state: null })
    expect(isQueuedForMerge(pr)).toBe(true)
  })

  it('returns true when state is open and is_queued is true even if mergeable is false (PR queued despite conflicts)', () => {
    const pr = createPullRequest({ state: 'open', is_queued: true, mergeable: false, mergeable_state: 'dirty' })
    expect(isQueuedForMerge(pr)).toBe(true)
  })

  it('returns false when state is open and is_queued is false', () => {
    const pr = createPullRequest({ state: 'open', is_queued: false, mergeable: null })
    expect(isQueuedForMerge(pr)).toBe(false)
  })

  it('returns false when state is merged even if is_queued is true', () => {
    const pr = createPullRequest({ state: 'merged', is_queued: true, mergeable: true })
    expect(isQueuedForMerge(pr)).toBe(false)
  })
})

function makeCheck(overrides: Partial<CheckRunInfo> = {}): CheckRunInfo {
  return {
    id: 1,
    name: 'CI / build',
    status: 'completed',
    conclusion: 'success',
    html_url: 'https://github.com/check/1',
    ...overrides,
  }
}

describe('splitCheckRuns', () => {
  it('returns empty arrays for empty input', () => {
    const { visible, passingCount } = splitCheckRuns([])
    expect(visible).toEqual([])
    expect(passingCount).toBe(0)
  })

  it('puts failing checks into visible', () => {
    const checks = [makeCheck({ id: 1, name: 'build', conclusion: 'failure' })]
    const { visible, passingCount } = splitCheckRuns(checks)
    expect(visible).toHaveLength(1)
    expect(visible[0].name).toBe('build')
    expect(passingCount).toBe(0)
  })

  it('puts in-progress checks into visible', () => {
    const checks = [makeCheck({ id: 1, name: 'deploy', status: 'in_progress', conclusion: null })]
    const { visible, passingCount } = splitCheckRuns(checks)
    expect(visible).toHaveLength(1)
    expect(visible[0].name).toBe('deploy')
    expect(passingCount).toBe(0)
  })

  it('puts queued checks into visible', () => {
    const checks = [makeCheck({ id: 1, name: 'test', status: 'queued', conclusion: null })]
    const { visible, passingCount } = splitCheckRuns(checks)
    expect(visible).toHaveLength(1)
    expect(visible[0].name).toBe('test')
    expect(passingCount).toBe(0)
  })

  it('hides passing checks and reports count', () => {
    const checks = [
      makeCheck({ id: 1, name: 'build', conclusion: 'success' }),
      makeCheck({ id: 2, name: 'lint', conclusion: 'success' }),
    ]
    const { visible, passingCount } = splitCheckRuns(checks)
    expect(visible).toHaveLength(0)
    expect(passingCount).toBe(2)
  })

  it('splits mixed checks correctly', () => {
    const checks = [
      makeCheck({ id: 1, name: 'build', conclusion: 'success' }),
      makeCheck({ id: 2, name: 'test', conclusion: 'failure' }),
      makeCheck({ id: 3, name: 'deploy', status: 'in_progress', conclusion: null }),
      makeCheck({ id: 4, name: 'lint', conclusion: 'success' }),
      makeCheck({ id: 5, name: 'e2e', status: 'queued', conclusion: null }),
    ]
    const { visible, passingCount } = splitCheckRuns(checks)
    expect(visible).toHaveLength(3)
    expect(visible.map(c => c.name)).toEqual(['test', 'deploy', 'e2e'])
    expect(passingCount).toBe(2)
  })

  it('treats completed checks with non-success conclusion as visible', () => {
    const checks = [makeCheck({ id: 1, name: 'check', status: 'completed', conclusion: 'skipped' })]
    const { visible, passingCount } = splitCheckRuns(checks)
    expect(visible).toHaveLength(1)
    expect(passingCount).toBe(0)
  })
})
