import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import TaskDetailView from './TaskDetailView.svelte'
import type { Task } from '../lib/types'

// Mock stores
vi.mock('../lib/stores', () => ({
  selectedTaskId: writable(null),
  activeSessions: writable(new Map()),
  ticketPrs: writable(new Map()),
  tasks: writable([]),
  activeProjectId: writable('project-1'),
}))

// Mock IPC functions
vi.mock('../lib/ipc', () => ({
  abortImplementation: vi.fn().mockResolvedValue(undefined),
  updateTaskFields: vi.fn().mockResolvedValue(undefined),
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  getTasksForProject: vi.fn().mockResolvedValue([]),
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  getWorktreeForTask: vi.fn().mockResolvedValue(null),
}))

// Mock Tauri event listening
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

describe('TaskDetailView', () => {
  it('renders back button with "Back to Board" text', () => {
    render(TaskDetailView, { props: { task: baseTask } })
    expect(screen.getByText('Back to Board')).toBeTruthy()
  })

  it('renders task jira_key when present', () => {
    render(TaskDetailView, { props: { task: baseTask } })
    const matches = screen.getAllByText('PROJ-123')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('renders task id when jira_key is null', () => {
    const taskWithoutJira = { ...baseTask, jira_key: null }
    render(TaskDetailView, { props: { task: taskWithoutJira } })
    expect(screen.getByText('T-42')).toBeTruthy()
  })

  it('renders task title in header', () => {
    render(TaskDetailView, { props: { task: baseTask } })
    expect(screen.getByText('Implement auth middleware')).toBeTruthy()
  })

  it('renders status badge with status label', () => {
    render(TaskDetailView, { props: { task: baseTask } })
    expect(screen.getByText('Todo')).toBeTruthy()
  })

  it('has AgentPanel child with empty state text', () => {
    render(TaskDetailView, { props: { task: baseTask } })
    expect(screen.getByText('No active agent session')).toBeTruthy()
  })

  it('has TaskInfoPanel child with section title', () => {
    render(TaskDetailView, { props: { task: baseTask } })
    expect(screen.getByText('Task Info')).toBeTruthy()
  })
})
