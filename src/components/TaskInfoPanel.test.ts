import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import TaskInfoPanel from './TaskInfoPanel.svelte'
import type { Task } from '../lib/types'

vi.mock('../lib/stores', () => ({
  ticketPrs: writable(new Map()),
  selectedTaskId: writable(null),
}))

vi.mock('../lib/ipc', () => ({
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  getWorktreeForTask: vi.fn().mockResolvedValue(null),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

const baseTask: Task = {
  id: 'T-42',
  title: 'Implement auth middleware',
  status: 'todo',
  jira_key: 'PROJ-123',
  jira_status: 'To Do',
  jira_assignee: 'Alice',
  plan_text: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

describe('TaskInfoPanel', () => {
  it('renders "Task Info" section title', () => {
    render(TaskInfoPanel, { props: { task: baseTask } })
    expect(screen.getByText('Task Info')).toBeTruthy()
  })

  it('renders task status label from COLUMN_LABELS', () => {
    render(TaskInfoPanel, { props: { task: baseTask } })
    const matches = screen.getAllByText('To Do')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('renders JIRA key when present', () => {
    render(TaskInfoPanel, { props: { task: baseTask } })
    expect(screen.getByText('PROJ-123')).toBeTruthy()
  })

  it('renders JIRA status when present', () => {
    render(TaskInfoPanel, { props: { task: baseTask } })
    expect(screen.getByText('JIRA Status')).toBeTruthy()
  })

  it('renders JIRA assignee when present', () => {
    render(TaskInfoPanel, { props: { task: baseTask } })
    expect(screen.getByText('Alice')).toBeTruthy()
  })

  it('hides JIRA fields when jira_key is null', () => {
    const taskWithoutJira = { ...baseTask, jira_key: null, jira_status: null, jira_assignee: null }
    render(TaskInfoPanel, { props: { task: taskWithoutJira } })
    expect(screen.queryByText('JIRA')).toBeNull()
    expect(screen.queryByText('JIRA Status')).toBeNull()
    expect(screen.queryByText('JIRA Assignee')).toBeNull()
  })

  it('shows Change Status section with status buttons', () => {
    render(TaskInfoPanel, { props: { task: baseTask } })
    expect(screen.getByText('Change Status')).toBeTruthy()
    expect(screen.getByText('In Progress')).toBeTruthy()
    expect(screen.getByText('In Review')).toBeTruthy()
    expect(screen.getByText('Testing')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
  })

  it('shows Edit Task and Delete buttons', () => {
    render(TaskInfoPanel, { props: { task: baseTask } })
    expect(screen.getByText('Edit Task')).toBeTruthy()
    expect(screen.getByText('Delete')).toBeTruthy()
  })

})
