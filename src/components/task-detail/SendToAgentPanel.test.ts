import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { writable } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewSubmissionComment } from '../../lib/types'
import SendToAgentPanel from './SendToAgentPanel.svelte'

vi.mock('../../lib/stores', () => ({
  selfReviewGeneralComments: writable([]),
  selfReviewArchivedComments: writable([]),
}))

vi.mock('../../lib/ipc', () => ({
  archiveSelfReviewComments: vi.fn().mockResolvedValue(undefined),
  getActiveSelfReviewComments: vi.fn().mockResolvedValue([]),
  getArchivedSelfReviewComments: vi.fn().mockResolvedValue([]),
}))

describe('SendToAgentPanel', () => {
  const inlineComments: ReviewSubmissionComment[] = [
    { path: 'src/task.ts', line: 12, side: 'RIGHT', body: 'task scoped feedback' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses task-scoped pending inline comments for the send affordance', () => {
    render(SendToAgentPanel, {
      props: {
        taskId: 'task-1',
        taskTitle: 'Test task',
        agentStatus: null,
        onSendToAgent: vi.fn(),
        onRefresh: vi.fn(),
        pendingInlineComments: inlineComments,
      },
    })

    expect(screen.getByText('1 inline comment')).toBeTruthy()
    expect(screen.getByText('→ Send to Agent').closest('button')?.disabled).toBe(false)
  })

  it('clears only the provided task-scoped inline comments after sending', async () => {
    const onPendingInlineCommentsChange = vi.fn()
    const onSendToAgent = vi.fn()
    render(SendToAgentPanel, {
      props: {
        taskId: 'task-1',
        taskTitle: 'Test task',
        agentStatus: null,
        onSendToAgent,
        onRefresh: vi.fn(),
        pendingInlineComments: inlineComments,
        onPendingInlineCommentsChange,
      },
    })

    await fireEvent.click(screen.getByText('→ Send to Agent'))

    await waitFor(() => {
      expect(onPendingInlineCommentsChange).toHaveBeenCalledWith([])
      expect(onSendToAgent).toHaveBeenCalled()
    })
  })
})
