// Mock xterm.js — provide a minimal Terminal stub
vi.mock('@xterm/xterm', () => {
  const Terminal = vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    loadAddon: vi.fn(),
    refresh: vi.fn(),
    cols: 80,
    rows: 24,
  }))
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  const FitAddon = vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
  }))
  return { FitAddon }
})

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

vi.mock('../lib/audioRecorder', () => ({
  createAudioRecorder: vi.fn(),
}))

// Mock composables to avoid xterm constructor issues in test environment
vi.mock('../lib/useTerminal.svelte', () => ({
  createTerminal: vi.fn(() => ({
    get terminalEl() { return null },
    set terminalEl(_el: HTMLDivElement | null) {},
    get terminal() { return null },
    get terminalMounted() { return false },
    mount: vi.fn().mockResolvedValue(undefined),
    safeFit: vi.fn(),
    dispose: vi.fn(),
  })),
}))

vi.mock('../lib/usePtyBridge.svelte', () => ({
  createPtyBridge: vi.fn(() => ({
    get ptySpawned() { return false },
    attachPty: vi.fn().mockResolvedValue(undefined),
    writeToPty: vi.fn(),
    killPty: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  })),
}))

vi.mock('../lib/useSessionHistory.svelte', () => ({
  createSessionHistory: vi.fn(() => ({
    get loadingHistory() { return false },
    get storedEvents() { return [] },
    loadSessionHistory: vi.fn().mockResolvedValue(undefined),
  })),
}))

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
  getConfig: vi.fn().mockResolvedValue(''),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  setProjectConfig: vi.fn().mockResolvedValue(undefined),
  getLatestSession: vi.fn().mockResolvedValue(null),
  getAgentLogs: vi.fn().mockResolvedValue([]),
  spawnPty: vi.fn().mockResolvedValue(1),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  killPty: vi.fn().mockResolvedValue(undefined),
  transcribeAudio: vi.fn(),
  getWhisperModelStatus: vi.fn(),
  downloadWhisperModel: vi.fn(),
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
  jira_description: null,
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
  provider: 'opencode',
  claude_session_id: null,
}

describe('TaskDetailView', () => {
  it('renders back button with "Back" text', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('Back')).toBeTruthy()
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

  it('has AgentPanel child with empty state text', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await vi.waitFor(() => {
      expect(screen.getByText('No active agent session')).toBeTruthy()
    })
  })

  it('has TaskInfoPanel child with Initial Prompt section', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('Initial Prompt')).toBeTruthy()
  })

  it('shows Move to Done button when task is not done', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('Move to Done')).toBeTruthy()
  })

  it('hides Move to Done button when task is already done', () => {
    const doneTask = { ...baseTask, status: 'done' }
    render(TaskDetailView, { props: { task: doneTask, onRunAction: mockOnRunAction } })
    expect(screen.queryByText('Move to Done')).toBeNull()
  })

  it('hides Review toggle when no worktree', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.queryByText('review_view')).toBeNull()
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

  it('renders breadcrumb with board path segment', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('$ cd board')).toBeTruthy()
  })

  it('renders breadcrumb with task status segment', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    const breadcrumbRoot = screen.getByText('$ cd board').closest('div')
    expect(breadcrumbRoot?.textContent).toContain('backlog')
  })

  it('renders breadcrumb with task identifier', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    const breadcrumbRoot = screen.getByText('$ cd board').closest('div')
    expect(breadcrumbRoot?.textContent).toContain('PROJ-123')
  })

  it('renders breadcrumb with code segment by default', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    const breadcrumbRoot = screen.getByText('$ cd board').closest('div')
    expect(breadcrumbRoot?.textContent).toContain('code')
  })

  it('renders breadcrumb with task id when no jira_key', () => {
    const taskWithoutJira = { ...baseTask, jira_key: null }
    render(TaskDetailView, { props: { task: taskWithoutJira, onRunAction: mockOnRunAction } })
    const breadcrumbRoot = screen.getByText('$ cd board').closest('div')
    expect(breadcrumbRoot?.textContent).toContain('T-42')
  })

  it('renders subtitle row even when jira_title is null', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    const subtitleRow = screen.getByTestId('subtitle-row')
    expect(subtitleRow).toBeTruthy()
  })

  it('renders jira_title in subtitle when available', () => {
    const taskWithJiraTitle = { ...baseTask, jira_title: 'Some Jira Title' }
    render(TaskDetailView, { props: { task: taskWithJiraTitle, onRunAction: mockOnRunAction } })
    expect(screen.getByText('Some Jira Title')).toBeTruthy()
  })

})
