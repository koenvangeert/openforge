import { describe, it, expect } from 'vitest';
import { getPrStatusChips } from './prStatusPresentation';
import type { PullRequestInfo } from './types';

describe('getPrStatusChips', () => {
  const basePr = {
    id: 1,
    ticket_id: 'T-1',
    repo_owner: 'owner',
    repo_name: 'repo',
    title: 'title',
    url: 'url',
    state: 'open',
    head_sha: 'sha',
    ci_status: null,
    ci_check_runs: null,
    review_status: null,
    mergeable: null,
    mergeable_state: null,
    merged_at: null,
    created_at: 0,
    updated_at: 0,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0
  } as PullRequestInfo;

  it('handles ci_status in compact surface', () => {
    expect(getPrStatusChips({ ...basePr, ci_status: 'success' }, 'compact'))
      .toContainEqual(expect.objectContaining({ type: 'ci', label: 'CI Passed', variant: 'success' }));
    
    expect(getPrStatusChips({ ...basePr, ci_status: 'failure' }, 'compact'))
      .toContainEqual(expect.objectContaining({ type: 'ci', label: 'CI Failed', variant: 'error' }));
      
    expect(getPrStatusChips({ ...basePr, ci_status: 'pending' }, 'compact'))
      .toContainEqual(expect.objectContaining({ type: 'ci', label: 'CI Pending', variant: 'pending' }));
  });

  it('handles ci_status in detail surface', () => {
    expect(getPrStatusChips({ ...basePr, ci_status: 'success' }, 'detail'))
      .toContainEqual(expect.objectContaining({ type: 'ci', label: 'Passing', icon: 'check', variant: 'success' }));
  });

  it('normalizes review_status pending and review_required', () => {
    const compactPending = getPrStatusChips({ ...basePr, review_status: 'pending' }, 'compact');
    const compactReq = getPrStatusChips({ ...basePr, review_status: 'review_required' }, 'compact');
    
    expect(compactPending).toContainEqual(expect.objectContaining({ type: 'review', label: 'Needs Review', variant: 'neutral' }));
    expect(compactReq).toContainEqual(expect.objectContaining({ type: 'review', label: 'Needs Review', variant: 'neutral' }));
  });

  it('handles draft state', () => {
    expect(getPrStatusChips({ ...basePr, draft: true }, 'compact'))
      .toContainEqual(expect.objectContaining({ type: 'draft', label: 'Draft', variant: 'muted' }));
  });

  it('ignores null and none statuses', () => {
    const chips = getPrStatusChips({ ...basePr, ci_status: 'none', review_status: null }, 'compact');
    expect(chips.some(c => c.type === 'ci')).toBe(false);
    expect(chips.some(c => c.type === 'review')).toBe(false);
  });
});
