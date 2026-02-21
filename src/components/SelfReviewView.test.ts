import { render, screen, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { writable } from 'svelte/store'
import type { Task, PrFileDiff } from '../lib/types'

vi.mock('../lib/stores', () => ({
  selfReviewDiffFiles: writable([]),
  selfReviewGeneralComments: writable([]),
  selfReviewArchivedComments: writable([]),
  pendingManualComments: writable([]),
  ticketPrs: writable(new Map()),
}))

vi.mock('../lib/ipc', () => ({
  getTaskDiff: vi.fn().mockResolvedValue([]),
  getTaskFileContents: vi.fn().mockResolvedValue(['', '']),
  getActiveSelfReviewComments: vi.fn().mockResolvedValue([]),
  getArchivedSelfReviewComments: vi.fn().mockResolvedValue([]),
  getPrComments: vi.fn().mockResolvedValue([]),
  openUrl: vi.fn(),
  addSelfReviewComment: vi.fn().mockResolvedValue(undefined),
  deleteSelfReviewComment: vi.fn().mockResolvedValue(undefined),
  archiveSelfReviewComments: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
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
import { getTaskDiff } from '../lib/ipc'

const baseTask: Task = {
  id: 'task-1',
  title: 'Test Task',
  status: 'doing',
  jira_key: null,
  jira_title: null,
  jira_status: null,
  jira_assignee: null,
  jira_description: null,
  plan_text: null,
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
