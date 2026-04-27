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

vi.mock('../../lib/audioRecorder', () => ({
  createAudioRecorder: vi.fn(),
}))

vi.mock('../../lib/usePtyBridge.svelte', () => ({
  createPtyBridge: vi.fn(() => ({
    get ptySpawned() { return false },
    attachPty: vi.fn().mockResolvedValue(undefined),
    writeToPty: vi.fn(),
    killPty: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  })),
}))

vi.mock('../../lib/useSessionHistory.svelte', () => ({
  createSessionHistory: vi.fn(() => ({
    get loadingHistory() { return false },
    loadSessionHistory: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../../lib/useDiffLoader.svelte', () => ({
  createDiffLoader: vi.fn(() => ({
    get isLoading() { return false },
    get error() { return null },
    get prComments() { return [] },
    get linkedPr() { return null },
    get commits() { return [] },
    get selectedCommitSha() { return null },
    loadDiff: vi.fn().mockResolvedValue(undefined),
    loadCommits: vi.fn().mockResolvedValue(undefined),
    selectCommit: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
  })),
}))

vi.mock('../../lib/useCommentSelection.svelte', () => ({
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

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { get, writable } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/stores', () => ({
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
  taskActiveView: writable(new Map()),
  taskDraftNotes: writable(new Map()),
  commandHeld: writable(false),
}))

vi.mock('../../lib/ipc', () => ({
  abortImplementation: vi.fn().mockResolvedValue(undefined),
  updateTaskFields: vi.fn().mockResolvedValue(undefined),
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  getTaskWorkspace: vi.fn().mockResolvedValue(null),
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

const { taskTabSessions } = vi.hoisted(() => ({
  taskTabSessions: new Map<string, { tabs: Array<{ index: number, key: string, label: string }>, activeTabIndex: number, nextIndex: number }>(),
}))

vi.mock('../../lib/terminalPool', () => ({
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
    spawnPending: false,
    currentPtyInstance: null,
  }),
  attach: vi.fn(),
  detach: vi.fn(),
  release: vi.fn(),
  releaseAllForTask: vi.fn().mockReturnValue(0),
  focusTerminal: vi.fn(),
  shouldSpawnPty: vi.fn((entry) => !entry.ptyActive && !entry.spawnPending && !entry.needsClear),
  markPtySpawnPending: vi.fn((entry) => {
    entry.spawnPending = true
  }),
  clearPtySpawnPending: vi.fn((entry) => {
    entry.spawnPending = false
  }),
  setCurrentPtyInstance: vi.fn((entry, instanceId) => {
    entry.currentPtyInstance = instanceId
  }),
  getShellLifecycleState: vi.fn((taskId: string) => ({
    ptyActive: false,
    shellExited: false,
    currentPtyInstance: null,
    taskId,
  })),
  updateShellLifecycleState: vi.fn(),
  isShellExited: vi.fn((_taskId: string) => false),
  getTaskTerminalTabsSession: vi.fn((taskId: string) => {
    const existing = taskTabSessions.get(taskId)
    if (existing) return existing
    const session = {
      tabs: [{ index: 0, key: `${taskId}-shell-0`, label: 'Shell 1' }],
      activeTabIndex: 0,
      nextIndex: 1,
    }
    taskTabSessions.set(taskId, session)
    return session
  }),
  updateTaskTerminalTabsSession: vi.fn((taskId: string, session) => {
    taskTabSessions.set(taskId, session)
  }),
  clearTaskTerminalTabsSession: vi.fn((taskId: string) => {
    taskTabSessions.delete(taskId)
  }),
}))

const { mockResetToBoard } = vi.hoisted(() => ({
  mockResetToBoard: vi.fn(),
}))

vi.mock('../../lib/router.svelte', () => ({
  resetToBoard: mockResetToBoard,
  pushNavState: vi.fn(),
  useAppRouter: () => ({
    resetToBoard: mockResetToBoard,
  }),
}))

vi.mock('../../lib/moveToComplete', () => ({
  moveTaskToComplete: vi.fn(async () => undefined),
}))

vi.mock('../../lib/actions', () => ({
  loadActions: vi.fn(() => Promise.resolve([
    { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
  ])),
  getEnabledActions: vi.fn((actions: { enabled: boolean }[]) => actions.filter(a => a.enabled)),
}))

import { activeSessions, taskActiveView, commandHeld } from '../../lib/stores'
import type { Task, AgentSession, TaskWorkspaceInfo } from '../../lib/types'
import PluginSlotTestView from '../plugin/PluginSlotTestView.svelte'
import TerminalTaskPane from './TerminalTaskPane.svelte'
import { clearComponentRegistry, registerRenderableContributionComponent } from '../../lib/plugin/componentRegistry'
import { enabledPluginIds, installedPlugins } from '../../lib/plugin/pluginStore'
import { focusTerminal } from '../../lib/terminalPool'
import { clearTerminalTaskPaneControllers, registerTerminalTaskPaneController } from './terminalTaskPaneController'
import TaskDetailView from './TaskDetailView.svelte'

const TERMINAL_VIEW_ID = 'com.openforge.terminal:terminal'

const baseTask: Task = {
  id: 'T-42',
  initial_prompt: 'Implement auth middleware',
  status: 'backlog',
  prompt: null,
  summary: null,
  agent: null,
  permission_mode: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

const secondaryTask: Task = {
  ...baseTask,
  id: 'T-99',
  initial_prompt: 'Implement audit logging',
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
    pi_session_id: null,
}

function createTaskWorkspaceInfo(overrides: Partial<TaskWorkspaceInfo> = {}): TaskWorkspaceInfo {
  return {
    id: 1,
    task_id: 'T-42',
    project_id: 'project-1',
    repo_path: '/repo',
    workspace_path: '/path/to/worktree',
    kind: 'worktree',
    branch_name: 'branch',
    provider_name: 'opencode',
    opencode_port: null,
    status: 'ready',
    created_at: 1000,
    updated_at: 2000,
    ...overrides,
  }
}

function registerMockTerminalTaskPaneController(taskId: string) {
  registerTerminalTaskPaneController(taskId, {
    addTab() {
      const session = taskTabSessions.get(taskId)
      if (!session) return
      const index = session.nextIndex
      taskTabSessions.set(taskId, {
        tabs: [...session.tabs, { index, key: `${taskId}-shell-${index}`, label: `Shell ${index + 1}` }],
        activeTabIndex: index,
        nextIndex: index + 1,
      })
    },
    async closeActiveTab() {
      return undefined
    },
    focusActiveTab() {
      const session = taskTabSessions.get(taskId)
      const activeTab = session?.tabs.find(tab => tab.index === session.activeTabIndex)
      if (activeTab) {
        focusTerminal(activeTab.key)
      }
    },
    switchToTab(tabIndex: number) {
      const session = taskTabSessions.get(taskId)
      const nextTab = session?.tabs.find(tab => tab.index === tabIndex)
      if (!session || !nextTab) return
      taskTabSessions.set(taskId, { ...session, activeTabIndex: nextTab.index })
      focusTerminal(nextTab.key)
    },
  })
}

describe('createTaskWorkspaceInfo', () => {
  it('applies overrides while keeping a valid typed workspace shape', () => {
    expect(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', branch_name: 'feature/task' })).toMatchObject({
      task_id: 'T-42',
      repo_path: '/repo',
      workspace_path: '/tmp/wt',
      branch_name: 'feature/task',
      status: 'ready',
    })
  })
})

describe('TaskDetailView', () => {
  beforeEach(() => {
    taskActiveView.set(new Map())
    commandHeld.set(false)
    taskTabSessions.clear()
    clearTerminalTaskPaneControllers()
    installedPlugins.set(new Map([[
      'com.openforge.terminal',
      {
        manifest: {
          id: 'com.openforge.terminal',
          name: 'Terminal',
          version: '1.0.0',
          apiVersion: 1,
          description: 'Embedded terminal plugin',
          permissions: [],
          contributes: {
            taskPaneTabs: [{ id: 'terminal', title: 'Terminal', icon: 'terminal', order: 10 }],
          },
          frontend: 'index.js',
          backend: null,
        },
        state: 'active',
        error: null,
      },
    ]]))
    enabledPluginIds.set(new Set(['com.openforge.terminal']))
    clearComponentRegistry()
    registerRenderableContributionComponent('taskPaneTabs', TERMINAL_VIEW_ID, TerminalTaskPane)
  })

  it('renders back button with "back" text', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('back')).toBeTruthy()
  })

  it('renders task id', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
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

  it('renders plugin task pane tab buttons from enabled manifests', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo())

    installedPlugins.set(new Map([[
      'plugin.task-pane',
      {
        manifest: {
          id: 'plugin.task-pane',
          name: 'Task Pane Plugin',
          version: '1.0.0',
          apiVersion: 1,
          description: 'Adds a task tab',
          permissions: [],
          contributes: {
            taskPaneTabs: [{ id: 'activity', title: 'Activity', icon: 'sparkles', order: 5 }],
          },
          frontend: 'index.js',
          backend: null,
        },
        state: 'active',
        error: null,
      },
    ]]))
    enabledPluginIds.set(new Set(['plugin.task-pane']))
    registerRenderableContributionComponent('taskPaneTabs', 'plugin.task-pane:activity', PluginSlotTestView)

    render(TaskDetailView, { props: { task: { ...baseTask, status: 'doing' }, onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^activity\b/i })).toBeTruthy()
    })
  })

  it('uses namespaced task-pane tab ids to avoid collisions across plugins', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo())

    installedPlugins.set(new Map([
      ['plugin.a', {
        manifest: {
          id: 'plugin.a',
          name: 'Plugin A',
          version: '1.0.0',
          apiVersion: 1,
          description: 'Plugin A tab',
          permissions: [],
          contributes: { taskPaneTabs: [{ id: 'activity', title: 'Activity A', order: 1 }] },
          frontend: 'index.js',
          backend: null,
        },
        state: 'active',
        error: null,
      }],
      ['plugin.b', {
        manifest: {
          id: 'plugin.b',
          name: 'Plugin B',
          version: '1.0.0',
          apiVersion: 1,
          description: 'Plugin B tab',
          permissions: [],
          contributes: { taskPaneTabs: [{ id: 'activity', title: 'Activity B', order: 2 }] },
          frontend: 'index.js',
          backend: null,
        },
        state: 'active',
        error: null,
      }],
    ]))
    enabledPluginIds.set(new Set(['plugin.a', 'plugin.b']))
    registerRenderableContributionComponent('taskPaneTabs', 'plugin.a:activity', PluginSlotTestView)
    registerRenderableContributionComponent('taskPaneTabs', 'plugin.b:activity', PluginSlotTestView)

    render(TaskDetailView, { props: { task: { ...baseTask, status: 'doing' }, onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Activity A' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Activity B' })).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Activity B' }))

    await waitFor(() => {
      const slotHost = document.querySelector('[data-slot-type="taskPaneTabs"]')
      expect(slotHost?.getAttribute('data-slot-id')).toBe('plugin.b:activity')
    })

    expect(get(taskActiveView).get('T-42')).toBe('plugin.b:activity')
  })

  it('activates the terminal pane through view state when the terminal toggle is clicked', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo())

    installedPlugins.set(new Map([[
      'com.openforge.terminal',
      {
        manifest: {
          id: 'com.openforge.terminal',
          name: 'Terminal',
          version: '1.0.0',
          apiVersion: 1,
          description: 'Terminal plugin',
          permissions: [],
          contributes: { taskPaneTabs: [{ id: 'terminal', title: 'Terminal', icon: 'terminal', order: 1 }] },
          frontend: 'index.js',
          backend: null,
        },
        state: 'active',
        error: null,
      },
    ]]))
    enabledPluginIds.set(new Set(['com.openforge.terminal']))
    registerRenderableContributionComponent('taskPaneTabs', 'com.openforge.terminal:terminal', PluginSlotTestView)

    render(TaskDetailView, { props: { task: { ...baseTask, status: 'doing' }, onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^terminal\b/i }).getAttribute('aria-pressed')).toBe('false')
      expect(screen.getByRole('button', { name: /^code_view\b/i }).getAttribute('aria-pressed')).toBe('true')
    })

    await fireEvent.click(screen.getByRole('button', { name: /^terminal\b/i }))

    await waitFor(() => {
      const slotHost = document.querySelector('[data-slot-type="taskPaneTabs"]')
      expect(get(taskActiveView).get('T-42')).toBe('com.openforge.terminal:terminal')
      expect(screen.getByRole('button', { name: /^terminal\b/i }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByRole('button', { name: /^code_view\b/i }).getAttribute('aria-pressed')).toBe('false')
      expect(slotHost?.getAttribute('data-slot-id')).toBe('com.openforge.terminal:terminal')
      expect(screen.getByTestId('plugin-slot-view')).toBeTruthy()
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
    expect(breadcrumbRoot?.textContent).toContain('T-42')
  })

  it('renders breadcrumb with code segment by default', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    const breadcrumbRoot = screen.getByText('$ cd board').closest('div')
    expect(breadcrumbRoot?.textContent).toContain('code')
  })

  it('renders breadcrumb with task id', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    const breadcrumbRoot = screen.getByText('$ cd board').closest('div')
    expect(breadcrumbRoot?.textContent).toContain('T-42')
  })

  it('shows TaskInfoPanel by default', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('// INITIAL_PROMPT')).toBeTruthy()
  })

  it('Info panel always visible in code_view mode (no tab toggle)', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('// INITIAL_PROMPT')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /^Info$/ })).toBeNull()
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('rightPanelMode state does NOT exist — Info always visible', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('// INITIAL_PROMPT')).toBeTruthy()
  })

  it('renders three tab buttons when worktree exists', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText('code_view')).toBeTruthy()
      expect(screen.getByText('review_view')).toBeTruthy()
      expect(screen.getByRole('button', { name: /^terminal\b/i })).toBeTruthy()
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('terminal tab hidden when no worktree', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^terminal\b/i })).toBeNull()
    })
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
    const { acquire, detach } = await import('../../lib/terminalPool')
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

  it('⌘3 switches to terminal tab', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())

    await fireEvent.keyDown(window, { key: '3', code: 'Digit3', metaKey: true })

    await waitFor(() => {
      const breadcrumb = screen.getByText('$ cd board').closest('div')
      expect(breadcrumb?.textContent).toContain('terminal')
    })
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('⌘T switches to terminal tab', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())

    await fireEvent.keyDown(window, { key: 't', code: 'KeyT', metaKey: true })

    await waitFor(() => {
      const breadcrumb = screen.getByText('$ cd board').closest('div')
      expect(breadcrumb?.textContent).toContain('terminal')
    })
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('⌘T adds a new terminal tab when already viewing terminal', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())

    await fireEvent.keyDown(window, { key: 't', code: 'KeyT', metaKey: true })
    await waitFor(() => {
      const breadcrumb = screen.getByText('$ cd board').closest('div')
      expect(breadcrumb?.textContent).toContain('terminal')
    })

    await fireEvent.keyDown(window, { key: 't', code: 'KeyT', metaKey: true })

    await waitFor(() => {
      expect(screen.getByText('Shell 2')).toBeTruthy()
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('⌘W closes the active terminal tab when terminal view is active', async () => {
    const { getTaskWorkspace, killPty } = await import('../../lib/ipc')
    const { focusTerminal } = await import('../../lib/terminalPool')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))
    vi.mocked(killPty).mockClear()
    vi.mocked(focusTerminal).mockClear()

    taskActiveView.set(new Map([['T-42', TERMINAL_VIEW_ID]]))
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    await waitFor(() => expect(screen.getByText('Shell 1')).toBeTruthy())

    const addButton = screen.getByRole('button', { name: '+' })
    await fireEvent.click(addButton)

    await waitFor(() => expect(screen.getByText('Shell 2')).toBeTruthy())

    await fireEvent.keyDown(window, { key: 'w', metaKey: true })

    await waitFor(() => {
      expect(screen.queryByText('Shell 2')).toBeNull()
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })

    expect(vi.mocked(killPty)).toHaveBeenCalledWith('T-42-shell-1')
    expect(vi.mocked(focusTerminal)).toHaveBeenCalledWith('T-42-shell-0')
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('⌘W is a no-op outside terminal view', async () => {
    const { getTaskWorkspace, killPty } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))
    vi.mocked(killPty).mockClear()

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())

    await fireEvent.keyDown(window, { key: 'w', metaKey: true })

    expect(screen.getByText('code_view')).toBeTruthy()
    expect(vi.mocked(killPty)).not.toHaveBeenCalled()
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('⌘W is a no-op when only one terminal tab remains', async () => {
    const { getTaskWorkspace, killPty } = await import('../../lib/ipc')
    const { focusTerminal } = await import('../../lib/terminalPool')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))
    vi.mocked(killPty).mockClear()
    vi.mocked(focusTerminal).mockClear()

    taskActiveView.set(new Map([['T-42', TERMINAL_VIEW_ID]]))
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    await waitFor(() => expect(screen.getByText('Shell 1')).toBeTruthy())

    await fireEvent.keyDown(window, { key: 'w', metaKey: true })

    expect(screen.getByText('Shell 1')).toBeTruthy()
    expect(vi.mocked(killPty)).not.toHaveBeenCalled()
    expect(vi.mocked(focusTerminal)).not.toHaveBeenCalled()
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('⌘E switches to terminal tab and focuses the first shell tab when terminal has never been opened', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    const { focusTerminal } = await import('../../lib/terminalPool')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))
    vi.mocked(focusTerminal).mockClear()

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())

    await fireEvent.keyDown(window, { key: 'e', metaKey: true })

    const breadcrumb = screen.getByText('$ cd board').closest('div')
    expect(breadcrumb?.textContent).toContain('terminal')
    expect(focusTerminal).toHaveBeenCalledWith('T-42-shell-0')
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('⌘+1 switches to code_view', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())

    // Switch to review first
    await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })
    const breadcrumb = screen.getByText('$ cd board').closest('div')
    await waitFor(() => expect(breadcrumb?.textContent).toContain('self_review'))

    // Now switch back to code with CMD+1
    await fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true, shiftKey: false })
    await waitFor(() => {
      expect(breadcrumb?.textContent).toContain('code')
      expect(breadcrumb?.textContent).not.toContain('self_review')
    })
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('⌘+1 → code_view', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('review_view')).toBeTruthy())

    await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })
    const breadcrumb = screen.getByText('$ cd board').closest('div')
    await waitFor(() => expect(breadcrumb?.textContent).toContain('self_review'))

    await fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true, shiftKey: false })
    await waitFor(() => {
      expect(breadcrumb?.textContent).toContain('code')
      expect(breadcrumb?.textContent).not.toContain('self_review')
    })
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('⌘+2 → review_view', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('review_view')).toBeTruthy())

    const breadcrumb = screen.getByText('$ cd board').closest('div')
    expect(breadcrumb?.textContent).toContain('code')

    await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })
    await waitFor(() => expect(breadcrumb?.textContent).toContain('self_review'))
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })


  it('selecting the terminal tab activates the terminal pane', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByRole('button', { name: /^terminal\b/i })).toBeTruthy())

    await fireEvent.click(screen.getByRole('button', { name: /^terminal\b/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /shell 1/i })).toBeTruthy()
      expect(get(taskActiveView).get(baseTask.id)).toBe(TERMINAL_VIEW_ID)
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('breadcrumb shows terminal when terminal tab active', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByRole('button', { name: /^terminal\b/i })).toBeTruthy())

    await fireEvent.click(screen.getByRole('button', { name: /^terminal\b/i }))

    await waitFor(() => {
      const breadcrumb = screen.getByText('$ cd board').closest('div')
      expect(breadcrumb?.textContent).toContain('terminal')
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })



  it('navigates to board when task is moved to done', async () => {
    const doingTask: Task = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await fireEvent.click(screen.getByText('Move to Done'))
    const { moveTaskToComplete } = await import('../../lib/moveToComplete')
    const { resetToBoard } = await import('../../lib/router.svelte')
    expect(moveTaskToComplete).toHaveBeenCalledWith('T-42')
    expect(resetToBoard).not.toHaveBeenCalled()
  })

  it('delegates task completion to moveTaskToComplete when moved to done', async () => {
    const { moveTaskToComplete } = await import('../../lib/moveToComplete')
    const { resetToBoard } = await import('../../lib/router.svelte')

    const callOrder: string[] = []
    vi.mocked(resetToBoard).mockImplementation(() => { callOrder.push('resetToBoard') })
    vi.mocked(moveTaskToComplete).mockImplementation(async () => { callOrder.push('moveTaskToComplete') })

    const doingTask: Task = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await fireEvent.click(screen.getByText('Move to Done'))

    await vi.waitFor(() => {
      expect(callOrder).toEqual(['moveTaskToComplete'])
    })

    vi.mocked(resetToBoard).mockReset()
    vi.mocked(moveTaskToComplete).mockReset()
    vi.mocked(moveTaskToComplete).mockResolvedValue(undefined)
  })

  it('awaits moveTaskToComplete when moving task to done', async () => {
    const doingTask: Task = { ...baseTask, status: 'doing' }
    const { moveTaskToComplete } = await import('../../lib/moveToComplete')
    const { resetToBoard } = await import('../../lib/router.svelte')

    let resolveMove: (() => void) | undefined
    vi.mocked(moveTaskToComplete).mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        resolveMove = resolve
      }),
    )

    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })

    vi.mocked(resetToBoard).mockClear()

    await fireEvent.click(screen.getByText('Move to Done'))

    expect(moveTaskToComplete).toHaveBeenCalledWith('T-42')
    expect(resetToBoard).not.toHaveBeenCalled()

    resolveMove?.()
  })

  it('shows action buttons in dropdown when actions exist', async () => {
    const { loadActions } = await import('../../lib/actions')
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
    const { loadActions } = await import('../../lib/actions')
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
      taskActiveView.set(new Map())
    })

    it('l key switches to review mode when worktree exists', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

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

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('h key switches back to code mode from review', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

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

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
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
      const { getTaskWorkspace } = await import('../../lib/ipc')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

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

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('Cmd+2 switches to review mode when worktree exists', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      const breadcrumb = screen.getByText('$ cd board').closest('div')
      expect(breadcrumb?.textContent).toContain('code')

      await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })

      await waitFor(() => {
        expect(breadcrumb?.textContent).toContain('self_review')
      })

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('Cmd+1 switches back to code mode from review', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })
      const breadcrumb = screen.getByText('$ cd board').closest('div')
      await waitFor(() => {
        expect(breadcrumb?.textContent).toContain('self_review')
      })

      await fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true, shiftKey: false })
      await waitFor(() => {
        expect(breadcrumb?.textContent).toContain('code')
        expect(breadcrumb?.textContent).not.toContain('self_review')
      })

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('Cmd+1/2 work even when an input element is focused', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      const input = document.createElement('input')
      document.body.appendChild(input)

      try {
        input.focus()

        const breadcrumb = screen.getByText('$ cd board').closest('div')

        await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })
        await waitFor(() => {
          expect(breadcrumb?.textContent).toContain('self_review')
        })

        await fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true, shiftKey: false })
        await waitFor(() => {
          expect(breadcrumb?.textContent).toContain('code')
        })
      } finally {
        document.body.removeChild(input)
        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      }
    })

    it('Cmd+1/2 are ignored when no worktree exists', async () => {
      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

      const breadcrumb = screen.getByText('$ cd board').closest('div')
      expect(breadcrumb?.textContent).toContain('code')

      await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })
      expect(breadcrumb?.textContent).toContain('code')
      expect(breadcrumb?.textContent).not.toContain('self_review')
    })

    it('⌘3 ignored when no worktree', async () => {
      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

      const breadcrumb = screen.getByText('$ cd board').closest('div')
      expect(breadcrumb?.textContent).toContain('code')

      await fireEvent.keyDown(window, { key: '3', code: 'Digit3', metaKey: true, shiftKey: false })

      expect(breadcrumb?.textContent).toContain('code')
      expect(breadcrumb?.textContent).not.toContain('terminal')
    })

    it('Cmd+Shift+digit switches terminal tabs when terminal is active', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      const { focusTerminal } = await import('../../lib/terminalPool')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
      vi.mocked(focusTerminal).mockClear()

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      await fireEvent.keyDown(window, { key: '3', code: 'Digit3', metaKey: true })
      await waitFor(() => {
        const breadcrumb = screen.getByText('$ cd board').closest('div')
        expect(breadcrumb?.textContent).toContain('terminal')
      })

      await fireEvent.keyDown(window, { key: 't', code: 'KeyT', metaKey: true })
      await fireEvent.keyDown(window, { key: 't', code: 'KeyT', metaKey: true })

      await waitFor(() => {
        expect(screen.getByText('Shell 3')).toBeTruthy()
      })

      vi.mocked(focusTerminal).mockClear()

      await fireEvent.keyDown(window, { key: '!', code: 'Digit1', metaKey: true, shiftKey: true })
      await waitFor(() => {
        expect(focusTerminal).toHaveBeenCalledWith('T-42-shell-0')
        expect(taskTabSessions.get('T-42')?.activeTabIndex).toBe(0)
      })

      vi.mocked(focusTerminal).mockClear()

      await fireEvent.keyDown(window, { key: '#', code: 'Digit3', metaKey: true, shiftKey: true })
      await waitFor(() => {
        expect(focusTerminal).toHaveBeenCalledWith('T-42-shell-2')
        expect(taskTabSessions.get('T-42')?.activeTabIndex).toBe(2)
      })

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('Cmd+Shift+digit is ignored when terminal is not active', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      const { focusTerminal } = await import('../../lib/terminalPool')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
      vi.mocked(focusTerminal).mockClear()

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      await fireEvent.keyDown(window, { key: '3', code: 'Digit3', metaKey: true })
      await waitFor(() => {
        const breadcrumb = screen.getByText('$ cd board').closest('div')
        expect(breadcrumb?.textContent).toContain('terminal')
      })

      await fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true })
      const breadcrumb = screen.getByText('$ cd board').closest('div')
      await waitFor(() => {
        expect(breadcrumb?.textContent).toContain('code')
      })

      vi.mocked(focusTerminal).mockClear()

      await fireEvent.keyDown(window, { key: '@', code: 'Digit2', metaKey: true, shiftKey: true })

      expect(breadcrumb?.textContent).toContain('code')
      expect(focusTerminal).not.toHaveBeenCalled()
      expect(taskTabSessions.get('T-42')?.activeTabIndex).toBe(0)

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('Cmd+Shift+digit still switches terminal tabs when an input element is focused', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      const { focusTerminal } = await import('../../lib/terminalPool')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
      vi.mocked(focusTerminal).mockClear()

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      await fireEvent.keyDown(window, { key: '3', code: 'Digit3', metaKey: true })
      await waitFor(() => {
        const breadcrumb = screen.getByText('$ cd board').closest('div')
        expect(breadcrumb?.textContent).toContain('terminal')
      })

      await fireEvent.keyDown(window, { key: 't', code: 'KeyT', metaKey: true })
      await waitFor(() => {
        expect(screen.getByText('Shell 2')).toBeTruthy()
      })

      const input = document.createElement('input')
      document.body.appendChild(input)

      try {
        input.focus()

        vi.mocked(focusTerminal).mockClear()

        await fireEvent.keyDown(window, { key: '!', code: 'Digit1', metaKey: true, shiftKey: true })

        expect(focusTerminal).toHaveBeenCalledWith('T-42-shell-0')
        expect(taskTabSessions.get('T-42')?.activeTabIndex).toBe(0)
        expect(screen.getByText('$ cd board').closest('div')?.textContent).toContain('terminal')
      } finally {
        document.body.removeChild(input)
        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      }
    })

    it('Cmd+Shift+digit continues to target shell numbers after a tab is closed', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      const { focusTerminal } = await import('../../lib/terminalPool')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
      vi.mocked(focusTerminal).mockClear()

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      await fireEvent.keyDown(window, { key: '3', code: 'Digit3', metaKey: true })
      await waitFor(() => {
        const breadcrumb = screen.getByText('$ cd board').closest('div')
        expect(breadcrumb?.textContent).toContain('terminal')
      })

      await fireEvent.keyDown(window, { key: 't', code: 'KeyT', metaKey: true })
      await fireEvent.keyDown(window, { key: 't', code: 'KeyT', metaKey: true })

      await waitFor(() => {
        expect(screen.getByText('Shell 3')).toBeTruthy()
      })

      const closeButtons = screen.getAllByRole('button', { name: '×' })
      await fireEvent.click(closeButtons[1])

      await waitFor(() => {
        expect(screen.queryByText('Shell 2')).toBeNull()
        expect(screen.getByText('Shell 3')).toBeTruthy()
      })

      await fireEvent.click(screen.getByText('Shell 1'))

      await waitFor(() => {
        expect(taskTabSessions.get('T-42')?.activeTabIndex).toBe(0)
      })

      vi.mocked(focusTerminal).mockClear()

      await fireEvent.keyDown(window, { key: '@', code: 'Digit2', metaKey: true, shiftKey: true })

      expect(focusTerminal).not.toHaveBeenCalled()
      expect(taskTabSessions.get('T-42')?.activeTabIndex).toBe(0)

      vi.mocked(focusTerminal).mockClear()

      await fireEvent.keyDown(window, { key: '#', code: 'Digit3', metaKey: true, shiftKey: true })

      await waitFor(() => {
        expect(focusTerminal).toHaveBeenCalledWith('T-42-shell-2')
        expect(taskTabSessions.get('T-42')?.activeTabIndex).toBe(2)
      })

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('Cmd+Shift+1 stays in terminal view when the key event reports 1', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      const { focusTerminal } = await import('../../lib/terminalPool')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
      vi.mocked(focusTerminal).mockClear()
      registerMockTerminalTaskPaneController('T-42')

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      await fireEvent.keyDown(window, { key: '3', code: 'Digit3', metaKey: true })
      await waitFor(() => {
        expect(screen.getByText('$ cd board').closest('div')?.textContent).toContain('terminal')
      })

      taskTabSessions.set('T-42', {
        tabs: [
          { index: 0, key: 'T-42-shell-0', label: 'Shell 1' },
          { index: 1, key: 'T-42-shell-1', label: 'Shell 2' },
          { index: 2, key: 'T-42-shell-2', label: 'Shell 3' },
        ],
        activeTabIndex: 2,
        nextIndex: 3,
      })
      registerMockTerminalTaskPaneController('T-42')

      vi.mocked(focusTerminal).mockClear()

      await fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true, shiftKey: true })

      await waitFor(() => {
        expect(focusTerminal).toHaveBeenCalledWith('T-42-shell-0')
        expect(taskTabSessions.get('T-42')?.activeTabIndex).toBe(0)
        expect(screen.getByText('$ cd board').closest('div')?.textContent).toContain('terminal')
      })

      expect(screen.getByText('$ cd board').closest('div')?.textContent).not.toContain('code')

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('Cmd+Shift+2 stays in terminal view when the key event reports 2', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      const { focusTerminal } = await import('../../lib/terminalPool')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
      vi.mocked(focusTerminal).mockClear()
      registerMockTerminalTaskPaneController('T-42')

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      await fireEvent.keyDown(window, { key: '3', code: 'Digit3', metaKey: true })
      await waitFor(() => {
        expect(screen.getByText('$ cd board').closest('div')?.textContent).toContain('terminal')
      })

      taskTabSessions.set('T-42', {
        tabs: [
          { index: 0, key: 'T-42-shell-0', label: 'Shell 1' },
          { index: 1, key: 'T-42-shell-1', label: 'Shell 2' },
          { index: 2, key: 'T-42-shell-2', label: 'Shell 3' },
        ],
        activeTabIndex: 2,
        nextIndex: 3,
      })
      registerMockTerminalTaskPaneController('T-42')

      vi.mocked(focusTerminal).mockClear()

      await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: true })

      await waitFor(() => {
        expect(focusTerminal).toHaveBeenCalledWith('T-42-shell-1')
        expect(taskTabSessions.get('T-42')?.activeTabIndex).toBe(1)
        expect(screen.getByText('$ cd board').closest('div')?.textContent).toContain('terminal')
      })

      expect(screen.getByText('$ cd board').closest('div')?.textContent).not.toContain('review')

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('shows shortcut hints on view toggle buttons when CMD is held', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      commandHeld.set(true)

      await waitFor(() => {
        const codeBtn = screen.getByText('code_view').closest('button')
        const reviewBtn = screen.getByText('review_view').closest('button')
        const terminalBtn = screen.getByRole('button', { name: /^terminal\b/i })
        expect(codeBtn?.textContent).toContain('⌘1')
        expect(reviewBtn?.textContent).toContain('⌘2')
        expect(terminalBtn?.textContent).toContain('⌘3')
      })

      commandHeld.set(false)
      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('hides shortcut hints on view toggle buttons when CMD is not held', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review_view')).toBeTruthy()
      })

      commandHeld.set(false)

      await waitFor(() => {
        const codeBtn = screen.getByText('code_view').closest('button')
        const reviewBtn = screen.getByText('review_view').closest('button')
        const terminalBtn = screen.getByRole('button', { name: /^terminal\b/i })
        expect(codeBtn?.textContent).not.toContain('⌘1')
        expect(reviewBtn?.textContent).not.toContain('⌘2')
        expect(terminalBtn?.textContent).not.toContain('⌘3')
      })

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('Escape triggers reset to board', async () => {
    const { resetToBoard } = await import('../../lib/router.svelte')
      vi.mocked(resetToBoard).mockClear()
      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

      await fireEvent.keyDown(window, { key: 'Escape' })

      expect(resetToBoard).toHaveBeenCalled()
    })

     it('q triggers reset to board', async () => {
    const { resetToBoard } = await import('../../lib/router.svelte')
       vi.mocked(resetToBoard).mockClear()
       render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

       await fireEvent.keyDown(window, { key: 'q' })

       expect(resetToBoard).toHaveBeenCalled()
     })
   })

   describe('active view persistence', () => {
     beforeEach(() => {
       taskActiveView.set(new Map())
     })

     it('l key writes review to taskActiveView store for the task', async () => {
       const { getTaskWorkspace } = await import('../../lib/ipc')
       vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

       render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
       await waitFor(() => expect(screen.getByText('review_view')).toBeTruthy())

       await fireEvent.keyDown(window, { key: 'l' })

       await waitFor(() => {
         expect(get(taskActiveView).get('T-42')).toBe('review')
       })

       vi.mocked(getTaskWorkspace).mockResolvedValue(null)
     })

     it('h key writes code to taskActiveView store for the task', async () => {
       const { getTaskWorkspace } = await import('../../lib/ipc')
       vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

       taskActiveView.set(new Map([['T-42', 'review']]))
       render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
       await waitFor(() => expect(screen.getByText('review_view')).toBeTruthy())

       await fireEvent.keyDown(window, { key: 'h' })

       await waitFor(() => {
         expect(get(taskActiveView).get('T-42')).toBe('code')
       })

       vi.mocked(getTaskWorkspace).mockResolvedValue(null)
     })

     it('restores terminal mode from taskActiveView when task is rendered', async () => {
       const { getTaskWorkspace } = await import('../../lib/ipc')
       vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    taskActiveView.set(new Map([['T-42', TERMINAL_VIEW_ID]]))
       render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

       await waitFor(() => {
         const breadcrumb = screen.getByText('$ cd board').closest('div')
         expect(breadcrumb?.textContent).toContain('terminal')
       })

       vi.mocked(getTaskWorkspace).mockResolvedValue(null)
     })

     it('active tab persists per task via taskActiveView store', async () => {
       const { getTaskWorkspace } = await import('../../lib/ipc')
       vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

       taskActiveView.set(new Map([['T-42', 'review']]))
       render(TaskDetailView, { props: { task: secondaryTask, onRunAction: mockOnRunAction } })

       await waitFor(() => {
         const breadcrumb = screen.getByText('$ cd board').closest('div')
         expect(breadcrumb?.textContent).toContain('code')
         expect(breadcrumb?.textContent).not.toContain('self_review')
       })

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })
      it('falls back to code tab when stored tab is terminal but no worktree', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(null)

    taskActiveView.set(new Map([['T-42', TERMINAL_VIEW_ID]]))
        render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => {
          const breadcrumb = screen.getByText('$ cd board').closest('div')
          expect(breadcrumb?.textContent).toContain('code')
          expect(breadcrumb?.textContent).not.toContain('terminal')
        })
      })
    })

    describe('terminal cleanup on navigate-away', () => {
      it('calls releaseAllForTask when component unmounts', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        const { releaseAllForTask } = await import('../../lib/terminalPool')
        
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
        vi.mocked(releaseAllForTask).mockClear()
        
        const { unmount } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
        
        await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())
        
        unmount()
        
        expect(releaseAllForTask).toHaveBeenCalledWith('T-42')
        
        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('calls releaseAllForTask when task prop changes', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        const { releaseAllForTask } = await import('../../lib/terminalPool')
        
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
        vi.mocked(releaseAllForTask).mockClear()
        
        const { rerender } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
        
        await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())
        
        const newTask = { ...baseTask, id: 'T-99', initial_prompt: 'New task' }
        rerender({ task: newTask, onRunAction: mockOnRunAction })
        
        await waitFor(() => {
          expect(releaseAllForTask).toHaveBeenCalledWith('T-42')
        })
        
        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('does NOT call releaseAllForTask when task prop changes with same ID', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        const { releaseAllForTask } = await import('../../lib/terminalPool')
        
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
        vi.mocked(releaseAllForTask).mockClear()
        
        const { rerender } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
        
        await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())
        
        const refreshedTask = { ...baseTask, summary: 'updated summary' }
        rerender({ task: refreshedTask, onRunAction: mockOnRunAction })
        
        await new Promise(r => setTimeout(r, 50))
        
        expect(releaseAllForTask).not.toHaveBeenCalled()
        
        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('cleanup only releases shell entries, not agent terminal', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        const { releaseAllForTask } = await import('../../lib/terminalPool')
        
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
        vi.mocked(releaseAllForTask).mockClear()
        
        const { unmount } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
        
        await waitFor(() => expect(screen.getByText('code_view')).toBeTruthy())
        
        unmount()
        
        expect(releaseAllForTask).toHaveBeenCalledWith('T-42')
        
        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })
    })

})
