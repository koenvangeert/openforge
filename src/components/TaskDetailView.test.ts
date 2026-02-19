import { render, screen, waitFor, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock('../lib/stores', () => ({
  selectedTaskId: writable(null),
  activeSessions: writable(new Map()),
  ticketPrs: writable(new Map()),
  tasks: writable([]),
  activeProjectId: writable('project-1'),
}))

vi.mock('../lib/ipc', () => ({
  abortImplementation: vi.fn().mockResolvedValue(undefined),
  updateTaskFields: vi.fn().mockResolvedValue(undefined),
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  getWorktreeForTask: vi.fn().mockResolvedValue(null),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  setProjectConfig: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('../lib/actions', () => ({
  loadActions: vi.fn(() => Promise.resolve([
    { id: 'action-1', name: 'Plan/Design', prompt: 'Plan this task', agent: null, builtin: true, enabled: true },
    { id: 'action-2', name: 'Start Implementation', prompt: 'Implement this task', agent: null, builtin: true, enabled: true },
  ])),
  getEnabledActions: vi.fn((actions: { enabled: boolean }[]) => actions.filter(a => a.enabled)),
}))

import TaskDetailView from './TaskDetailView.svelte'
import type { Task, AgentSession } from '../lib/types'
import { activeSessions } from '../lib/stores'

const baseTask: Task = {
  id: 'T-42',
  title: 'Implement auth middleware',
  status: 'backlog',
  jira_key: 'PROJ-123',
  jira_title: null,
  jira_status: 'To Do',
  jira_assignee: 'Alice',
  plan_text: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

const mockOnRunAction = vi.fn()

const baseSession: AgentSession = {
  id: 'session-1',
  ticket_id: 'T-42',
  opencode_session_id: null,
  stage: 'implement',
  status: 'running',
  checkpoint_data: null,
  error_message: null,
  created_at: 1000,
  updated_at: 2000,
}

describe('TaskDetailView', () => {
  it('renders back button with "Back to Board" text', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('Back to Board')).toBeTruthy()
  })

  it('renders task jira_key when present', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    const matches = screen.getAllByText('PROJ-123')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('renders task id when jira_key is null', () => {
    const taskWithoutJira = { ...baseTask, jira_key: null }
    render(TaskDetailView, { props: { task: taskWithoutJira, onRunAction: mockOnRunAction } })
    expect(screen.getByText('T-42')).toBeTruthy()
  })

  it('renders task title in header', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    const titles = screen.getAllByText('Implement auth middleware')
    expect(titles.length).toBeGreaterThanOrEqual(1)
  })

  it('renders status badge with status label', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    const matches = screen.getAllByText('Backlog')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('has AgentPanel child with empty state text', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('No active agent session')).toBeTruthy()
  })

  it('has TaskInfoPanel child with section title', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('Task Info')).toBeTruthy()
  })

  it('hides Review toggle when no worktree', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.queryByText('Review')).toBeNull()
    })
  })

  it('renders action buttons in header', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Plan/Design')).toBeTruthy()
    })
    expect(screen.getByText('Start Implementation')).toBeTruthy()
  })

  it('calls onRunAction when action button clicked', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Start Implementation')).toBeTruthy()
    })
    await fireEvent.click(screen.getByText('Start Implementation'))
    expect(mockOnRunAction).toHaveBeenCalledWith({ taskId: 'T-42', actionPrompt: 'Implement this task', agent: null })
  })

  it('disables action buttons when session is running', async () => {
    activeSessions.set(new Map([['T-42', { ...baseSession, status: 'running' }]]))
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Start Implementation')).toBeTruthy()
    })
    const button = screen.getByText('Start Implementation').closest('button')
    expect(button?.disabled).toBe(true)
    expect(button?.title).toBe('Agent is busy')
    activeSessions.set(new Map())
  })

  it('action buttons enabled when no active session', async () => {
    activeSessions.set(new Map())
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Start Implementation')).toBeTruthy()
    })
    const button = screen.getByText('Start Implementation').closest('button')
    expect(button?.disabled).toBe(false)
  })

})
