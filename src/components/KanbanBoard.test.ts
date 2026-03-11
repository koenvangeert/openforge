import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import KanbanBoard from './KanbanBoard.svelte'
import type { Task } from '../lib/types'
import { tasks, activeSessions, activeProjectId } from '../lib/stores'

// Mock IPC functions
vi.mock('../lib/ipc', () => ({
  getTasks: vi.fn(),
  getTasksForProject: vi.fn(() => Promise.resolve([])),
  updateTaskStatus: vi.fn(),
  deleteTask: vi.fn(),
  clearDoneTasks: vi.fn(),
  runAction: vi.fn(),
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
    vi.clearAllMocks()
    tasks.set([baseTask])
    activeSessions.set(new Map())
    activeProjectId.set('proj-1')
  })

  it('renders backlog and doing columns by default', () => {
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
    expect(screen.getByText('// backlog')).toBeTruthy()
    expect(screen.getByText('// doing')).toBeTruthy()
  })

  it('does not show done column by default (requires drawer toggle)', () => {
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
    // Done column header should not be in the DOM (drawer is closed)
    expect(screen.queryByText('// done')).toBeNull()
  })

  it('shows done drawer when toggle button is clicked', async () => {
    const doneTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Done task', status: 'done' }
    tasks.set([baseTask, doneTask])

    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    // Click the "done" toggle button
    const doneToggle = screen.getByTitle('Toggle done drawer (c)')
    await fireEvent.click(doneToggle)

    // Done column header should now be visible in the drawer
    expect(screen.getByText('// done')).toBeTruthy()
    expect(screen.getByText('Done task')).toBeTruthy()
  })

  it('hides backlog column when toggle is clicked', async () => {
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    // Backlog column header is visible
    expect(screen.getByText('// backlog')).toBeTruthy()

    // Click the backlog toggle button
    const backlogToggle = screen.getByTitle('Toggle backlog (b)')
    await fireEvent.click(backlogToggle)
    await new Promise(resolve => setTimeout(resolve, 10))

    // Backlog column header should be gone
    expect(screen.queryByText('// backlog')).toBeNull()
  })

  it('renders tasks in correct columns', () => {
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })
    expect(screen.getByText('Test task')).toBeTruthy()
  })

  it('shows Start Task in context menu for backlog tasks', async () => {
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    const taskCard = screen.getByText('Test task')
    await fireEvent.contextMenu(taskCard)

    expect(screen.getByText('Start Task')).toBeTruthy()
  })

  it('does not show Start Task in context menu for doing tasks', async () => {
    const doingTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Active task', status: 'doing' }
    tasks.set([doingTask])

    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    const taskCard = screen.getByText('Active task')
    await fireEvent.contextMenu(taskCard)

    expect(screen.queryByText('Start Task')).toBeNull()
  })

  it('calls onRunAction when Start Task is clicked in context menu', async () => {
    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    const taskCard = screen.getByText('Test task')
    await fireEvent.contextMenu(taskCard)
    await fireEvent.click(screen.getByText('Start Task'))

    expect(mockOnRunAction).toHaveBeenCalledWith({ taskId: 'T-1', actionPrompt: '', agent: null })
  })

  it('shows Move to submenu in context menu', async () => {
    const doingTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Active task', status: 'doing' }
    tasks.set([doingTask])

    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    const taskCard = screen.getByText('Active task')
    await fireEvent.contextMenu(taskCard)

    expect(screen.getByText('Move to... ›')).toBeTruthy()
  })

  it('shows all columns in Move to submenu when expanded', async () => {
    const doingTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Active task', status: 'doing' }
    tasks.set([doingTask])

    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    const taskCard = screen.getByText('Active task')
    await fireEvent.contextMenu(taskCard)
    await fireEvent.click(screen.getByText('Move to... ›'))

    expect(screen.getByText('Backlog')).toBeTruthy()
    expect(screen.getByText('Doing')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
  })

  it('calls updateTaskStatus when a move target is clicked', async () => {
    const { updateTaskStatus } = await import('../lib/ipc')
    const doingTask: Task = { ...baseTask, id: 'T-2', initial_prompt: 'Active task', status: 'doing' }
    tasks.set([doingTask])

    render(KanbanBoard, { props: { onRunAction: mockOnRunAction } })

    const taskCard = screen.getByText('Active task')
    await fireEvent.contextMenu(taskCard)
    await fireEvent.click(screen.getByText('Move to... ›'))
    await fireEvent.click(screen.getByText('Done'))

    expect(updateTaskStatus).toHaveBeenCalledWith('T-2', 'done')
  })

})
