import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { ReviewSubmissionComment } from '../lib/types'

vi.mock('../lib/stores', () => ({
  pendingManualComments: writable([]),
}))

vi.mock('../lib/ipc', () => ({
  submitPrReview: vi.fn(),
}))

import ReviewSubmitPanel from './ReviewSubmitPanel.svelte'
import { pendingManualComments } from '../lib/stores'
import { submitPrReview } from '../lib/ipc'

describe('ReviewSubmitPanel', () => {
  beforeEach(() => {
    pendingManualComments.set([])
    vi.clearAllMocks()
  })

  it('renders Submit Review heading', () => {
    render(ReviewSubmitPanel, {
      props: {
        repoOwner: 'acme',
        repoName: 'repo',
        prNumber: 42,
        commitId: 'abc123',
      },
    })
    expect(screen.getByText('Submit Review')).toBeTruthy()
  })

  it('shows comment count when pending comments exist', () => {
    const comments: ReviewSubmissionComment[] = [
      { path: 'file.ts', line: 10, side: 'RIGHT', body: 'comment 1' },
      { path: 'file.ts', line: 20, side: 'RIGHT', body: 'comment 2' },
    ]
    pendingManualComments.set(comments)

    render(ReviewSubmitPanel, {
      props: {
        repoOwner: 'acme',
        repoName: 'repo',
        prNumber: 42,
        commitId: 'abc123',
      },
    })
    expect(screen.getByText('2 comments will be submitted')).toBeTruthy()
  })

  it('shows singular label for 1 pending comment', () => {
    const comments: ReviewSubmissionComment[] = [
      { path: 'file.ts', line: 10, side: 'RIGHT', body: 'comment 1' },
    ]
    pendingManualComments.set(comments)

    render(ReviewSubmitPanel, {
      props: {
        repoOwner: 'acme',
        repoName: 'repo',
        prNumber: 42,
        commitId: 'abc123',
      },
    })
    expect(screen.getByText('1 comment will be submitted')).toBeTruthy()
  })

  it('renders all 3 action buttons', () => {
    render(ReviewSubmitPanel, {
      props: {
        repoOwner: 'acme',
        repoName: 'repo',
        prNumber: 42,
        commitId: 'abc123',
      },
    })
    expect(screen.getByText('Comment')).toBeTruthy()
    expect(screen.getByText('Approve')).toBeTruthy()
    expect(screen.getByText('Request Changes')).toBeTruthy()
  })

  it('buttons are disabled when no summary and no pending comments', () => {
    render(ReviewSubmitPanel, {
      props: {
        repoOwner: 'acme',
        repoName: 'repo',
        prNumber: 42,
        commitId: 'abc123',
      },
    })
    const commentBtn = screen.getByText('Comment')
    const approveBtn = screen.getByText('Approve')
    const requestChangesBtn = screen.getByText('Request Changes')

    expect(commentBtn.closest('button')?.disabled).toBe(true)
    expect(approveBtn.closest('button')?.disabled).toBe(true)
    expect(requestChangesBtn.closest('button')?.disabled).toBe(true)
  })

  it('buttons are enabled when summary has text', async () => {
    const { container } = render(ReviewSubmitPanel, {
      props: {
        repoOwner: 'acme',
        repoName: 'repo',
        prNumber: 42,
        commitId: 'abc123',
      },
    })

    const textarea = container.querySelector('textarea')
    expect(textarea).toBeTruthy()

    await fireEvent.input(textarea!, { target: { value: 'Review summary' } })

    const commentBtn = screen.getByText('Comment')
    const approveBtn = screen.getByText('Approve')
    const requestChangesBtn = screen.getByText('Request Changes')

    expect(commentBtn.closest('button')?.disabled).toBe(false)
    expect(approveBtn.closest('button')?.disabled).toBe(false)
    expect(requestChangesBtn.closest('button')?.disabled).toBe(false)
  })

  it('buttons are enabled when pending comments exist', () => {
    const comments: ReviewSubmissionComment[] = [
      { path: 'file.ts', line: 10, side: 'RIGHT', body: 'comment 1' },
    ]
    pendingManualComments.set(comments)

    render(ReviewSubmitPanel, {
      props: {
        repoOwner: 'acme',
        repoName: 'repo',
        prNumber: 42,
        commitId: 'abc123',
      },
    })

    const commentBtn = screen.getByText('Comment')
    const approveBtn = screen.getByText('Approve')
    const requestChangesBtn = screen.getByText('Request Changes')

    expect(commentBtn.closest('button')?.disabled).toBe(false)
    expect(approveBtn.closest('button')?.disabled).toBe(false)
    expect(requestChangesBtn.closest('button')?.disabled).toBe(false)
  })

  it('calls submitPrReview when Comment button is clicked', async () => {
    const mockSubmit = vi.mocked(submitPrReview).mockResolvedValue()

    const { container } = render(ReviewSubmitPanel, {
      props: {
        repoOwner: 'acme',
        repoName: 'repo',
        prNumber: 42,
        commitId: 'abc123',
      },
    })

    const textarea = container.querySelector('textarea')
    await fireEvent.input(textarea!, { target: { value: 'Review summary' } })

    const commentBtn = screen.getByText('Comment')
    await fireEvent.click(commentBtn)

    expect(mockSubmit).toHaveBeenCalledWith('acme', 'repo', 42, 'COMMENT', 'Review summary', [], 'abc123')
  })

  it('calls submitPrReview when Approve button is clicked', async () => {
    const mockSubmit = vi.mocked(submitPrReview).mockResolvedValue()

    const { container } = render(ReviewSubmitPanel, {
      props: {
        repoOwner: 'acme',
        repoName: 'repo',
        prNumber: 42,
        commitId: 'abc123',
      },
    })

    const textarea = container.querySelector('textarea')
    await fireEvent.input(textarea!, { target: { value: 'LGTM' } })

    const approveBtn = screen.getByText('Approve')
    await fireEvent.click(approveBtn)

    expect(mockSubmit).toHaveBeenCalledWith('acme', 'repo', 42, 'APPROVE', 'LGTM', [], 'abc123')
  })

  it('calls submitPrReview when Request Changes button is clicked', async () => {
    const mockSubmit = vi.mocked(submitPrReview).mockResolvedValue()

    const { container } = render(ReviewSubmitPanel, {
      props: {
        repoOwner: 'acme',
        repoName: 'repo',
        prNumber: 42,
        commitId: 'abc123',
      },
    })

    const textarea = container.querySelector('textarea')
    await fireEvent.input(textarea!, { target: { value: 'Needs work' } })

    const requestChangesBtn = screen.getByText('Request Changes')
    await fireEvent.click(requestChangesBtn)

    expect(mockSubmit).toHaveBeenCalledWith('acme', 'repo', 42, 'REQUEST_CHANGES', 'Needs work', [], 'abc123')
  })

  it('shows success message after successful submission', async () => {
    vi.mocked(submitPrReview).mockResolvedValue()

    const { container } = render(ReviewSubmitPanel, {
      props: {
        repoOwner: 'acme',
        repoName: 'repo',
        prNumber: 42,
        commitId: 'abc123',
      },
    })

    const textarea = container.querySelector('textarea')
    await fireEvent.input(textarea!, { target: { value: 'LGTM' } })

    const approveBtn = screen.getByText('Approve')
    await fireEvent.click(approveBtn)

    await waitFor(() => {
      expect(screen.getByText('Review submitted successfully (Approved)')).toBeTruthy()
    })
  })

  it('shows error message when submission fails', async () => {
    vi.mocked(submitPrReview).mockRejectedValue(new Error('Network error'))

    const { container } = render(ReviewSubmitPanel, {
      props: {
        repoOwner: 'acme',
        repoName: 'repo',
        prNumber: 42,
        commitId: 'abc123',
      },
    })

    const textarea = container.querySelector('textarea')
    await fireEvent.input(textarea!, { target: { value: 'LGTM' } })

    const commentBtn = screen.getByText('Comment')
    await fireEvent.click(commentBtn)

    await waitFor(() => {
      expect(screen.getByText('Failed to submit review. Please try again.')).toBeTruthy()
    })
  })

  it('clears pending comments on successful submission', async () => {
    vi.mocked(submitPrReview).mockResolvedValue()

    const comments: ReviewSubmissionComment[] = [
      { path: 'file.ts', line: 10, side: 'RIGHT', body: 'comment 1' },
    ]
    pendingManualComments.set(comments)

    render(ReviewSubmitPanel, {
      props: {
        repoOwner: 'acme',
        repoName: 'repo',
        prNumber: 42,
        commitId: 'abc123',
      },
    })

    const commentBtn = screen.getByText('Comment')
    await fireEvent.click(commentBtn)

    await waitFor(() => {
      expect(screen.queryByText('1 comment will be submitted')).toBeNull()
    })
  })

  it('submits as COMMENT on Shift+Enter in textarea', async () => {
    const mockSubmit = vi.mocked(submitPrReview).mockResolvedValue()

    const { container } = render(ReviewSubmitPanel, {
      props: {
        repoOwner: 'acme',
        repoName: 'repo',
        prNumber: 42,
        commitId: 'abc123',
      },
    })

    const textarea = container.querySelector('textarea')
    await fireEvent.input(textarea!, { target: { value: 'Quick comment' } })

    await fireEvent.keyDown(textarea!, { key: 'Enter', shiftKey: true })

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith('acme', 'repo', 42, 'COMMENT', 'Quick comment', [], 'abc123')
    })
  })

  it('includes pending comments in submission', async () => {
    const mockSubmit = vi.mocked(submitPrReview).mockResolvedValue()

    const comments: ReviewSubmissionComment[] = [
      { path: 'file.ts', line: 10, side: 'RIGHT', body: 'comment 1' },
      { path: 'file.ts', line: 20, side: 'RIGHT', body: 'comment 2' },
    ]
    pendingManualComments.set(comments)

    render(ReviewSubmitPanel, {
      props: {
        repoOwner: 'acme',
        repoName: 'repo',
        prNumber: 42,
        commitId: 'abc123',
      },
    })

    const commentBtn = screen.getByText('Comment')
    await fireEvent.click(commentBtn)

    expect(mockSubmit).toHaveBeenCalledWith('acme', 'repo', 42, 'COMMENT', '', comments, 'abc123')
  })
})
