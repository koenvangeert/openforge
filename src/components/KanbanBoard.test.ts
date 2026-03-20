import { render, screen, fireEvent, within, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import KanbanBoard from './KanbanBoard.svelte'
import type { Task } from '../lib/types'
import { tasks, activeSessions, activeProjectId, ticketPrs, startingTasks } from '../lib/stores'

vi.mock('../lib/ipc', () => ({
  getTasks: vi.fn(),
  getTasksForProject: vi.fn(() => Promise.resolve([])),
  updateTaskStatus: vi.fn(),
  deleteTask: vi.fn(),
  clearDoneTasks: vi.fn(),
  getProjectConfig: vi.fn(() => Promise.resolve(null)),
  setProjectConfig: vi.fn(() => Promise.resolve()),
  getConfig: vi.fn(() => Promise.resolve(null)),
  setConfig: vi.fn(() => Promise.resolve()),
}))

vi.mock('../lib/boardColumns', () => ({
  loadBoardColumns: vi.fn(() => Promise.resolve([
    { id: 'col-doing', name: 'Doing', statuses: ['idle', 'active', 'needs-input', 'resting', 'celebrating', 'sad', 'frozen', 'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'ready-to-merge', 'pr-merged'], underlyingStatus: 'doing' },
  ])),
  DEFAULT_BOARD_COLUMNS: [
    { id: 'col-doing', name: 'Doing', statuses: ['idle', 'active', 'needs-input', 'resting', 'celebrating', 'sad', 'frozen', 'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'ready-to-merge', 'pr-merged'], underlyingStatus: 'doing' },
  ],
  BACKLOG_COLUMN: { id: 'col-backlog', name: 'Backlog', statuses: ['egg'], underlyingStatus: 'backlog' },
  DONE_COLUMN: { id: 'col-done', name: 'Done', statuses: ['done'], underlyingStatus: 'done' },
}))

vi.mock('../lib/navigation', () => ({
  pushNavState: vi.fn(),
}))

const baseTask: Task = {
  id: 'T-1',
  initial_prompt: 'Test task',
  status: 'backlog',
  jira_key: null,
  jira_title: null,
  jira_status: null,
  jira_assignee: null,
  jira_description: null,
  project_id: 'proj-1',
  created_at: 1000,
  updated_at: 2000,
  prompt: '',
  summary: null,
  agent: null,
  permission_mode: 'default',
}

const mockOnRunAction = vi.fn()

describe('KanbanBoard', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    vi.clearAllMocks()
    tasks.set([baseTask])
    activeSessions.set(new Map())
    activeProjectId.set('proj-1')
    ticketPrs.set(new Map())
    startingTasks.set(new Set())
  })

  it('renders backlog and doing columns by default', async () => {
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
    expect(await screen.findByText('// backlog')).toBeTruthy()
    expect(await screen.findByText('// doing')).toBeTruthy()
    expect(screen.queryByText('// done')).toBeNull()
  })

  it('renders tasks in correct columns', async () => {
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
    expect(await screen.findByText('Test task')).toBeTruthy()
  })

  it('groups tasks by task state into correct columns', async () => {
    const doingTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Doing task', status: 'doing' }
    const doneTask: Task = { ...baseTask, id: 'T-3', initial_prompt: 'Done task', status: 'done' }
    tasks.set([baseTask, doingTask, doneTask])

    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    // Wait for columns to load
    await screen.findByText('// backlog')

    // Find column containers by data-vim-column attribute
    const backlogCol = document.querySelector('[data-vim-column="col-backlog"]')!
    const doingCol = document.querySelector('[data-vim-column="col-doing"]')!

    expect(within(backlogCol as HTMLElement).getByText('Test task')).toBeTruthy()
    expect(within(doingCol as HTMLElement).getByText('Doing task')).toBeTruthy()

    await fireEvent.click(screen.getByTitle('Toggle done drawer (c)'))
    expect(screen.getByText('Done task')).toBeTruthy()
  })

  it('shows empty state for columns with no tasks', async () => {
    tasks.set([])
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
    const emptyMessages = await screen.findAllByText('No tasks')
    expect(emptyMessages.length).toBeGreaterThan(0)
  })

  it('shows clear done button in done drawer when tasks exist', async () => {
    const doneTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Done task', status: 'done' }
    tasks.set([doneTask])

    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    await fireEvent.click(await screen.findByTitle('Toggle done drawer (c)'))
    expect(screen.getByTitle('Clear done tasks')).toBeTruthy()
  })

  it('shows Start Task in context menu for backlog tasks', async () => {
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    const taskCard = await screen.findByText('Test task')
    await fireEvent.contextMenu(taskCard)

    expect(screen.getByText('Start Task')).toBeTruthy()
  })

  it('does not show Start Task in context menu for doing tasks', async () => {
    const doingTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Active task', status: 'doing' }
    tasks.set([doingTask])

    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    const taskCard = await screen.findByText('Active task')
    await fireEvent.contextMenu(taskCard)

    expect(screen.queryByText('Start Task')).toBeNull()
  })

  it('calls onRunAction when Start Task is clicked in context menu', async () => {
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    const taskCard = await screen.findByText('Test task')
    await fireEvent.contextMenu(taskCard)
    await fireEvent.click(screen.getByText('Start Task'))

    expect(mockOnRunAction).toHaveBeenCalledWith({ taskId: 'T-1', actionPrompt: '', agent: null })
  })

  it('shows Move to Done in context menu for doing tasks', async () => {
    const doingTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Active task', status: 'doing' }
    tasks.set([doingTask])

    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    const taskCard = await screen.findByText('Active task')
    await fireEvent.contextMenu(taskCard)

    expect(screen.getByText('Move to Done')).toBeTruthy()
  })

  it('does not show Move to Done in context menu for backlog tasks', async () => {
    tasks.set([baseTask])

    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    const taskCard = await screen.findByText('Test task')
    await fireEvent.contextMenu(taskCard)

    expect(screen.queryByText('Move to Done')).toBeNull()
  })

  it('calls updateTaskStatus with done when Move to Done is clicked', async () => {
    const { updateTaskStatus } = await import('../lib/ipc')
    const doingTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Active task', status: 'doing' }
    tasks.set([doingTask])

    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    const taskCard = await screen.findByText('Active task')
    await fireEvent.contextMenu(taskCard)
    await fireEvent.click(screen.getByText('Move to Done'))

    expect(updateTaskStatus).toHaveBeenCalledWith('T-2', 'done')
  })

  it('renders N columns from custom config', async () => {
    const { loadBoardColumns } = await import('../lib/boardColumns')
    vi.mocked(loadBoardColumns).mockResolvedValueOnce([
      { id: 'col-2', name: 'In Progress', statuses: ['active'], underlyingStatus: 'doing' },
      { id: 'col-3', name: 'Blocked', statuses: ['needs-input', 'sad', 'frozen'], underlyingStatus: 'doing' },
      { id: 'col-4', name: 'Review', statuses: ['pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'ready-to-merge', 'pr-merged'], underlyingStatus: 'doing' },
    ])

    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    expect(await screen.findByText('// backlog')).toBeTruthy()
    expect(await screen.findByText('// in progress')).toBeTruthy()
    expect(await screen.findByText('// blocked')).toBeTruthy()
    expect(await screen.findByText('// review')).toBeTruthy()
    expect(screen.queryByText('// done')).toBeNull()
  })

  it('vim h/l navigation moves between columns', async () => {
    const doingTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Doing task', status: 'doing' }
    tasks.set([baseTask, doingTask])

    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
    await screen.findByText('// backlog')

    await fireEvent.keyDown(window, { key: 'l' })
    await fireEvent.keyDown(window, { key: 'l' })
    await fireEvent.keyDown(window, { key: 'h' })
  })

  it('does not scroll focused board items into view on task store updates alone', async () => {
    const doingTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Doing task', status: 'doing' }
    tasks.set([baseTask, doingTask])

    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    await screen.findByText('// backlog')
    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    })

    vi.mocked(Element.prototype.scrollIntoView).mockClear()

    tasks.set([
      baseTask,
      doingTask,
      { ...baseTask, id: 'T-3', initial_prompt: 'Another doing task', status: 'doing' },
    ])

    await waitFor(() => {
      expect(screen.getByText('Another doing task')).toBeTruthy()
    })

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not scroll when a task moves columns during a store update', async () => {
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    await screen.findByText('// backlog')
    vi.mocked(Element.prototype.scrollIntoView).mockClear()

    tasks.set([{ ...baseTask, status: 'doing' }])

    await waitFor(() => {
      const doingColumn = document.querySelector('[data-vim-column="col-doing"]')
      expect(doingColumn).toBeTruthy()
      expect(within(doingColumn as HTMLElement).getByText('Test task')).toBeTruthy()
    })

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('scrolls the focused board item into view on vim navigation', async () => {
    const doingTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Doing task', status: 'doing' }
    tasks.set([baseTask, doingTask])

    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    await screen.findByText('// backlog')
    vi.mocked(Element.prototype.scrollIntoView).mockClear()

    await fireEvent.keyDown(window, { key: 'l' })

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('shows toggle bar with backlog and done controls', async () => {
    const doneTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Done task', status: 'done' }
    tasks.set([baseTask, doneTask])
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
    expect(await screen.findByTitle('Toggle backlog (b)')).toBeTruthy()
    expect(screen.getByTitle('Toggle done drawer (c)')).toBeTruthy()
  })

  it('hides backlog when toggle is clicked', async () => {
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
    await screen.findByText('// backlog')
    await fireEvent.click(screen.getByTitle('Toggle backlog (b)'))
    expect(screen.queryByText('// backlog')).toBeNull()
    expect(screen.getByText('// doing')).toBeTruthy()
  })

  it('b shortcut toggles backlog visibility', async () => {
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
    await screen.findByText('// backlog')
    await fireEvent.keyDown(window, { key: 'b' })
    expect(screen.queryByText('// backlog')).toBeNull()
    await fireEvent.keyDown(window, { key: 'b' })
    expect(screen.getByText('// backlog')).toBeTruthy()
  })

  it('shows done drawer when toggle is clicked', async () => {
    const doneTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Done task', status: 'done' }
    tasks.set([doneTask])
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
    await screen.findByText('// doing')
    expect(screen.queryByText('// done')).toBeNull()
    await fireEvent.click(screen.getByTitle('Toggle done drawer (c)'))
    expect(screen.getByText('// done')).toBeTruthy()
    expect(screen.getByText('Done task')).toBeTruthy()
  })

  it('c shortcut toggles done drawer', async () => {
    const doneTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Done task', status: 'done' }
    tasks.set([doneTask])
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
    await screen.findByText('// doing')
    await fireEvent.keyDown(window, { key: 'c' })
    expect(screen.getByText('// done')).toBeTruthy()
    await fireEvent.keyDown(window, { key: 'c' })
    expect(screen.queryByText('// done')).toBeNull()
  })

  it('Escape key dismisses done drawer when open', async () => {
    const doneTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Done task', status: 'done' }
    tasks.set([doneTask])
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
    await screen.findByText('// doing')
    await fireEvent.keyDown(window, { key: 'c' })
    expect(screen.getByText('// done')).toBeTruthy()
    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('// done')).toBeNull()
  })

  describe('backlog state persistence', () => {
    it('loads saved backlog state on mount (collapsed)', async () => {
      const { getConfig } = await import('../lib/ipc')
      vi.mocked(getConfig).mockResolvedValue('false')

      render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
      await screen.findByText('// doing')

      expect(screen.queryByText('// backlog')).toBeNull()
    })

    it('defaults to open when no saved state', async () => {
      const { getConfig } = await import('../lib/ipc')
      vi.mocked(getConfig).mockResolvedValue(null)

      render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
      expect(await screen.findByText('// backlog')).toBeTruthy()
    })

    it('persists collapsed state when backlog is toggled via click', async () => {
      const { setConfig } = await import('../lib/ipc')

      render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
      await screen.findByText('// backlog')

      await fireEvent.click(screen.getByTitle('Toggle backlog (b)'))

      expect(setConfig).toHaveBeenCalledWith('backlog_visible', 'false')
    })

    it('persists open state when backlog is toggled back open', async () => {
      const { getConfig, setConfig } = await import('../lib/ipc')
      vi.mocked(getConfig).mockResolvedValue('false')

      render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
      await screen.findByText('// doing')

      await fireEvent.click(screen.getByTitle('Toggle backlog (b)'))

      expect(setConfig).toHaveBeenCalledWith('backlog_visible', 'true')
    })

    it('persists state when toggled via b keyboard shortcut', async () => {
      const { getConfig, setConfig } = await import('../lib/ipc')
      vi.mocked(getConfig).mockResolvedValue(null)

      render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
      await screen.findByText('// backlog')

      await fireEvent.keyDown(window, { key: 'b' })

      expect(setConfig).toHaveBeenCalledWith('backlog_visible', 'false')
    })

    it('reads config with correct key', async () => {
      const { getConfig } = await import('../lib/ipc')
      vi.mocked(getConfig).mockResolvedValue(null)

      render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
      await screen.findByText('// doing')

      expect(getConfig).toHaveBeenCalledWith('backlog_visible')
    })
  })
})
