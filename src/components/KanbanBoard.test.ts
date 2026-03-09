import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import KanbanBoard from './KanbanBoard.svelte'
import type { Task } from '../lib/types'
import { tasks, activeSessions, activeProjectId, searchQuery } from '../lib/stores'

// Mock IPC functions
vi.mock('../lib/ipc', () => ({
  getTasks: vi.fn(),
  getTasksForProject: vi.fn(() => Promise.resolve([])),
  updateTaskStatus: vi.fn(),
  deleteTask: vi.fn(),
  clearDoneTasks: vi.fn(),
}))

const baseTask: Task = {
  id: 'T-1',
  title: 'Test task',
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

describe('KanbanBoard', () => {
  beforeEach(() => {
    tasks.set([baseTask])
    activeSessions.set(new Map())
    activeProjectId.set('proj-1')
    searchQuery.set('')
  })

  it('renders backlog and doing columns by default', () => {
    render(KanbanBoard)
    expect(screen.getByText('// backlog')).toBeTruthy()
    expect(screen.getByText('// doing')).toBeTruthy()
  })

  it('does not show done column by default (requires drawer toggle)', () => {
    render(KanbanBoard)
    // Done column header should not be in the DOM (drawer is closed)
    expect(screen.queryByText('// done')).toBeNull()
  })

  it('shows done drawer when toggle button is clicked', async () => {
    const doneTask: Task = { ...baseTask, id: 'T-2', title: 'Done task', status: 'done' }
    tasks.set([baseTask, doneTask])

    render(KanbanBoard)

    // Click the "done" toggle button
    const doneToggle = screen.getByTitle('Toggle done drawer (c)')
    await fireEvent.click(doneToggle)

    // Done column header should now be visible in the drawer
    expect(screen.getByText('// done')).toBeTruthy()
    expect(screen.getByText('Done task')).toBeTruthy()
  })

  it('hides backlog column when toggle is clicked', async () => {
    render(KanbanBoard)

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
    render(KanbanBoard)
    expect(screen.getByText('Test task')).toBeTruthy()
  })

  it('filters tasks by title', async () => {
    const taskA: Task = { ...baseTask, id: 'T-1', title: 'Fix auth bug', status: 'backlog' }
    const taskB: Task = { ...baseTask, id: 'T-2', title: 'Add dashboard', status: 'backlog' }
    tasks.set([taskA, taskB])

    render(KanbanBoard)

    // Both visible initially
    expect(screen.getByText('Fix auth bug')).toBeTruthy()
    expect(screen.getByText('Add dashboard')).toBeTruthy()

    searchQuery.set('auth')
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(screen.getByText('Fix auth bug')).toBeTruthy()
    expect(screen.queryByText('Add dashboard')).toBeNull()
  })

  it('filters tasks by task id', async () => {
    const taskA: Task = { ...baseTask, id: 'T-100', title: 'First task', status: 'backlog' }
    const taskB: Task = { ...baseTask, id: 'T-200', title: 'Second task', status: 'doing' }
    tasks.set([taskA, taskB])

    searchQuery.set('T-100')
    render(KanbanBoard)
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(screen.getByText('First task')).toBeTruthy()
    expect(screen.queryByText('Second task')).toBeNull()
  })

  it('filters tasks by jira key', async () => {
    const taskA: Task = { ...baseTask, id: 'T-1', title: 'Task A', jira_key: 'PROJ-42', status: 'backlog' }
    const taskB: Task = { ...baseTask, id: 'T-2', title: 'Task B', jira_key: 'OTHER-10', status: 'backlog' }
    tasks.set([taskA, taskB])

    searchQuery.set('PROJ')
    render(KanbanBoard)
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(screen.getByText('Task A')).toBeTruthy()
    expect(screen.queryByText('Task B')).toBeNull()
  })

  it('search is case insensitive', async () => {
    const taskA: Task = { ...baseTask, id: 'T-1', title: 'Fix Auth Bug', status: 'backlog' }
    tasks.set([taskA])

    searchQuery.set('fix auth')
    render(KanbanBoard)
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(screen.getByText('Fix Auth Bug')).toBeTruthy()
  })

  it('shows all tasks when search is cleared', async () => {
    const taskA: Task = { ...baseTask, id: 'T-1', title: 'Task A', status: 'backlog' }
    const taskB: Task = { ...baseTask, id: 'T-2', title: 'Task B', status: 'doing' }
    tasks.set([taskA, taskB])

    searchQuery.set('Task A')
    render(KanbanBoard)
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(screen.getByText('Task A')).toBeTruthy()
    expect(screen.queryByText('Task B')).toBeNull()

    // Clear search
    searchQuery.set('')
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(screen.getByText('Task A')).toBeTruthy()
    expect(screen.getByText('Task B')).toBeTruthy()
  })


})
