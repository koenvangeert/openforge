import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'svelte'
import type { ReviewSubmissionComment } from '@openforge/plugin-sdk/domain'
import ReviewSubmitPanel from './ReviewSubmitPanel.svelte'

function requireTextarea(container: HTMLElement): HTMLTextAreaElement {
  const textarea = container.querySelector('textarea')
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Expected textarea')
  return textarea
}

type ReviewSubmitPanelProps = ComponentProps<typeof ReviewSubmitPanel>

function renderPanel(overrides: Partial<ReviewSubmitPanelProps> = {}) {
  const onPendingCommentsChange = vi.fn()
  const onSubmitReview = vi.fn().mockResolvedValue(undefined)
  const props = {
    repoOwner: 'acme',
    repoName: 'repo',
    prNumber: 42,
    commitId: 'abc123',
    pendingComments: [],
    onPendingCommentsChange,
    onSubmitReview,
    ...overrides,
  }

  const result = render(ReviewSubmitPanel, { props })
  return { ...result, onPendingCommentsChange, onSubmitReview }
}

describe('ReviewSubmitPanel', () => {
  it('renders Submit Review heading', () => {
    renderPanel()
    expect(screen.getByText('Submit Review')).toBeTruthy()
  })

  it('shows pending comment count with plural and singular labels', () => {
    const comments: ReviewSubmissionComment[] = [
      { path: 'file.ts', line: 10, side: 'RIGHT', body: 'comment 1' },
      { path: 'file.ts', line: 20, side: 'RIGHT', body: 'comment 2' },
    ]
    const { rerender } = renderPanel({ pendingComments: comments })

    expect(screen.getByText('2 comments will be submitted')).toBeTruthy()

    rerender({
      repoOwner: 'acme',
      repoName: 'repo',
      prNumber: 42,
      commitId: 'abc123',
      pendingComments: comments.slice(0, 1),
      onPendingCommentsChange: vi.fn(),
      onSubmitReview: vi.fn(),
    })
    expect(screen.getByText('1 comment will be submitted')).toBeTruthy()
  })

  it('only enables comment and request changes when a summary or pending comments exist', async () => {
    const { container } = renderPanel()

    expect(screen.getByText('Comment').closest('button')?.disabled).toBe(true)
    expect(screen.getByText('Request Changes').closest('button')?.disabled).toBe(true)
    expect(screen.getByText('Approve').closest('button')?.disabled).toBe(false)

    const textarea = requireTextarea(container)
    await fireEvent.input(textarea, { target: { value: 'Review summary' } })

    expect(screen.getByText('Comment').closest('button')?.disabled).toBe(false)
    expect(screen.getByText('Request Changes').closest('button')?.disabled).toBe(false)
  })

  it('submits a comment review with summary and pending comments', async () => {
    const comments: ReviewSubmissionComment[] = [
      { path: 'file.ts', line: 10, side: 'RIGHT', body: 'comment 1' },
    ]
    const { container, onSubmitReview, onPendingCommentsChange } = renderPanel({ pendingComments: comments })

    const textarea = requireTextarea(container)
    await fireEvent.input(textarea, { target: { value: 'Review summary' } })
    await fireEvent.click(screen.getByText('Comment'))

    expect(onSubmitReview).toHaveBeenCalledWith({
      repoOwner: 'acme',
      repoName: 'repo',
      prNumber: 42,
      event: 'COMMENT',
      body: 'Review summary',
      comments,
      commitId: 'abc123',
    })
    expect(onPendingCommentsChange).toHaveBeenCalledWith([])
  })

  it('submits approve without requiring a summary', async () => {
    const { onSubmitReview } = renderPanel()

    await fireEvent.click(screen.getByText('Approve'))

    expect(onSubmitReview).toHaveBeenCalledWith(expect.objectContaining({
      event: 'APPROVE',
      body: '',
    }))
  })

  it('submits request changes when requested', async () => {
    const { container, onSubmitReview } = renderPanel()

    const textarea = requireTextarea(container)
    await fireEvent.input(textarea, { target: { value: 'Needs work' } })
    await fireEvent.click(screen.getByText('Request Changes'))

    expect(onSubmitReview).toHaveBeenCalledWith(expect.objectContaining({
      event: 'REQUEST_CHANGES',
      body: 'Needs work',
    }))
  })

  it('shows success and error feedback for submission results', async () => {
    const success = renderPanel()
    await fireEvent.click(screen.getByText('Approve'))

    await waitFor(() => {
      expect(screen.getByText('Review submitted successfully (Approved)')).toBeTruthy()
    })

    success.unmount()

    renderPanel({ onSubmitReview: vi.fn().mockRejectedValue(new Error('Network error')) })
    await fireEvent.click(screen.getByText('Approve'))

    await waitFor(() => {
      expect(screen.getByText('Failed to submit review. Please try again.')).toBeTruthy()
    })
  })

  it('submits as comment with keyboard shortcut', async () => {
    const { container, onSubmitReview } = renderPanel()

    const textarea = requireTextarea(container)
    await fireEvent.input(textarea, { target: { value: 'Quick comment' } })
    await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    await waitFor(() => {
      expect(onSubmitReview).toHaveBeenCalledWith(expect.objectContaining({
        event: 'COMMENT',
        body: 'Quick comment',
      }))
    })
  })
})
