import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { ReviewPullRequest, PrFileDiff, ReviewSubmissionComment } from '../lib/types'

vi.mock('../lib/stores', () => ({
  reviewPrs: writable([]),
  selectedReviewPr: writable(null),
  prFileDiffs: writable([]),
  reviewRequestCount: writable(0),
  reviewComments: writable([]),
  pendingManualComments: writable([]),
  prOverviewComments: writable([]),
}))

vi.mock('../lib/ipc', () => ({
  fetchReviewPrs: vi.fn(),
  getReviewPrs: vi.fn().mockResolvedValue([]),
  getPrFileDiffs: vi.fn().mockResolvedValue([]),
  getReviewComments: vi.fn().mockResolvedValue([]),
  getPrOverviewComments: vi.fn().mockResolvedValue([]),
  submitPrReview: vi.fn(),
  markReviewPrViewed: vi.fn(),
  openUrl: vi.fn(),
}))

import PrReviewView from './PrReviewView.svelte'
import { reviewPrs, selectedReviewPr, prFileDiffs, reviewComments, pendingManualComments } from '../lib/stores'
import { getReviewPrs, fetchReviewPrs, getPrFileDiffs, getReviewComments } from '../lib/ipc'

const basePr: ReviewPullRequest = {
  id: 12345,
  number: 42,
  title: 'Fix authentication middleware',
  body: 'This PR fixes the auth middleware',
  state: 'open',
  draft: false,
  html_url: 'https://github.com/acme/repo/pull/42',
  user_login: 'alice',
  user_avatar_url: null,
  repo_owner: 'acme',
  repo_name: 'repo',
  head_ref: 'fix/auth',
  base_ref: 'main',
  head_sha: 'abc123',
  additions: 50,
  deletions: 10,
  changed_files: 3,
  created_at: Date.now() - 3600000,
  updated_at: Date.now(),
  viewed_at: null,
  viewed_head_sha: null,
}

describe('PrReviewView', () => {
  beforeEach(() => {
    reviewPrs.set([])
    selectedReviewPr.set(null)
    prFileDiffs.set([])
    reviewComments.set([])
    pendingManualComments.set([])
    vi.clearAllMocks()
  })

  it('shows list view by default', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([])
    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByText('PRs Requesting Your Review')).toBeTruthy()
    })
  })

  it('shows empty state when no PRs', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([])
    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByText('No PRs requesting your review')).toBeTruthy()
      expect(screen.getByText("You're all caught up!")).toBeTruthy()
    })
  })

  it('shows refresh button', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([])
    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Refresh/i })).toBeTruthy()
    })
  })

  it('shows PR count in list view', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    render(PrReviewView)

    await waitFor(() => {
      reviewPrs.set([basePr])
    })

    expect(screen.getByText('1 PR')).toBeTruthy()
  })

  it('shows plural PR count for multiple PRs', async () => {
    const secondPr = { ...basePr, id: 67890, number: 43 }
    vi.mocked(getReviewPrs).mockResolvedValue([basePr, secondPr])
    render(PrReviewView)

    await waitFor(() => {
      reviewPrs.set([basePr, secondPr])
    })

    expect(screen.getByText('2 PRs')).toBeTruthy()
  })

  it('shows PR cards when reviewPrs store has data', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    reviewPrs.set([basePr])

    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByText('Fix authentication middleware')).toBeTruthy()
      expect(screen.getAllByText('acme/repo').length).toBeGreaterThan(0)
    })
  })

  it('calls fetchReviewPrs when refresh button is clicked', async () => {
    const mockFetch = vi.mocked(fetchReviewPrs).mockResolvedValue([])
    vi.mocked(getReviewPrs).mockResolvedValue([])

    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Refresh/i })).toBeTruthy()
    })

    const refreshBtn = screen.getByRole('button', { name: /Refresh/i })
    await fireEvent.click(refreshBtn)

    expect(mockFetch).toHaveBeenCalled()
  })

  it('shows detail view when selectedReviewPr is set', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewComments).mockResolvedValue([])

    render(PrReviewView)

    await waitFor(() => {
      reviewPrs.set([basePr])
    })

    selectedReviewPr.set(basePr)

    await waitFor(() => {
      expect(screen.getByText('← Back to list')).toBeTruthy()
      expect(screen.getByText('Fix authentication middleware')).toBeTruthy()
    })
  })

  it('shows back button in detail view', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewComments).mockResolvedValue([])

    render(PrReviewView)

    selectedReviewPr.set(basePr)

    await waitFor(() => {
      expect(screen.getByText('← Back to list')).toBeTruthy()
    })
  })

  it('shows PR title in detail view header', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewComments).mockResolvedValue([])

    render(PrReviewView)

    selectedReviewPr.set(basePr)

    await waitFor(() => {
      expect(screen.getByText('Fix authentication middleware')).toBeTruthy()
    })
  })

  it('shows PR number in detail view', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewComments).mockResolvedValue([])

    render(PrReviewView)

    selectedReviewPr.set(basePr)

    await waitFor(() => {
      expect(screen.getByText('#42')).toBeTruthy()
    })
  })

  it('back button clears selectedReviewPr', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewComments).mockResolvedValue([])

    render(PrReviewView)

    selectedReviewPr.set(basePr)

    await waitFor(() => {
      expect(screen.getByText('← Back to list')).toBeTruthy()
    })

    const backBtn = screen.getByText('← Back to list')
    await fireEvent.click(backBtn)

    await waitFor(() => {
      expect(screen.getByText('PRs Requesting Your Review')).toBeTruthy()
    })
  })

  it('calls getPrFileDiffs when PR is selected', async () => {
    const mockGetDiffs = vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getReviewComments).mockResolvedValue([])

    reviewPrs.set([basePr])

    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByText('Fix authentication middleware')).toBeTruthy()
    })

    const prCard = screen.getByText('Fix authentication middleware')
    await fireEvent.click(prCard)

    await waitFor(() => {
      expect(mockGetDiffs).toHaveBeenCalledWith('acme', 'repo', 42)
    })
  })

  it('calls getReviewComments when PR is selected', async () => {
    const mockGetComments = vi.mocked(getReviewComments).mockResolvedValue([])
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])

    reviewPrs.set([basePr])

    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByText('Fix authentication middleware')).toBeTruthy()
    })

    const prCard = screen.getByText('Fix authentication middleware')
    await fireEvent.click(prCard)

    await waitFor(() => {
      expect(mockGetComments).toHaveBeenCalledWith('acme', 'repo', 42)
    })
  })

  it('groups PRs by repository', async () => {
    const pr1 = { ...basePr, repo_owner: 'acme', repo_name: 'repo1', id: 1, number: 1, title: 'PR 1' }
    const pr2 = { ...basePr, repo_owner: 'acme', repo_name: 'repo1', id: 2, number: 2, title: 'PR 2' }
    const pr3 = { ...basePr, repo_owner: 'acme', repo_name: 'repo2', id: 3, number: 3, title: 'PR 3' }

    vi.mocked(getReviewPrs).mockResolvedValue([pr1, pr2, pr3])
    reviewPrs.set([pr1, pr2, pr3])

    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getAllByText('acme/repo1').length).toBeGreaterThan(0)
      expect(screen.getAllByText('acme/repo2').length).toBeGreaterThan(0)
    })
  })

  it('clears prFileDiffs when back button is clicked', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewComments).mockResolvedValue([])

    render(PrReviewView)

    selectedReviewPr.set(basePr)
    prFileDiffs.set([
      {
        sha: 'a1',
        filename: 'test.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        changes: 2,
        patch: '@@ -1,1 +1,1 @@',
        previous_filename: null,
        is_truncated: false,
        patch_line_count: null,
      },
    ])

    await waitFor(() => {
      expect(screen.getByText('← Back to list')).toBeTruthy()
    })

    const backBtn = screen.getByText('← Back to list')
    await fireEvent.click(backBtn)

    await waitFor(() => {
      const currentDiffs: PrFileDiff[] = []
      prFileDiffs.subscribe((value) => {
        currentDiffs.push(...value)
      })()
      expect(currentDiffs.length).toBe(0)
    })
  })

  it('clears pendingManualComments when back button is clicked', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewComments).mockResolvedValue([])

    render(PrReviewView)

    selectedReviewPr.set(basePr)
    pendingManualComments.set([
      { path: 'test.ts', line: 10, side: 'RIGHT', body: 'comment' },
    ])

    await waitFor(() => {
      expect(screen.getByText('← Back to list')).toBeTruthy()
    })

    const backBtn = screen.getByText('← Back to list')
    await fireEvent.click(backBtn)

    await waitFor(() => {
      const currentComments: ReviewSubmissionComment[] = []
      pendingManualComments.subscribe((value) => {
        currentComments.push(...value)
      })()
      expect(currentComments.length).toBe(0)
    })
  })
})
