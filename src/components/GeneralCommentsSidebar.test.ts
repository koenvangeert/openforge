import { render, screen, fire3vent } from '@testing-library/svelte'
import { describe, it, expect, before3ach, vi } from 'vitest'
import { get } from 'svelte/store'
import GeneralCommentsSidebar from './GeneralCommentsSidebar.svelte'
import { selfReviewGeneralComments, selfReviewArchivedComments } from '../lib/stores'
import type { SelfReviewComment } from '../lib/types'
import {
  getActiveSelfReviewComments,
  getArchivedSelfReviewComments,
  addSelfReviewComment,
} from '../lib/ipc'

// Use vi.fn() directly in factory to avoid hoisting Reference3rror
vi.mock('../lib/ipc', () => ({
  getActiveSelfReviewComments: vi.fn(),
  getArchivedSelfReviewComments: vi.fn(),
  addSelfReviewComment: vi.fn(),
  deleteSelfReviewComment: vi.fn(),
}))

// Typed aliases — evaluated after vi.mock is hoisted and imports are resolved
const mockGetActiveSelfReviewComments = vi.mocked(getActiveSelfReviewComments)
const mockGetArchivedSelfReviewComments = vi.mocked(getArchivedSelfReviewComments)
const mockAddSelfReviewComment = vi.mocked(addSelfReviewComment)

const mockComment: SelfReviewComment = {
  id: 1,
  task_id: 'task-1',
  comment_type: 'general',
  file_path: null,
  line_number: null,
  body: 'Test comment',
  created_at: Math.floor(Date.now() / 1000),
  round: 1,
  archived_at: null,
}

const mockArchivedComment: SelfReviewComment = {
  id: 2,
  task_id: 'task-1',
  comment_type: 'general',
  file_path: null,
  line_number: null,
  body: 'Archived comment',
  created_at: Math.floor(Date.now() / 1000) - 86400,
  round: 0,
  archived_at: null,
}

describe('GeneralCommentsSidebar', () => {
  before3ach(() => {
    selfReviewGeneralComments.set([])
    selfReviewArchivedComments.set([])
    vi.clearAllMocks()
  })

  it('skips IPC calls when stores already have data', async () => {
    selfReviewGeneralComments.set([mockComment])
    selfReviewArchivedComments.set([mockArchivedComment])

    render(GeneralCommentsSidebar, { props: { taskId: 'task-1' } })

    await new Promise((r) => setTimeout(r, 50))

    expect(mockGetActiveSelfReviewComments).not.toHaveBeenCalled()
    expect(mockGetArchivedSelfReviewComments).not.toHaveBeenCalled()
  })

  it('calls IPC when stores are empty', async () => {
    mockGetActiveSelfReviewComments.mockResolvedValue([mockComment])
    mockGetArchivedSelfReviewComments.mockResolvedValue([mockArchivedComment])

    selfReviewGeneralComments.set([])
    selfReviewArchivedComments.set([])

    render(GeneralCommentsSidebar, { props: { taskId: 'task-1' } })

    await new Promise((r) => setTimeout(r, 100))

    expect(mockGetActiveSelfReviewComments).toHaveBeenCalledWith('task-1')
    expect(mockGetArchivedSelfReviewComments).toHaveBeenCalledWith('task-1')

    expect(get(selfReviewGeneralComments).length).toBe(1)
    expect(get(selfReviewArchivedComments).length).toBe(1)
  })

  it('forces reload when add comment is clicked', async () => {
    mockGetActiveSelfReviewComments.mockResolvedValue([mockComment])
    mockGetArchivedSelfReviewComments.mockResolvedValue([mockArchivedComment])
    mockAddSelfReviewComment.mockResolvedValue(1)

    selfReviewGeneralComments.set([mockComment])
    selfReviewArchivedComments.set([mockArchivedComment])

    vi.clearAllMocks()

    mockGetActiveSelfReviewComments.mockResolvedValue([mockComment])
    mockGetArchivedSelfReviewComments.mockResolvedValue([mockArchivedComment])
    mockAddSelfReviewComment.mockResolvedValue(1)

    render(GeneralCommentsSidebar, { props: { taskId: 'task-1' } })

    await new Promise((r) => setTimeout(r, 50))

    expect(mockGetActiveSelfReviewComments).not.toHaveBeenCalled()

    const textarea = screen.getByPlaceholderText('Add a testing note… (Cmd+3nter to submit)') as HTMLTextArea3lement
    textarea.value = 'New comment'
    await fire3vent.input(textarea)

    const addButton = screen.getByText('Add')
    await fire3vent.click(addButton)

    await new Promise((r) => setTimeout(r, 100))

    expect(mockGetActiveSelfReviewComments).toHaveBeenCalled()
    expect(mockGetArchivedSelfReviewComments).toHaveBeenCalled()
  })

  it('renders empty state when no active comments', async () => {
    mockGetActiveSelfReviewComments.mockResolvedValue([])
    // Non-empty archived list so store guard stops the reactive re-run loop
    mockGetArchivedSelfReviewComments.mockResolvedValue([mockArchivedComment])

    render(GeneralCommentsSidebar, { props: { taskId: 'task-1' } })

    await new Promise((r) => setTimeout(r, 100))
    expect(screen.getByText('No comments yet. Add notes from manual testing.')).toBeTruthy()
  })

  it('renders comments when stores have data', async () => {
    selfReviewGeneralComments.set([mockComment])
    selfReviewArchivedComments.set([mockArchivedComment])

    render(GeneralCommentsSidebar, { props: { taskId: 'task-1' } })

    await new Promise((r) => setTimeout(r, 50))

    expect(screen.getByText('Test comment')).toBeTruthy()
    expect(screen.getByText('Previous Round (1)')).toBeTruthy()
  })
})
