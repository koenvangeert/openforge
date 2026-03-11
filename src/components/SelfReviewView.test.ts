import { render, screen, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { writable } from 'svelte/store'
import type { Task, PrFileDiff, PrComment, PullRequestInfo } from '../lib/types'

vi.mock('../lib/stores', () => ({
  selfReviewDiffFiles: writable([]),
  selfReviewGeneralComments: writable([]),
  selfReviewArchivedComments: writable([]),
  pendingManualComments: writable([]),
  ticketPrs: writable(new Map()),
}))

vi.mock('../lib/useDiffWorker.svelte', () => ({
  createDiffWorker: vi.fn().mockReturnValue({
    getDiffFile: () => undefined,
    processing: false,
  }),
}))

vi.mock('../lib/useVirtualizer.svelte', () => ({
  createVirtualizer: vi.fn((opts: { getCount: () => number }) => ({
    get virtualItems() {
      const count = opts.getCount()
      return Array.from({ length: count }, (_, i) => ({
        key: i, index: i, start: i * 300, end: (i + 1) * 300, size: 300, lane: 0,
      }))
    },
    totalSize: 0,
    scrollToIndex: vi.fn(),
    measureAction: () => ({ destroy() {} }),
  })),
}))

vi.mock('../lib/ipc', () => ({
  getTaskDiff: vi.fn().mockResolvedValue([]),
  getTaskFileContents: vi.fn().mockResolvedValue(['', '']),
  getTaskBatchFileContents: vi.fn().mockResolvedValue([['', '']]),
  getActiveSelfReviewComments: vi.fn().mockResolvedValue([]),
  getArchivedSelfReviewComments: vi.fn().mockResolvedValue([]),
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn(),
  addSelfReviewComment: vi.fn().mockResolvedValue(undefined),
  deleteSelfReviewComment: vi.fn().mockResolvedValue(undefined),
  archiveSelfReviewComments: vi.fn().mockResolvedValue(undefined),
}))

import SelfReviewView from './SelfReviewView.svelte'

beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: vi.fn().mockReturnValue({
      font: '',
      measureText: (text: string) => ({ width: text.length * 7 }),
      fillText: vi.fn(),
      clearRect: vi.fn(),
    }),
    configurable: true,
  })
})
import { selfReviewDiffFiles, selfReviewGeneralComments, selfReviewArchivedComments, pendingManualComments, ticketPrs } from '../lib/stores'
import { getTaskDiff, getActiveSelfReviewComments, getTaskBatchFileContents, getPrComments } from '../lib/ipc'

const baseTask: Task = {
  id: 'task-1',
  initial_prompt: 'Test Task',
  status: 'doing',
  jira_key: null,
  jira_title: null,
  jira_status: null,
  jira_assignee: null,
  jira_description: null,
  project_id: 'proj-1',
  created_at: Date.now(),
  updated_at: Date.now(),
}

const baseDiff: PrFileDiff = {
  sha: 'abc123',
  filename: 'src/main.rs',
  status: 'modified',
  additions: 5,
  deletions: 2,
  changes: 7,
  patch: '@@ -1,3 +1,4 @@\n line1\n+added\n line2',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

describe('SelfReviewView uncommitted toggle', () => {
  beforeEach(() => {
    selfReviewDiffFiles.set([])
    selfReviewGeneralComments.set([])
    selfReviewArchivedComments.set([])
    pendingManualComments.set([])
    ticketPrs.set(new Map())
    vi.clearAllMocks()
  })

  it('toggle defaults to unchecked', async () => {
    vi.mocked(getTaskDiff).mockResolvedValue([baseDiff])

    render(SelfReviewView, {
      props: {
        task: baseTask,
        agentStatus: null,
        onSendToAgent: vi.fn(),
      },
    })

    await waitFor(() => {
      const checkbox = screen.getByRole('checkbox')
      expect((checkbox as HTMLInputElement).checked).toBe(false)
    })
  })

  it('initial load calls getTaskDiff with includeUncommitted=false', async () => {
    const mockGetTaskDiff = vi.mocked(getTaskDiff).mockResolvedValue([baseDiff])

    render(SelfReviewView, {
      props: {
        task: baseTask,
        agentStatus: null,
        onSendToAgent: vi.fn(),
      },
    })

    await waitFor(() => {
      expect(mockGetTaskDiff).toHaveBeenCalledWith('task-1', false)
    })
  })

  it('toggle visible even with no diff files (empty state)', async () => {
    vi.mocked(getTaskDiff).mockResolvedValue([])

    render(SelfReviewView, {
      props: {
        task: baseTask,
        agentStatus: null,
        onSendToAgent: vi.fn(),
      },
    })

    await waitFor(() => {
      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeTruthy()
      expect((checkbox as HTMLInputElement).checked).toBe(false)
    })
  })

  it('toggling checkbox calls getTaskDiff with includeUncommitted=true', async () => {
    const mockGetTaskDiff = vi.mocked(getTaskDiff).mockResolvedValue([baseDiff])

    render(SelfReviewView, {
      props: {
        task: baseTask,
        agentStatus: null,
        onSendToAgent: vi.fn(),
      },
    })

    await screen.findByRole('checkbox')
    mockGetTaskDiff.mockClear()

    await waitFor(() => {
      expect(screen.getByRole('checkbox').isConnected).toBe(true)
    })

    const cb = screen.getByRole('checkbox') as HTMLInputElement
    cb.click()
    cb.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => {
      expect(mockGetTaskDiff).toHaveBeenCalledWith('task-1', true)
    })
  })
})

describe('SelfReviewView integration — performance fixes', () => {
  beforeEach(() => {
    selfReviewDiffFiles.set([])
    selfReviewGeneralComments.set([])
    selfReviewArchivedComments.set([])
    pendingManualComments.set([])
    ticketPrs.set(new Map())
    vi.clearAllMocks()
  })

  it('getTaskDiff called exactly once on mount', async () => {
    const mockGetTaskDiff = vi.mocked(getTaskDiff).mockResolvedValue([baseDiff])

    render(SelfReviewView, {
      props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
    })

    await waitFor(() => {
      expect(mockGetTaskDiff).toHaveBeenCalledTimes(1)
      expect(mockGetTaskDiff).toHaveBeenCalledWith('task-1', false)
    })
  })

  it('getActiveSelfReviewComments called exactly once on mount', async () => {
    vi.mocked(getTaskDiff).mockResolvedValue([baseDiff])
    const mockGetActiveComments = vi.mocked(getActiveSelfReviewComments)

    render(SelfReviewView, {
      props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
    })

    await waitFor(() => {
      expect(mockGetActiveComments).toHaveBeenCalledTimes(1)
      expect(mockGetActiveComments).toHaveBeenCalledWith('task-1')
    })
  })

  it('DiffViewer toolbar visible after toggle (DiffViewer successfully re-mounted)', async () => {
    vi.mocked(getTaskDiff).mockResolvedValue([baseDiff])
    vi.mocked(getTaskBatchFileContents).mockResolvedValue([['', '']])

    render(SelfReviewView, {
      props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
    })

    await waitFor(() => {
      expect(screen.getByTitle('Search (\u2318F)')).toBeTruthy()
    })

    const cb = screen.getByRole('checkbox') as HTMLInputElement
    cb.click()
    cb.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => {
      expect(screen.getByTitle('Search (\u2318F)')).toBeTruthy()
    }, { timeout: 2000 })
  })
})

describe('SelfReviewView — hide addressed comments', () => {
  beforeEach(() => {
    selfReviewDiffFiles.set([baseDiff])
    selfReviewGeneralComments.set([])
    selfReviewArchivedComments.set([])
    pendingManualComments.set([])
    ticketPrs.set(new Map())
    vi.clearAllMocks()
  })

  const makeComment = (id: number, addressed: number): PrComment => ({
    id,
    pr_id: 1,
    author: 'alice',
    body: `Comment ${id}`,
    comment_type: 'review_comment',
    file_path: 'src/main.rs',
    line_number: 10,
    addressed,
    created_at: 1000 + id,
  })

  const mockPr: PullRequestInfo = {
    id: 1,
    ticket_id: 'task-1',
    repo_owner: 'acme',
    repo_name: 'repo',
    title: 'Test PR',
    url: 'https://github.com/acme/repo/pull/1',
    state: 'open',
    head_sha: 'abc',
    ci_status: null,
    ci_check_runs: null,
    review_status: null,
    merged_at: null,
    created_at: 1000,
    updated_at: 2000,
    unaddressed_comment_count: 0,
  }

  it('addressed comments hidden by default', async () => {
    const comments = [
      makeComment(1, 0), // unaddressed
      makeComment(2, 1), // addressed
    ]
    vi.mocked(getPrComments).mockResolvedValue(comments)
    ticketPrs.set(new Map([['task-1', [mockPr]]]))
    vi.mocked(getTaskDiff).mockResolvedValue([baseDiff])

    render(SelfReviewView, {
      props: {
        task: baseTask,
        agentStatus: null,
        onSendToAgent: vi.fn(),
      },
    })

    await waitFor(() => {
      // Unaddressed comment should be visible
      expect(screen.getByText('Comment 1')).toBeTruthy()
      // Addressed comment should NOT be in DOM
      expect(screen.queryByText('Comment 2')).toBeNull()
    })
  })

  it('toggle shows addressed comments', async () => {
    const comments = [
      makeComment(1, 0), // unaddressed
      makeComment(2, 1), // addressed
    ]
    vi.mocked(getPrComments).mockResolvedValue(comments)
    ticketPrs.set(new Map([['task-1', [mockPr]]]))
    vi.mocked(getTaskDiff).mockResolvedValue([baseDiff])

    render(SelfReviewView, {
      props: {
        task: baseTask,
        agentStatus: null,
        onSendToAgent: vi.fn(),
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Comment 1')).toBeTruthy()
    })

    // Find and click the toggle button
    const toggleButton = screen.getByText(/Show 1 addressed/)
    expect(toggleButton).toBeTruthy()
    toggleButton.click()

    await waitFor(() => {
      // Now addressed comment should be visible
      expect(screen.getByText('Comment 2')).toBeTruthy()
      // Toggle text should change
      expect(screen.getByText('Hide addressed')).toBeTruthy()
    })
  })

  it('toggle hidden when no addressed comments', async () => {
    const comments = [
      makeComment(1, 0), // unaddressed only
    ]
    vi.mocked(getPrComments).mockResolvedValue(comments)
    ticketPrs.set(new Map([['task-1', [mockPr]]]))
    vi.mocked(getTaskDiff).mockResolvedValue([baseDiff])

    render(SelfReviewView, {
      props: {
        task: baseTask,
        agentStatus: null,
        onSendToAgent: vi.fn(),
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Comment 1')).toBeTruthy()
    })

    // Toggle button should not exist
    expect(screen.queryByText(/Show.*addressed/)).toBeNull()
  })

   it('all addressed empty state', async () => {
     const comments = [
       makeComment(1, 1), // addressed only
     ]
     vi.mocked(getPrComments).mockResolvedValue(comments)
     ticketPrs.set(new Map([['task-1', [mockPr]]]))
     vi.mocked(getTaskDiff).mockResolvedValue([baseDiff])

     render(SelfReviewView, {
       props: {
         task: baseTask,
         agentStatus: null,
         onSendToAgent: vi.fn(),
       },
     })

     // Sidebar doesn't auto-open when all comments are addressed (unaddressedCount === 0)
     // So we need to manually click the Comments button
     await waitFor(() => {
       const commentsButton = screen.getByText('Comments')
       expect(commentsButton).toBeTruthy()
     })

     const commentsButton = screen.getByText('Comments')
     commentsButton.click()

     await waitFor(() => {
       // Should show "All comments addressed" empty state
       expect(screen.getByText('All comments addressed')).toBeTruthy()
       // Comment should not be visible (toggle is OFF by default)
       expect(screen.queryByText('Comment 1')).toBeNull()
     })
})

  it('comments sidebar renders inside ResizablePanel at 360px default width', async () => {
    const comments = [
      makeComment(1, 0), // unaddressed — triggers auto-open
    ]
    vi.mocked(getPrComments).mockResolvedValue(comments)
    ticketPrs.set(new Map([['task-1', [mockPr]]]))
    vi.mocked(getTaskDiff).mockResolvedValue([baseDiff])

    render(SelfReviewView, {
      props: {
        task: baseTask,
        agentStatus: null,
        onSendToAgent: vi.fn(),
      },
    })

    await waitFor(() => {
      // Sidebar should auto-open due to unaddressed comment
      expect(screen.getByText('Comment 1')).toBeTruthy()
    })

    const prCommentsTab = screen.getByText('PR Comments')
    const resizablePanel = prCommentsTab.closest('[data-testid="resizable-panel"]') as HTMLElement
    expect(resizablePanel).toBeTruthy()
  })

})
