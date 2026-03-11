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
    loadSessionHistory: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../lib/useDiffLoader.svelte', () => ({
  createDiffLoader: vi.fn(() => ({
    get isLoading() { return false },
    get error() { return null },
    get prComments() { return [] },
    get linkedPr() { return null },
    loadDiff: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
  })),
}))

vi.mock('../lib/useCommentSelection.svelte', () => ({
  createCommentSelection: vi.fn(() => ({
    get selectedCount() { return 0 },
    get unaddressedCount() { return 0 },
    get addressedCount() { return 0 },
    get selectedPrCommentIds() { return new Set() },
    get unaddressedComments() { return [] },
    get selectedPrComments() { return [] },
    toggleSelected: vi.fn(),
    selectAll: vi.fn(),
    deselectAll: vi.fn(),
    markAddressed: vi.fn(),
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
  startingTasks: writable(new Set()),
  selfReviewDiffFiles: writable([]),
  selfReviewGeneralComments: writable([]),
  selfReviewArchivedComments: writable([]),
  pendingManualComments: writable([]),
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
  spawnPty: vi.fn().mockResolvedValue(1),
  spawnShellPty: vi.fn().mockResolvedValue(1),
  getPtyBuffer: vi.fn().mockResolvedValue(null),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  killPty: vi.fn().mockResolvedValue(undefined),
  transcribeAudio: vi.fn(),
  getWhisperModelStatus: vi.fn(),
  downloadWhisperModel: vi.fn(),
  getTaskDiff: vi.fn().mockResolvedValue([]),
  getActiveSelfReviewComments: vi.fn().mockResolvedValue([]),
  getArchivedSelfReviewComments: vi.fn().mockResolvedValue([]),
  getTaskFileContents: vi.fn().mockResolvedValue(['', '']),
  getTaskBatchFileContents: vi.fn().mockResolvedValue([]),
  archiveSelfReviewComments: vi.fn().mockResolvedValue(undefined),
  addSelfReviewComment: vi.fn().mockResolvedValue(undefined),
  deleteSelfReviewComment: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('../lib/terminalPool', () => ({
  acquire: vi.fn().mockResolvedValue({
    taskId: '',
    terminal: { write: vi.fn(), dispose: vi.fn(), reset: vi.fn(), cols: 80, rows: 24, options: { theme: {} } },
    fitAddon: { fit: vi.fn() },
    hostDiv: document.createElement('div'),
    ptyActive: false,
    needsClear: false,
    unlisteners: [],
    resizeObserver: null,
    visibilityObserver: null,
    resizeTimeout: null,
    attached: false,
  }),
  attach: vi.fn(),
  detach: vi.fn(),
  release: vi.fn(),
}))

vi.mock('../lib/navigation', () => ({
  navigateBack: vi.fn(() => false),
  pushNavState: vi.fn(),
}))

vi.mock('../lib/actions', () => ({
  loadActions: vi.fn(() => Promise.resolve([
    { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
  ])),
  getEnabledActions: vi.fn((actions: { enabled: boolean }[]) => actions.filter(a => a.enabled)),
}))

import TaskDetailView from './TaskDetailView.svelte'
import type { Task, AgentSession } from '../lib/types'
import { activeSessions, selectedTaskId } from '../lib/stores'

const baseTask: Task = {
  id: 'T-42',
  initial_prompt: 'Implement auth middleware',
  status: 'backlog',
  jira_key: 'PROJ-123',
  jira_title: null,
  jira_status: 'To Do',
  jira_assignee: 'Alice',
  jira_description: null,
  prompt: null,
  summary: null,
  agent: null,
  permission_mode: null,
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
  it('renders back button with "back" text', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('back')).toBeTruthy()
  })

  it('renders task jira_key when present', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    const matches = screen.getAllByText('PROJ-123')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('renders task id when jira_key is null', () => {
    const taskWithoutJira = { ...baseTask, jira_key: null }
    render(TaskDetailView, { props: { task: taskWithoutJira, onRunAction: mockOnRunAction } })
    const matches = screen.getAllByText('T-42')
    expect(matches.length).toBeGreaterThanOrEqual(1)
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
    expect(screen.getByText('// INITIAL_PROMPT')).toBeTruthy()
  })

  it('shows Start Task button for backlog tasks', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('Start Task')).toBeTruthy()
    expect(screen.queryByText('Move to Done')).toBeNull()
  })

  it('hides all action buttons for done tasks', () => {
    const doneTask = { ...baseTask, status: 'done' }
    render(TaskDetailView, { props: { task: doneTask, onRunAction: mockOnRunAction } })
    expect(screen.queryByText('Move to Done')).toBeNull()
    expect(screen.queryByText('Start Task')).toBeNull()
    expect(screen.queryByText('Go')).toBeNull()
  })

  it('Start Task calls onRunAction with empty prompt', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    fireEvent.click(screen.getByText('Start Task'))
    expect(mockOnRunAction).toHaveBeenCalledWith({ taskId: 'T-42', actionPrompt: '', agent: null })
  })

  it('shows Move to Done and action buttons for doing tasks', async () => {
    const doingTask = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('Move to Done')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })
    expect(screen.queryByText('Start Task')).toBeNull()
  })

  it('hides Review toggle when no worktree', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.queryByText('review_view')).toBeNull()
    })
  })

  it('renders action buttons in header', async () => {
    const doingTask = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })
  })

  it('calls onRunAction when action button clicked', async () => {
    const doingTask = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })
    await fireEvent.click(screen.getByText('Go'))
    expect(mockOnRunAction).toHaveBeenCalledWith({ taskId: 'T-42', actionPrompt: '', agent: null })
  })

  it('action buttons stay enabled when session is running (prompt sent to active PTY)', async () => {
    const doingTask = { ...baseTask, status: 'doing' }
    activeSessions.set(new Map([['T-42', { ...baseSession, status: 'running' }]]))
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })
    const button = screen.getByText('Go').closest('button')
    expect(button?.disabled).toBe(false)
    activeSessions.set(new Map())
  })

  it('action buttons enabled when no active session', async () => {
    const doingTask = { ...baseTask, status: 'doing' }
    activeSessions.set(new Map())
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })
    const button = screen.getByText('Go').closest('button')
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

  it('shows terminal toggle when worktree exists', async () => {
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Info')).toBeTruthy()
      expect(screen.getByText('Terminal')).toBeTruthy()
    })
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('hides terminal toggle when no worktree', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.queryByText('Terminal')).toBeNull()
    })
  })

  it('shows TaskInfoPanel by default', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('// INITIAL_PROMPT')).toBeTruthy()
  })

  it('switches to terminal view when Terminal tab clicked', async () => {
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Terminal')).toBeTruthy()
    })
    await fireEvent.click(screen.getByText('Terminal'))
    await waitFor(() => {
      const shellWrapper = document.querySelector('.shell-terminal-wrapper')
      expect(shellWrapper).toBeTruthy()
    })
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('falls back to first line of prompt when title is empty', () => {
    const taskNoTitle = { ...baseTask, initial_prompt: '', prompt: 'First prompt line\nSecond line' }
    render(TaskDetailView, { props: { task: taskNoTitle, onRunAction: mockOnRunAction } })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('First prompt line')
  })

  it('falls back to task id when title and prompt are both empty/null', () => {
    const taskNoTitleNoPrompt = { ...baseTask, initial_prompt: '', prompt: null }
    render(TaskDetailView, { props: { task: taskNoTitleNoPrompt, onRunAction: mockOnRunAction } })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('T-42')
  })

  it('recreates agent panel terminal when switching tasks', async () => {
    const { acquire, detach } = await import('../lib/terminalPool')
    vi.mocked(acquire).mockClear()
    vi.mocked(detach).mockClear()

    const taskA = { ...baseTask, id: 'T-42' }
    const { rerender } = render(TaskDetailView, { props: { task: taskA, onRunAction: mockOnRunAction } })

    // Wait for AgentPanel to mount and acquire terminal for T-42
    await vi.waitFor(() => {
      expect(vi.mocked(acquire)).toHaveBeenCalledWith('T-42')
    })

    vi.mocked(acquire).mockClear()
    vi.mocked(detach).mockClear()

    // Switch to a different task
    const taskB = { ...baseTask, id: 'T-99', initial_prompt: 'Another task' }
    await rerender({ task: taskB, onRunAction: mockOnRunAction })

    // Agent panel should be recreated, acquiring terminal for the new task
    await vi.waitFor(() => {
      expect(vi.mocked(acquire)).toHaveBeenCalledWith('T-99')
    })

    // Old terminal should have been detached
    expect(vi.mocked(detach)).toHaveBeenCalled()
  })

  it('shows fullscreen button when terminal tab is active and worktree exists', async () => {
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Terminal')).toBeTruthy()
    })
    await fireEvent.click(screen.getByText('Terminal'))
    await waitFor(() => {
      expect(screen.getByLabelText('Fullscreen terminal')).toBeTruthy()
    })
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('hides fullscreen button when info tab is active', async () => {
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Info')).toBeTruthy()
    })
    // Info tab is default — fullscreen button should not be visible
    expect(screen.queryByLabelText('Fullscreen terminal')).toBeNull()
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('clicking fullscreen hides AgentPanel and shows terminal filling content area', async () => {
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Terminal')).toBeTruthy()
    })
    await fireEvent.click(screen.getByText('Terminal'))
    await waitFor(() => {
      expect(screen.getByLabelText('Fullscreen terminal')).toBeTruthy()
    })
    await fireEvent.click(screen.getByLabelText('Fullscreen terminal'))
    await waitFor(() => {
      // Fullscreen container should be visible with minimize button
      expect(screen.getByLabelText('Exit fullscreen')).toBeTruthy()
      // AgentPanel's empty state should not be visible
      expect(screen.queryByText('No active agent session')).toBeNull()
    })
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('clicking minimize exits fullscreen and restores normal layout', async () => {
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Terminal')).toBeTruthy()
    })
    await fireEvent.click(screen.getByText('Terminal'))
    await waitFor(() => {
      expect(screen.getByLabelText('Fullscreen terminal')).toBeTruthy()
    })
    await fireEvent.click(screen.getByLabelText('Fullscreen terminal'))
    await waitFor(() => {
      expect(screen.getByLabelText('Exit fullscreen')).toBeTruthy()
    })
    // Click minimize
    await fireEvent.click(screen.getByLabelText('Exit fullscreen'))
    await waitFor(() => {
      // Should be back to normal layout with AgentPanel
      expect(screen.getByText('No active agent session')).toBeTruthy()
      // Fullscreen button should reappear (still on terminal tab)
      expect(screen.getByLabelText('Fullscreen terminal')).toBeTruthy()
    })
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('Cmd+f toggles fullscreen when terminal tab is active', async () => {
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Terminal')).toBeTruthy()
    })
    await fireEvent.click(screen.getByText('Terminal'))
    await waitFor(() => {
      expect(screen.getByLabelText('Fullscreen terminal')).toBeTruthy()
    })

    // Press Cmd+f to enter fullscreen
    await fireEvent.keyDown(window, { key: 'f', metaKey: true })
    await waitFor(() => {
      expect(screen.getByLabelText('Exit fullscreen')).toBeTruthy()
    })

    // Press Cmd+f again to exit fullscreen
    await fireEvent.keyDown(window, { key: 'f', metaKey: true })
    await waitFor(() => {
      expect(screen.getByLabelText('Fullscreen terminal')).toBeTruthy()
      expect(screen.queryByLabelText('Exit fullscreen')).toBeNull()
    })
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('Cmd+f does nothing when no worktree or on info tab', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    // No worktree — Cmd+f should not create fullscreen elements
    await fireEvent.keyDown(window, { key: 'f', metaKey: true })
    expect(screen.queryByLabelText('Exit fullscreen')).toBeNull()
    expect(screen.queryByLabelText('Fullscreen terminal')).toBeNull()
  })

  it('] switches from info to terminal tab', async () => {
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Info')).toBeTruthy()
    })
    // Default is info tab — press ] to switch to terminal
    await fireEvent.keyDown(window, { key: ']' })
    await waitFor(() => {
      const shellWrapper = document.querySelector('.shell-terminal-wrapper')
      expect(shellWrapper).toBeTruthy()
    })
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('[ switches from terminal to info tab', async () => {
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Terminal')).toBeTruthy()
    })
    // Switch to terminal first
    await fireEvent.click(screen.getByText('Terminal'))
    await waitFor(() => {
      const shellWrapper = document.querySelector('.shell-terminal-wrapper')
      expect(shellWrapper).toBeTruthy()
    })
    // Press [ to switch back to info
    await fireEvent.keyDown(window, { key: '[' })
    await waitFor(() => {
      expect(screen.getByText('// INITIAL_PROMPT')).toBeTruthy()
    })
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('[/] does nothing when no worktree', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    // No worktree — ] should not cause errors or show terminal
    await fireEvent.keyDown(window, { key: ']' })
    expect(screen.queryByText('Terminal')).toBeNull()
  })

  it('does not navigate away when task is moved to done', async () => {
    const doingTask: Task = { ...baseTask, status: 'doing' }
    selectedTaskId.set('T-42')
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await fireEvent.click(screen.getByText('Move to Done'))
    const { updateTaskStatus } = await import('../lib/ipc')
    expect(updateTaskStatus).toHaveBeenCalledWith('T-42', 'done')
    let currentValue: string | null = null
    selectedTaskId.subscribe(v => { currentValue = v })()
    expect(currentValue).toBe('T-42')
  })

  it('shows action prompt as tooltip when prompt is set', async () => {
    const { loadActions } = await import('../lib/actions')
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: 'Implement the task', builtin: true, enabled: true },
    ])
    const doingTask = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await vi.waitFor(() => {
      const goButton = screen.getByText('Go')
      expect(goButton.getAttribute('title')).toBe('Implement the task')
    })
  })

  it('shows action name as tooltip when prompt is empty', async () => {
    const { loadActions } = await import('../lib/actions')
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])
    const doingTask = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await vi.waitFor(() => {
      const goButton = screen.getByText('Go')
      expect(goButton.getAttribute('title')).toBe('Go')
    })
  })

  describe('keyboard shortcuts', () => {
    it('l key switches to review mode when worktree exists', async () => {
      const { getWorktreeForTask } = await import('../lib/ipc')
      vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      const breadcrumb = screen.getByText('$ cd board').closest('div')
      expect(breadcrumb?.textContent).toContain('code')

      await fireEvent.keyDown(window, { key: 'l' })

      await waitFor(() => {
        expect(breadcrumb?.textContent).toContain('self_review')
      })

      vi.mocked(getWorktreeForTask).mockResolvedValue(null)
    })

    it('h key switches back to code mode from review', async () => {
      const { getWorktreeForTask } = await import('../lib/ipc')
      vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      await fireEvent.keyDown(window, { key: 'l' })
      const breadcrumb = screen.getByText('$ cd board').closest('div')
      await waitFor(() => {
        expect(breadcrumb?.textContent).toContain('self_review')
      })

      await fireEvent.keyDown(window, { key: 'h' })
      await waitFor(() => {
        expect(breadcrumb?.textContent).toContain('code')
        expect(breadcrumb?.textContent).not.toContain('self_review')
      })

      vi.mocked(getWorktreeForTask).mockResolvedValue(null)
    })

    it('h and l keys are ignored when no worktree exists', async () => {
      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

      const breadcrumb = screen.getByText('$ cd board').closest('div')
      expect(breadcrumb?.textContent).toContain('code')

      await fireEvent.keyDown(window, { key: 'l' })
      expect(breadcrumb?.textContent).toContain('code')
      expect(breadcrumb?.textContent).not.toContain('self_review')
    })

    it('h and l keys are ignored when modifier keys are held', async () => {
      const { getWorktreeForTask } = await import('../lib/ipc')
      vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      const breadcrumb = screen.getByText('$ cd board').closest('div')

      await fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
      expect(breadcrumb?.textContent).toContain('code')

      await fireEvent.keyDown(window, { key: 'l', metaKey: true })
      expect(breadcrumb?.textContent).toContain('code')

      await fireEvent.keyDown(window, { key: 'l', altKey: true })
      expect(breadcrumb?.textContent).toContain('code')

      vi.mocked(getWorktreeForTask).mockResolvedValue(null)
    })

    it('Cmd+2 switches to review mode when worktree exists', async () => {
      const { getWorktreeForTask } = await import('../lib/ipc')
      vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      const breadcrumb = screen.getByText('$ cd board').closest('div')
      expect(breadcrumb?.textContent).toContain('code')

      await fireEvent.keyDown(window, { key: '2', metaKey: true })

      await waitFor(() => {
        expect(breadcrumb?.textContent).toContain('self_review')
      })

      vi.mocked(getWorktreeForTask).mockResolvedValue(null)
    })

    it('Cmd+1 switches back to code mode from review', async () => {
      const { getWorktreeForTask } = await import('../lib/ipc')
      vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      await fireEvent.keyDown(window, { key: '2', metaKey: true })
      const breadcrumb = screen.getByText('$ cd board').closest('div')
      await waitFor(() => {
        expect(breadcrumb?.textContent).toContain('self_review')
      })

      await fireEvent.keyDown(window, { key: '1', metaKey: true })
      await waitFor(() => {
        expect(breadcrumb?.textContent).toContain('code')
        expect(breadcrumb?.textContent).not.toContain('self_review')
      })

      vi.mocked(getWorktreeForTask).mockResolvedValue(null)
    })

    it('Cmd+1/2 work even when an input element is focused', async () => {
      const { getWorktreeForTask } = await import('../lib/ipc')
      vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      // Simulate terminal focus by focusing an input element
      const input = document.createElement('input')
      document.body.appendChild(input)

      try {
        input.focus()

        const breadcrumb = screen.getByText('$ cd board').closest('div')

        await fireEvent.keyDown(window, { key: '2', metaKey: true })
        await waitFor(() => {
          expect(breadcrumb?.textContent).toContain('self_review')
        })

        await fireEvent.keyDown(window, { key: '1', metaKey: true })
        await waitFor(() => {
          expect(breadcrumb?.textContent).toContain('code')
        })
      } finally {
        document.body.removeChild(input)
        vi.mocked(getWorktreeForTask).mockResolvedValue(null)
      }
    })

    it('Cmd+1/2 are ignored when no worktree exists', async () => {
      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

      const breadcrumb = screen.getByText('$ cd board').closest('div')
      expect(breadcrumb?.textContent).toContain('code')

      await fireEvent.keyDown(window, { key: '2', metaKey: true })
      expect(breadcrumb?.textContent).toContain('code')
      expect(breadcrumb?.textContent).not.toContain('self_review')
    })

    it('shows shortcut hints on view toggle buttons', async () => {
      const { getWorktreeForTask } = await import('../lib/ipc')
      vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      const codeBtn = screen.getByText('code_view').closest('button')
      const reviewBtn = screen.getByText('review_view').closest('button')
      expect(codeBtn?.textContent).toContain('⌘1')
      expect(reviewBtn?.textContent).toContain('⌘2')

      vi.mocked(getWorktreeForTask).mockResolvedValue(null)
    })

    it('Escape triggers navigate back', async () => {
      const { navigateBack } = await import('../lib/navigation')
      vi.mocked(navigateBack).mockClear()
      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

      await fireEvent.keyDown(window, { key: 'Escape' })

      expect(navigateBack).toHaveBeenCalled()
    })

    it('q triggers navigate back', async () => {
      const { navigateBack } = await import('../lib/navigation')
      vi.mocked(navigateBack).mockClear()
      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

      await fireEvent.keyDown(window, { key: 'q' })

      expect(navigateBack).toHaveBeenCalled()
    })
  })
})
