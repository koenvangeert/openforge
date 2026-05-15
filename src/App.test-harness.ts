import { cleanup } from '@testing-library/svelte'
import { vi, beforeEach, afterEach } from 'vitest'
import { get, writable } from 'svelte/store'
import type { Task, AgentSession, Project, ProjectAttention, PullRequestInfo, CheckpointNotification, CiFailureNotification, RateLimitNotification } from './lib/types'
import { forceGithubSync, registerBuiltinPlugin } from './lib/ipc'

export const callOrder: string[] = []
export const installedPluginRows: Array<{
  id: string
  name: string
  version: string
  apiVersion: number
  description: string
  permissions: string
  contributes: string
  frontendEntry: string
  backendEntry: string | null
  installPath: string
  installedAt: number
  isBuiltin: boolean
}> = []

function builtinRuntimeContributionSourceForTest(pluginId: string) {
  switch (pluginId) {
    case 'com.openforge.file-viewer':
      return { views: [{ id: 'files', title: 'Files', icon: 'folder-open', showInRail: true, railOrder: 10, shortcut: 'Cmd+O' }] }
    case 'com.openforge.github-sync':
      return {
        views: [{ id: 'pr_review', title: 'Pull Requests', icon: 'git-pull-request', showInRail: true, railOrder: 20, shortcut: 'Cmd+G' }],
        commands: [{ id: 'refresh', title: 'Refresh Pull Requests', shortcut: 'Cmd+Shift+R' }],
      }
    case 'com.openforge.skills-viewer':
      return { views: [{ id: 'skills', title: 'Skills', icon: 'sparkles', showInRail: true, railOrder: 30, shortcut: 'Cmd+L' }] }
    case 'com.openforge.terminal':
      return {
        views: [{ id: 'terminal', title: 'Terminal', icon: 'terminal', showInRail: true, railOrder: 40, shortcut: 'Cmd+J' }],
        taskPaneTabs: [{ id: 'terminal', title: 'Terminal', icon: 'terminal', order: 10 }],
      }
    default:
      return {}
  }
}

export function persistInstalledPluginRow(plugin: {
  id: string
  name: string
  version: string
  apiVersion: number
  description: string
  permissions: string
  contributes: string
  frontendEntry: string
  backendEntry: string | null
  installPath: string
  installedAt: number
  isBuiltin: boolean
}) {
  const nextRow = {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    apiVersion: plugin.apiVersion,
    description: plugin.description,
    permissions: plugin.permissions,
    contributes: plugin.contributes,
    frontendEntry: plugin.frontendEntry,
    backendEntry: plugin.backendEntry,
    installPath: plugin.installPath,
    installedAt: plugin.installedAt,
    isBuiltin: plugin.isBuiltin,
  }

  const existingIndex = installedPluginRows.findIndex((row) => row.id === plugin.id)
  if (existingIndex >= 0) {
    installedPluginRows.splice(existingIndex, 1, nextRow)
  } else {
    installedPluginRows.push(nextRow)
  }
}

export const eventListeners = new Map<string, Function>()
export type MockCloseRequestEvent = {
  preventDefault: () => void
}

export let closeRequestedHandler: ((event: MockCloseRequestEvent) => void | Promise<void>) | null = null
export const mockWindowOnCloseRequested = vi.fn(async (callback: (event: MockCloseRequestEvent) => void | Promise<void>) => {
  closeRequestedHandler = callback
  return () => {
    closeRequestedHandler = null
  }
})
export const mockWindowDestroy = vi.fn(async () => undefined)

export const mockSelectedTaskIdStore = writable<string | null>(null)
export const mockMergingTaskIdsStore = writable<Set<string>>(new Set())
export const mockCurrentViewStore = writable<'board' | 'files' | 'settings' | 'global_settings' | 'plugin:com.openforge.file-viewer:files' | 'plugin:com.openforge.github-sync:pr_review' | 'plugin:com.openforge.skills-viewer:skills'>('board')
export const mockSelectedReviewPrStore = writable(null)
const {
  mockActivatePlugin,
  mockExecutePluginCommand,
  mockLoadEnabledForProject,
} = vi.hoisted(() => ({
  mockActivatePlugin: vi.fn<(pluginId: string) => Promise<boolean>>(async () => true),
  mockExecutePluginCommand: vi.fn(async (_pluginId: string, _commandId: string) => true),
  mockLoadEnabledForProject: vi.fn<(projectId: string) => Promise<void>>(async () => undefined),
}))

export { mockActivatePlugin, mockExecutePluginCommand, mockLoadEnabledForProject }

vi.mock('./lib/desktopIpc', () => ({
  invokeDesktopCommand: vi.fn(),
  isElectronDesktopBridgeAvailable: vi.fn(() => true),
  listenDesktopEvent: vi.fn(async (eventName: string, callback: Function) => {
    callOrder.push('listen')
    eventListeners.set(eventName, callback)
    return () => {}
  }),
}))

vi.mock('./lib/desktopWindow', () => ({
  createDesktopWindow: vi.fn(() => ({
    onCloseRequested: mockWindowOnCloseRequested,
    destroy: mockWindowDestroy,
  })),
}))

vi.mock('./lib/plugin/pluginRegistry', async () => {
  const actual = await vi.importActual<typeof import('./lib/plugin/pluginRegistry')>('./lib/plugin/pluginRegistry')
  return {
    ...actual,
    activatePlugin: mockActivatePlugin,
    executePluginCommand: mockExecutePluginCommand,
    loadEnabledForProject: mockLoadEnabledForProject,
  }
})

vi.mock('./lib/stores', () => ({
  tasks: writable<Task[]>([]),
  pendingTask: writable<Task | null>(null),
  selectedTaskId: mockSelectedTaskIdStore,
  activeSessions: writable<Map<string, AgentSession>>(new Map()),
  checkpointNotification: writable<CheckpointNotification | null>(null),
  ciFailureNotification: writable<CiFailureNotification | null>(null),
  rateLimitNotification: writable<RateLimitNotification | null>(null),
  taskSpawned: writable<{ taskId: string; promptText: string } | null>(null),
  ticketPrs: writable<Map<string, PullRequestInfo[]>>(new Map()),
  mergingTaskIds: mockMergingTaskIdsStore,
  setTaskMerging: vi.fn((taskId: string, isMerging: boolean) => {
    mockMergingTaskIdsStore.update((current) => {
      const next = new Set(current)
      if (isMerging) {
        next.add(taskId)
      } else {
        next.delete(taskId)
      }
      return next
    })
  }),
  isLoading: writable(false),
  error: writable<string | null>(null),
  projects: writable<Project[]>([]),
  activeProjectId: writable<string | null>(null),
  activeProjectColorId: writable<string | null>(null),
  projectAttention: writable<Map<string, ProjectAttention>>(new Map()),
  agentEvents: writable<Map<string, any>>(new Map()),
  taskRuntimeInfo: writable(new Map()),
  currentView: mockCurrentViewStore,
  reviewPrs: writable([]),
  selectedReviewPr: mockSelectedReviewPrStore,
  prFileDiffs: writable([]),
  reviewRequestCount: writable(0),
  reviewComments: writable([]),
  pendingManualComments: writable([]),
  selectedReviewPrDetails: writable(null),
  reviewPullRequestDiff: writable(null),
  authoredPrCount: writable(0),
  commandHeld: writable(false),
  pendingFileReveal: writable<string | null>(null),
  focusBoardFilters: writable(new Map()),
  startingTasks: writable<Set<string>>(new Set()),
    codeCleanupTasksEnabled: writable(false),
}))

vi.mock('./lib/ipc', () => ({
  registerBuiltinPlugin: vi.fn(async (plugin) => {
    persistInstalledPluginRow(plugin)
  }),
  listPlugins: vi.fn(async () => installedPluginRows.map((row) => ({ ...row }))),
  getEnabledPlugins: vi.fn(async () => installedPluginRows.map((row) => ({ ...row }))),
  getSessions: vi.fn(),
  getProjects: vi.fn(async () => {
    callOrder.push('getProjects')
    return [{ id: 'proj-1', name: 'Test Project', path: '/test' }]
  }),
  getTasksForProject: vi.fn(async () => {
    callOrder.push('getTasksForProject')
    return []
  }),
  getOpenCodeStatus: vi.fn(async () => {
    callOrder.push('getOpenCodeStatus')
    return { installed: false, running: false, session_count: 0 }
  }),
  getLatestSessions: vi.fn(async () => {
    callOrder.push('getLatestSessions')
    return []
  }),
  getPullRequests: vi.fn(async () => {
    callOrder.push('getPullRequests')
    return []
  }),
  getAppMode: vi.fn(async () => {
    callOrder.push('getAppMode')
    return 'prod'
  }),
  getConfig: vi.fn(async () => null),
  getProjectAttention: vi.fn(async () => {
    callOrder.push('getProjectAttention')
    return []
  }),
  getLatestSession: vi.fn(async () => {
    callOrder.push('getLatestSession')
    return null
  }),
  finalizeAgentSession: vi.fn(async () => {
    callOrder.push('finalizeAgentSession')
  }),
  openUrl: vi.fn(),
  abortImplementation: vi.fn(),
  writePty: vi.fn(),
  resizePty: vi.fn(),
  killPty: vi.fn(),
  transcribeAudio: vi.fn(),
  getWhisperModelStatus: vi.fn(),
  downloadWhisperModel: vi.fn(),
  getPtyBuffer: vi.fn(),
  createTask: vi.fn(),
  getTaskDetail: vi.fn(),
  updateTask: vi.fn(),
  updateTaskStatus: vi.fn(async () => undefined),
  deleteTask: vi.fn(),
  clearDoneTasks: vi.fn(),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  getProjectConfig: vi.fn(async () => null),
  setProjectConfig: vi.fn(),
  startImplementation: vi.fn(),
  resumeStartupSessions: vi.fn(async () => {
    callOrder.push('resumeStartupSessions')
  }),
  mergePullRequest: vi.fn(),
  getWorktreeForTask: vi.fn(),
  getSessionStatus: vi.fn(),
  abortSession: vi.fn(),
  forceGithubSync: vi.fn(),
  getPrComments: vi.fn(),
  markCommentAddressed: vi.fn(),
  checkOpenCodeInstalled: vi.fn(),
  getReviewPullRequests: vi.fn(),
  getReviewComments: vi.fn(),
  submitReview: vi.fn(),
  getReviewPullRequestDetails: vi.fn(),
  getPrFileDiffs: vi.fn(),
  getReviewPullRequestDiff: vi.fn(),
  getReviewPullRequestDiffForFile: vi.fn(),
  getReviewPullRequestComments: vi.fn(),
  addReviewComment: vi.fn(),
  removeReviewComment: vi.fn(),
  updateReviewComment: vi.fn(),
  getReviewCommentReplies: vi.fn(),
  addReviewCommentReply: vi.fn(),
  removeReviewCommentReply: vi.fn(),
  updateReviewCommentReply: vi.fn(),
  submitReviewComments: vi.fn(),
  dismissReviewPullRequest: vi.fn(),
  listOpenCodeSkills: vi.fn(),
  getReviewPrs: vi.fn(async () => {
    callOrder.push('getReviewPrs')
    return []
  }),
    getAuthoredPrs: vi.fn(async () => {
      callOrder.push('getAuthoredPrs')
      return []
    }),
  }))

vi.mock('./components/focus-board/FocusBoard.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/task-detail/TaskDetailView.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/review/pr/PrReviewView.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/SkillsView.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/settings/SettingsView.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/prompt/PromptInput.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/shared/ui/SearchableSelect.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/feedback/toasts/Toast.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/feedback/toasts/CheckpointToast.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/feedback/toasts/CiFailureToast.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/feedback/toasts/TaskSpawnedToast.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/shell/AppSidebar.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/project/ProjectSwitcherModal.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/project/ProjectSetupDialog.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/shell/IconRail.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/shell/CommandPalette.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/shell/ActionPalette.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/shell/FileQuickOpen.svelte', () => ({ default: vi.fn() }))

vi.mock('./lib/doingStatus', () => ({
  computeDoingStatus: vi.fn(() => 'idle'),
}))

vi.mock('./lib/moveToComplete', () => ({
  moveTaskToComplete: vi.fn(async () => undefined),
}))

export const mockRouterPushNavState = vi.fn()
export const mockRouterBack = vi.fn(() => false)
export const mockRouterNavigateToTask = vi.fn((taskId: string) => {
  mockSelectedTaskIdStore.set(taskId)
})
export const mockRouterResetToBoard = vi.fn(() => {
  mockCurrentViewStore.set('board')
  mockSelectedTaskIdStore.set(null)
  mockSelectedReviewPrStore.set(null)
})
export const mockRouterNavigate = vi.fn((view: string) => {
  if (view === 'board') {
    mockRouterResetToBoard()
    return
  }
  mockCurrentViewStore.set(view as any)
  if (new Set(['settings', 'global_settings']).has(view) || view.startsWith('plugin:')) {
    mockSelectedTaskIdStore.set(null)
  }
})

vi.mock('./lib/router.svelte', () => ({
  pushNavState: mockRouterPushNavState,
  resetToBoard: mockRouterResetToBoard,
  useAppRouter: () => ({
    navigate: mockRouterNavigate,
    navigateToTask: mockRouterNavigateToTask,
    back: mockRouterBack,
    resetToBoard: mockRouterResetToBoard,
    get currentView() {
      return get(mockCurrentViewStore)
    },
  }),
}))

vi.mock('./lib/terminalPool', () => ({
  acquire: vi.fn(async () => ({ ptyActive: false })),
  attach: vi.fn(),
  detach: vi.fn(),
  focusTerminal: vi.fn(),
  isPtyActive: vi.fn(() => false),
  release: vi.fn(),
}))

vi.mock('lucide-svelte', () => {
  const stub = vi.fn()
  return {
    RefreshCw: stub,
    ChevronLeft: stub,
    ChevronRight: stub,
    Settings: stub,
    Plus: stub,
    FolderOpen: stub,
    LayoutDashboard: stub,
    GitPullRequest: stub,
    Sparkles: stub,
    PanelRight: stub,
  }
})

export function installAppTestLifecycle() {
  beforeEach(() => {
    callOrder.length = 0
    installedPluginRows.length = 0
    eventListeners.clear()
    closeRequestedHandler = null
    vi.clearAllMocks()
    vi.mocked(registerBuiltinPlugin).mockImplementation(async (plugin) => {
      persistInstalledPluginRow(plugin)
    })
    mockActivatePlugin.mockImplementation(async (pluginId: string) => {
      const { setRuntimeContributionSource } = await import('./lib/plugin/pluginStore')
      setRuntimeContributionSource(pluginId, builtinRuntimeContributionSourceForTest(pluginId))
      return true
    })
    mockLoadEnabledForProject.mockImplementation(async () => {
      const { enabledPluginIds } = await import('./lib/plugin/pluginStore')
      const pluginIds = installedPluginRows.map((row) => row.id)
      if (pluginIds.length > 0) {
        enabledPluginIds.set(new Set(pluginIds))
      }
      for (const pluginId of pluginIds) {
        await mockActivatePlugin(pluginId)
      }
    })
    mockExecutePluginCommand.mockImplementation(async (pluginId, commandId) => {
      if (pluginId === 'com.openforge.github-sync' && commandId === 'refresh') {
        await forceGithubSync()
      }
      return true
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })
}
