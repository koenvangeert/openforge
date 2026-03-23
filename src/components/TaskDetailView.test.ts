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
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'

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
  taskReviewModes: writable(new Map()),
  taskDraftNotes: writable(new Map()),
  commandHeld: writable(false),
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
    terminal: { write: vi.fn(), dispose: vi.fn(), reset: vi.fn(), cols: 80, rows: 24, options: { theme: {} }, focus: vi.fn() },
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
  releaseAllForTask: vi.fn().mockReturnValue(0),
  focusTerminal: vi.fn(),
}))

vi.mock('../lib/navigation', () => ({
  resetToBoard: vi.fn(),
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
import { activeSessions, taskReviewModes, commandHeld } from '../lib/stores'

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

  it('shows TaskInfoPanel by default', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('// INITIAL_PROMPT')).toBeTruthy()
  })

  it('Info panel always visible in code_view mode (no tab toggle)', async () => {
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('// INITIAL_PROMPT')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /^Info$/ })).toBeNull()
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('bottom panel NOT visible initially', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.queryByTestId('resizable-bottom-panel')).toBeNull()
    })
  })

  it('rightPanelMode state does NOT exist — Info always visible', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('// INITIAL_PROMPT')).toBeTruthy()
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

  it('⌘J opens bottom panel', async () => {
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())

    expect(screen.queryByTestId('resizable-bottom-panel')).toBeNull()

    await fireEvent.keyDown(window, { code: 'KeyJ', metaKey: true })

    await waitFor(() => {
      expect(screen.getByTestId('resizable-bottom-panel')).toBeTruthy()
    })
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('⌘J closes bottom panel when already open', async () => {
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())

    await fireEvent.keyDown(window, { code: 'KeyJ', metaKey: true })
    await waitFor(() => expect(screen.getByTestId('resizable-bottom-panel')).toBeTruthy())

    await fireEvent.keyDown(window, { code: 'KeyJ', metaKey: true })
    await waitFor(() => {
      expect(screen.queryByTestId('resizable-bottom-panel')).toBeNull()
    })
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('⌘+1 when panel closed opens bottom panel', async () => {
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())

    expect(screen.queryByTestId('resizable-bottom-panel')).toBeNull()

    await fireEvent.keyDown(window, { code: 'Digit1', metaKey: true, shiftKey: false })

    await waitFor(() => {
      expect(screen.getByTestId('resizable-bottom-panel')).toBeTruthy()
    })
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('⌘+Shift+1 → code_view (NOT terminal tab)', async () => {
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('review_view')).toBeTruthy())

    await fireEvent.keyDown(window, { code: 'Digit2', metaKey: true, shiftKey: true })
    const breadcrumb = screen.getByText('$ cd board').closest('div')
    await waitFor(() => expect(breadcrumb?.textContent).toContain('self_review'))

    await fireEvent.keyDown(window, { code: 'Digit1', metaKey: true, shiftKey: true })
    await waitFor(() => {
      expect(breadcrumb?.textContent).toContain('code')
      expect(breadcrumb?.textContent).not.toContain('self_review')
    })
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('⌘+Shift+2 → review_view (NOT terminal tab)', async () => {
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('review_view')).toBeTruthy())

    const breadcrumb = screen.getByText('$ cd board').closest('div')
    expect(breadcrumb?.textContent).toContain('code')

    await fireEvent.keyDown(window, { code: 'Digit2', metaKey: true, shiftKey: true })
    await waitFor(() => expect(breadcrumb?.textContent).toContain('self_review'))
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('review mode shows SelfReviewView and bottom panel persists', async () => {
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('review_view')).toBeTruthy())

    await fireEvent.keyDown(window, { code: 'KeyJ', metaKey: true })
    await waitFor(() => expect(screen.getByTestId('resizable-bottom-panel')).toBeTruthy())

    await fireEvent.keyDown(window, { code: 'Digit2', metaKey: true, shiftKey: true })
    await waitFor(() => {
      const breadcrumb = screen.getByText('$ cd board').closest('div')
      expect(breadcrumb?.textContent).toContain('self_review')
      expect(screen.getByTestId('resizable-bottom-panel')).toBeTruthy()
    })
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('⌘F toggles fullscreen when bottom panel is open and not in review mode', async () => {
    taskReviewModes.set(new Map())
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())

    await fireEvent.keyDown(window, { code: 'KeyJ', metaKey: true })
    await waitFor(() => expect(screen.getByTestId('resizable-bottom-panel')).toBeTruthy())

    await fireEvent.keyDown(window, { code: 'KeyF', metaKey: true })
    await waitFor(() => {
      expect(screen.getByTestId('fullscreen-terminal')).toBeTruthy()
      expect(screen.queryByTestId('upper-area')).toBeNull()
    })

    await fireEvent.keyDown(window, { code: 'KeyF', metaKey: true })
    await waitFor(() => {
      expect(screen.queryByTestId('fullscreen-terminal')).toBeNull()
      expect(screen.getByTestId('upper-area')).toBeTruthy()
    })
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })

  it('⌘F does nothing when bottom panel is closed', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByTestId('upper-area')).toBeTruthy())
    await fireEvent.keyDown(window, { code: 'KeyF', metaKey: true })
    expect(screen.queryByTestId('fullscreen-terminal')).toBeNull()
    expect(screen.getByTestId('upper-area')).toBeTruthy()
  })

  it('⌘J exits fullscreen first when terminalFullscreen is true', async () => {
    taskReviewModes.set(new Map())
    const { getWorktreeForTask } = await import('../lib/ipc')
    vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' } as any)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())

    await fireEvent.keyDown(window, { code: 'KeyJ', metaKey: true })
    await waitFor(() => expect(screen.getByTestId('resizable-bottom-panel')).toBeTruthy())

    await fireEvent.keyDown(window, { code: 'KeyF', metaKey: true })
    await waitFor(() => {
      expect(screen.getByTestId('fullscreen-terminal')).toBeTruthy()
      expect(screen.queryByTestId('upper-area')).toBeNull()
    })

    await fireEvent.keyDown(window, { code: 'KeyJ', metaKey: true })
    await waitFor(() => {
      expect(screen.queryByTestId('fullscreen-terminal')).toBeNull()
      expect(screen.getByTestId('upper-area')).toBeTruthy()
      expect(screen.getByTestId('resizable-bottom-panel')).toBeTruthy()
    })
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
  })



  it('navigates to board when task is moved to done', async () => {
    const doingTask: Task = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await fireEvent.click(screen.getByText('Move to Done'))
    const { updateTaskStatus } = await import('../lib/ipc')
    const { resetToBoard } = await import('../lib/navigation')
    expect(updateTaskStatus).toHaveBeenCalledWith('T-42', 'done')
    expect(resetToBoard).toHaveBeenCalled()
  })

  it('shows action buttons in dropdown when actions exist', async () => {
    const { loadActions } = await import('../lib/actions')
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: 'Implement the task', builtin: true, enabled: true },
    ])
    const doingTask = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })
  })

  it('action button triggers onRunAction with correct prompt', async () => {
    mockOnRunAction.mockClear()
    const { loadActions } = await import('../lib/actions')
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: 'Implement the task', builtin: true, enabled: true },
    ])
    const doingTask = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })
    await fireEvent.click(screen.getByText('Go'))
    expect(mockOnRunAction).toHaveBeenCalledWith({ taskId: 'T-42', actionPrompt: 'Implement the task', agent: null })
  })

  describe('keyboard shortcuts', () => {
    beforeEach(() => {
      taskReviewModes.set(new Map())
    })

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

    it('Cmd+Shift+2 switches to review mode when worktree exists', async () => {
      const { getWorktreeForTask } = await import('../lib/ipc')
      vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      const breadcrumb = screen.getByText('$ cd board').closest('div')
      expect(breadcrumb?.textContent).toContain('code')

      await fireEvent.keyDown(window, { code: 'Digit2', metaKey: true, shiftKey: true })

      await waitFor(() => {
        expect(breadcrumb?.textContent).toContain('self_review')
      })

      vi.mocked(getWorktreeForTask).mockResolvedValue(null)
    })

    it('Cmd+Shift+1 switches back to code mode from review', async () => {
      const { getWorktreeForTask } = await import('../lib/ipc')
      vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      await fireEvent.keyDown(window, { code: 'Digit2', metaKey: true, shiftKey: true })
      const breadcrumb = screen.getByText('$ cd board').closest('div')
      await waitFor(() => {
        expect(breadcrumb?.textContent).toContain('self_review')
      })

      await fireEvent.keyDown(window, { code: 'Digit1', metaKey: true, shiftKey: true })
      await waitFor(() => {
        expect(breadcrumb?.textContent).toContain('code')
        expect(breadcrumb?.textContent).not.toContain('self_review')
      })

      vi.mocked(getWorktreeForTask).mockResolvedValue(null)
    })

    it('Cmd+Shift+1/2 work even when an input element is focused', async () => {
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

        await fireEvent.keyDown(window, { code: 'Digit2', metaKey: true, shiftKey: true })
        await waitFor(() => {
          expect(breadcrumb?.textContent).toContain('self_review')
        })

        await fireEvent.keyDown(window, { code: 'Digit1', metaKey: true, shiftKey: true })
        await waitFor(() => {
          expect(breadcrumb?.textContent).toContain('code')
        })
      } finally {
        document.body.removeChild(input)
        vi.mocked(getWorktreeForTask).mockResolvedValue(null)
      }
    })

    it('Cmd+Shift+1/2 are ignored when no worktree exists', async () => {
      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

      const breadcrumb = screen.getByText('$ cd board').closest('div')
      expect(breadcrumb?.textContent).toContain('code')

      await fireEvent.keyDown(window, { code: 'Digit2', metaKey: true, shiftKey: true })
      expect(breadcrumb?.textContent).toContain('code')
      expect(breadcrumb?.textContent).not.toContain('self_review')
    })

    it('Cmd+1 (without shift) does not switch to code mode', async () => {
      const { getWorktreeForTask } = await import('../lib/ipc')
      vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      const breadcrumb = screen.getByText('$ cd board').closest('div')

      await fireEvent.keyDown(window, { code: 'Digit2', metaKey: true, shiftKey: true })
      await waitFor(() => {
        expect(breadcrumb?.textContent).toContain('self_review')
      })

      await fireEvent.keyDown(window, { code: 'Digit1', metaKey: true, shiftKey: false })
      expect(breadcrumb?.textContent).toContain('self_review')

      vi.mocked(getWorktreeForTask).mockResolvedValue(null)
    })

    it('Cmd+2 (without shift) does not switch to review mode', async () => {
      const { getWorktreeForTask } = await import('../lib/ipc')
      vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      const breadcrumb = screen.getByText('$ cd board').closest('div')
      await waitFor(() => {
        expect(breadcrumb?.textContent).toContain('code')
      })

      await fireEvent.keyDown(window, { code: 'Digit2', metaKey: true, shiftKey: false })
      await waitFor(() => {
        expect(breadcrumb?.textContent).toContain('code')
        expect(breadcrumb?.textContent).not.toContain('self_review')
      })

      vi.mocked(getWorktreeForTask).mockResolvedValue(null)
    })

    it('shows shortcut hints on view toggle buttons when CMD is held', async () => {
      const { getWorktreeForTask } = await import('../lib/ipc')
      vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      commandHeld.set(true)

      await waitFor(() => {
        const codeBtn = screen.getByText('code_view').closest('button')
        const reviewBtn = screen.getByText('review_view').closest('button')
        expect(codeBtn?.textContent).toContain('⌘⇧1')
        expect(reviewBtn?.textContent).toContain('⌘⇧2')
      })

      commandHeld.set(false)
      vi.mocked(getWorktreeForTask).mockResolvedValue(null)
    })

    it('hides shortcut hints on view toggle buttons when CMD is not held', async () => {
      const { getWorktreeForTask } = await import('../lib/ipc')
      vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      commandHeld.set(false)

      await waitFor(() => {
        const codeBtn = screen.getByText('code_view').closest('button')
        const reviewBtn = screen.getByText('review_view').closest('button')
        expect(codeBtn?.textContent).not.toContain('⌘⇧1')
        expect(reviewBtn?.textContent).not.toContain('⌘⇧2')
      })

      vi.mocked(getWorktreeForTask).mockResolvedValue(null)
    })

    it('Escape triggers reset to board', async () => {
      const { resetToBoard } = await import('../lib/navigation')
      vi.mocked(resetToBoard).mockClear()
      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

      await fireEvent.keyDown(window, { key: 'Escape' })

      expect(resetToBoard).toHaveBeenCalled()
    })

     it('q triggers reset to board', async () => {
       const { resetToBoard } = await import('../lib/navigation')
       vi.mocked(resetToBoard).mockClear()
       render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

       await fireEvent.keyDown(window, { key: 'q' })

       expect(resetToBoard).toHaveBeenCalled()
     })
   })

   describe('review mode persistence', () => {
     beforeEach(() => {
       taskReviewModes.set(new Map())
     })

     it('l key writes true to taskReviewModes store for the task', async () => {
       const { getWorktreeForTask } = await import('../lib/ipc')
       vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

       render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
       await waitFor(() => expect(screen.getByText('review_view')).toBeTruthy())

       await fireEvent.keyDown(window, { key: 'l' })

       await waitFor(() => {
         expect(get(taskReviewModes).get('T-42')).toBe(true)
       })

       vi.mocked(getWorktreeForTask).mockResolvedValue(null)
     })

     it('h key writes false to taskReviewModes store for the task', async () => {
       const { getWorktreeForTask } = await import('../lib/ipc')
       vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

       taskReviewModes.set(new Map([['T-42', true]]))
       render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
       await waitFor(() => expect(screen.getByText('review_view')).toBeTruthy())

       await fireEvent.keyDown(window, { key: 'h' })

       await waitFor(() => {
         expect(get(taskReviewModes).get('T-42')).toBe(false)
       })

       vi.mocked(getWorktreeForTask).mockResolvedValue(null)
     })

     it('restores review mode from store when task is rendered', async () => {
       const { getWorktreeForTask } = await import('../lib/ipc')
       vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

       taskReviewModes.set(new Map([['T-42', true]]))
       render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

       await waitFor(() => {
         const breadcrumb = screen.getByText('$ cd board').closest('div')
         expect(breadcrumb?.textContent).toContain('self_review')
       })

       vi.mocked(getWorktreeForTask).mockResolvedValue(null)
     })

     it('review mode is task-scoped: Task A review does not affect Task B', async () => {
       const { getWorktreeForTask } = await import('../lib/ipc')
       vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)

       taskReviewModes.set(new Map([['T-42', true]]))
       const taskB = { ...baseTask, id: 'T-99', initial_prompt: 'Task B', jira_key: null }
       render(TaskDetailView, { props: { task: taskB, onRunAction: mockOnRunAction } })

       await waitFor(() => {
         const breadcrumb = screen.getByText('$ cd board').closest('div')
         expect(breadcrumb?.textContent).toContain('code')
         expect(breadcrumb?.textContent).not.toContain('self_review')
       })

        vi.mocked(getWorktreeForTask).mockResolvedValue(null)
      })
    })

    describe('terminal cleanup on navigate-away', () => {
      it('calls releaseAllForTask when component unmounts', async () => {
        const { getWorktreeForTask } = await import('../lib/ipc')
        const { releaseAllForTask } = await import('../lib/terminalPool')
        
        vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)
        vi.mocked(releaseAllForTask).mockClear()
        
        const { unmount } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
        
        await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())
        
        unmount()
        
        expect(releaseAllForTask).toHaveBeenCalledWith('T-42')
        
        vi.mocked(getWorktreeForTask).mockResolvedValue(null)
      })

      it('calls releaseAllForTask when task prop changes', async () => {
        const { getWorktreeForTask } = await import('../lib/ipc')
        const { releaseAllForTask } = await import('../lib/terminalPool')
        
        vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)
        vi.mocked(releaseAllForTask).mockClear()
        
        const { rerender } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
        
        await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())
        
        const newTask = { ...baseTask, id: 'T-99', initial_prompt: 'New task' }
        rerender({ task: newTask, onRunAction: mockOnRunAction })
        
        await waitFor(() => {
          expect(releaseAllForTask).toHaveBeenCalledWith('T-42')
        })
        
        vi.mocked(getWorktreeForTask).mockResolvedValue(null)
      })

      it('cleanup only releases shell entries, not agent terminal', async () => {
        const { getWorktreeForTask } = await import('../lib/ipc')
        const { releaseAllForTask } = await import('../lib/terminalPool')
        
        vi.mocked(getWorktreeForTask).mockResolvedValue({ worktree_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' } as any)
        vi.mocked(releaseAllForTask).mockClear()
        
        const { unmount } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
        
        await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())
        
        unmount()
        
        expect(releaseAllForTask).toHaveBeenCalledWith('T-42')
        
        vi.mocked(getWorktreeForTask).mockResolvedValue(null)
      })
    })

})
