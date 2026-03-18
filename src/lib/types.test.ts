import { describe, it, expect } from 'vitest'
import { hasMergeConflicts, isReadyToMerge } from './types'

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
})
