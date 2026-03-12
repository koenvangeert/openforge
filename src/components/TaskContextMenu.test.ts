import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TaskContextMenu from './TaskContextMenu.svelte'
import type { Task } from '../lib/types'
import { tasks, error } from '../lib/stores'

vi.mock('../lib/ipc', () => ({
  updateTaskStatus: vi.fn(),
  deleteTask: vi.fn(),
}))

const makeTask = (id: string, status: string): Task => ({
  id,
  initial_prompt: 'Test task',
  status,
  jira_key: null,
  jira_title: null,
  jira_status: null,
  jira_assignee: null,
  jira_description: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
  prompt: '',
  summary: null,
  agent: null,
  permission_mode: 'default',
})

beforeEach(() => {
  vi.clearAllMocks()
  tasks.set([])
  error.set(null)
})

describe('TaskContextMenu', () => {
  it('does not render when visible is false', () => {
    tasks.set([makeTask('T-1', 'backlog')])
    render(TaskContextMenu, { props: { visible: false, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    expect(screen.queryByText('Start Task')).toBeNull()
    expect(screen.queryByText('Delete')).toBeNull()
  })

  it('shows Start Task for backlog tasks when onStart is provided', () => {
    tasks.set([makeTask('T-1', 'backlog')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn(), onStart: vi.fn() } })
    expect(screen.getByText('Start Task')).toBeTruthy()
  })

  it('does not show Start Task for doing tasks', () => {
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn(), onStart: vi.fn() } })
    expect(screen.queryByText('Start Task')).toBeNull()
  })

  it('does not show Start Task when onStart is not provided', () => {
    tasks.set([makeTask('T-1', 'backlog')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    expect(screen.queryByText('Start Task')).toBeNull()
  })

  it('calls onStart with taskId when Start Task is clicked', async () => {
    const onStart = vi.fn()
    const onClose = vi.fn()
    tasks.set([makeTask('T-1', 'backlog')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose, onStart } })
    await fireEvent.click(screen.getByText('Start Task'))
    expect(onStart).toHaveBeenCalledWith('T-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows Move to Done for doing tasks', () => {
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    expect(screen.getByText('Move to Done')).toBeTruthy()
  })

  it('does not show Move to Done for backlog tasks', () => {
    tasks.set([makeTask('T-1', 'backlog')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    expect(screen.queryByText('Move to Done')).toBeNull()
  })

  it('does not show Move to Done for done tasks', () => {
    tasks.set([makeTask('T-1', 'done')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    expect(screen.queryByText('Move to Done')).toBeNull()
  })

  it('calls updateTaskStatus with done when Move to Done is clicked', async () => {
    const { updateTaskStatus } = await import('../lib/ipc')
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    await fireEvent.click(screen.getByText('Move to Done'))
    expect(updateTaskStatus).toHaveBeenCalledWith('T-1', 'done')
  })

  it('always shows Delete option', () => {
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    expect(screen.getByText('Delete')).toBeTruthy()
  })

  it('calls deleteTask and onDelete when Delete is clicked', async () => {
    const { deleteTask } = await import('../lib/ipc')
    const onDelete = vi.fn()
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn(), onDelete } })
    await fireEvent.click(screen.getByText('Delete'))
    expect(deleteTask).toHaveBeenCalledWith('T-1')
    expect(onDelete).toHaveBeenCalledWith('T-1')
  })

  it('calls deleteTask without onDelete when not provided', async () => {
    const { deleteTask } = await import('../lib/ipc')
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    await fireEvent.click(screen.getByText('Delete'))
    expect(deleteTask).toHaveBeenCalledWith('T-1')
  })

  it('closes menu on outside click', async () => {
    const onClose = vi.fn()
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose } })
    await fireEvent.click(window)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not show Move to submenu with all columns', () => {
    tasks.set([makeTask('T-1', 'doing')])
    render(TaskContextMenu, { props: { visible: true, x: 0, y: 0, taskId: 'T-1', onClose: vi.fn() } })
    expect(screen.queryByText('Move to... ›')).toBeNull()
    expect(screen.queryByText('Backlog')).toBeNull()
    expect(screen.queryByText('Doing')).toBeNull()
  })
})
