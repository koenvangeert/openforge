import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { get } from 'svelte/store'
import GeneralCommentsSidebar from './GeneralCommentsSidebar.svelte'
import { selfReviewGeneralComments, selfReviewArchivedComments, taskDraftNotes } from '../../../lib/stores'
import type { SelfReviewComment } from '../../../lib/types'
import {
  getActiveSelfReviewComments,
  getArchivedSelfReviewComments,
  addSelfReviewComment,
} from '../../../lib/ipc'

// Use vi.fn() directly in factory to avoid hoisting ReferenceError
vi.mock('../../../lib/ipc', () => ({
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
  beforeEach(() => {
    selfReviewGeneralComments.set([])
    selfReviewArchivedComments.set([])
    taskDraftNotes.set(new Map())
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

    const textarea = screen.getByPlaceholderText('Add a testing note… (⇧Enter to submit)') as HTMLTextAreaElement
    textarea.value = 'New comment'
    await fireEvent.input(textarea)

    const addButton = screen.getByText('Add')
    await fireEvent.click(addButton)

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

  it('submits comment on Shift+Enter', async () => {
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

    const textarea = screen.getByPlaceholderText(/Add a testing note/) as HTMLTextAreaElement
    textarea.value = 'Shift enter comment'
    await fireEvent.input(textarea)

    await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    await new Promise((r) => setTimeout(r, 100))

    expect(mockAddSelfReviewComment).toHaveBeenCalledWith('task-1', 'general', null, null, 'Shift enter comment')
  })

  it('renders comments when stores have data', async () => {
    selfReviewGeneralComments.set([mockComment])
    selfReviewArchivedComments.set([mockArchivedComment])

    render(GeneralCommentsSidebar, { props: { taskId: 'task-1' } })

    await new Promise((r) => setTimeout(r, 50))

    expect(screen.getByText('Test comment')).toBeTruthy()
    expect(screen.getByText('Previous Round (1)')).toBeTruthy()
  })

  
  it('renders comment bodies using MarkdownContent', async () => {
    mockGetActiveSelfReviewComments.mockResolvedValue([
      {
        id: 1,
        task_id: 'task-1',
        comment_type: 'general',
        file_path: null,
        line_number: null,
        body: '**Bold markdown** and `inline code`',
        created_at: Math.floor(Date.now() / 1000),
        round: 1,
        archived_at: null,
      }
    ])
    mockGetArchivedSelfReviewComments.mockResolvedValue([])
    
    const { container } = render(GeneralCommentsSidebar, { props: { taskId: 'task-1' } })
    await new Promise((r) => setTimeout(r, 50))
    
    // Check that Markdown was actually rendered
    expect(container.querySelector('strong')?.textContent).toBe('Bold markdown')
    expect(container.querySelector('code')?.textContent).toBe('inline code')
  })

  describe('draft persistence', () => {
    beforeEach(() => {
      taskDraftNotes.set(new Map())
      selfReviewGeneralComments.set([])
      selfReviewArchivedComments.set([])
      vi.clearAllMocks()
      mockGetActiveSelfReviewComments.mockResolvedValue([])
      mockGetArchivedSelfReviewComments.mockResolvedValue([])
    })

    it('restores draft from store on mount', async () => {
      taskDraftNotes.set(new Map([['task-1', 'saved draft text']]))

      const { unmount } = render(GeneralCommentsSidebar, { props: { taskId: 'task-1' } })
      await new Promise((r) => setTimeout(r, 50))

      const textarea = screen.getByPlaceholderText(/Add a testing note/) as HTMLTextAreaElement
      expect(textarea.value).toBe('saved draft text')

      unmount()
    })

    it('saves draft to store on unmount', async () => {
      const { unmount } = render(GeneralCommentsSidebar, { props: { taskId: 'task-1' } })
      await new Promise((r) => setTimeout(r, 50))

      const textarea = screen.getByPlaceholderText(/Add a testing note/) as HTMLTextAreaElement
      textarea.value = 'my draft note'
      await fireEvent.input(textarea)

      unmount()

      expect(get(taskDraftNotes).get('task-1')).toBe('my draft note')
    })

    it('does not save empty draft to store on unmount', async () => {
      const { unmount } = render(GeneralCommentsSidebar, { props: { taskId: 'task-1' } })
      await new Promise((r) => setTimeout(r, 50))

      // Leave textarea empty
      unmount()

      expect(get(taskDraftNotes).has('task-1')).toBe(false)
    })

    it('does not save whitespace-only draft to store', async () => {
      const { unmount } = render(GeneralCommentsSidebar, { props: { taskId: 'task-1' } })
      await new Promise((r) => setTimeout(r, 50))

      const textarea = screen.getByPlaceholderText(/Add a testing note/) as HTMLTextAreaElement
      textarea.value = '   '
      await fireEvent.input(textarea)

      unmount()

      expect(get(taskDraftNotes).has('task-1')).toBe(false)
    })

    it('clears draft from store after successful comment submission', async () => {
      taskDraftNotes.set(new Map([['task-1', 'draft to clear']]))
      mockAddSelfReviewComment.mockResolvedValue(1)
      mockGetActiveSelfReviewComments.mockResolvedValue([mockComment])
      mockGetArchivedSelfReviewComments.mockResolvedValue([])

      render(GeneralCommentsSidebar, { props: { taskId: 'task-1' } })
      await new Promise((r) => setTimeout(r, 50))

      const textarea = screen.getByPlaceholderText(/Add a testing note/) as HTMLTextAreaElement
      textarea.value = 'new comment text'
      await fireEvent.input(textarea)

      const addButton = screen.getByText('Add')
      await fireEvent.click(addButton)
      await new Promise((r) => setTimeout(r, 150))

      expect(textarea.value).toBe('')
      expect(get(taskDraftNotes).has('task-1')).toBe(false)
    })

    it('is task-scoped: draft for task-1 does not appear for task-2', async () => {
      taskDraftNotes.set(new Map([['task-1', 'task 1 draft']]))

      const { unmount } = render(GeneralCommentsSidebar, { props: { taskId: 'task-2' } })
      await new Promise((r) => setTimeout(r, 50))

      const textarea = screen.getByPlaceholderText(/Add a testing note/) as HTMLTextAreaElement
      expect(textarea.value).toBe('')

      unmount()
    })
  })
})
