import { render, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { get, writable } from 'svelte/store'
import type { Task, AgentSession, Project, ProjectAttention, PullRequestInfo, CheckpointNotification, CiFailureNotification, RateLimitNotification, AuthoredPullRequest } from './lib/types'

const callOrder: string[] = []

const eventListeners = new Map<string, Function>()
const mockSelectedTaskIdStore = writable<string | null>(null)
const mockCurrentViewStore = writable<'board' | 'pr_review' | 'settings' | 'skills' | 'workqueue' | 'global_settings'>('board')
const mockSelectedReviewPrStore = writable(null)

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName: string, callback: Function) => {
    callOrder.push('listen')
    eventListeners.set(eventName, callback)
    return () => {}
  }),
  emit: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('./lib/stores', () => ({
  tasks: writable<Task[]>([]),
  pendingTask: writable<Task | null>(null),
  selectedTaskId: mockSelectedTaskIdStore,
  activeSessions: writable<Map<string, AgentSession>>(new Map()),
  checkpointNotification: writable<CheckpointNotification | null>(null),
  ciFailureNotification: writable<CiFailureNotification | null>(null),
  rateLimitNotification: writable<RateLimitNotification | null>(null),
  taskSpawned: writable<{ taskId: string; initial_prompt: string } | null>(null),
  ticketPrs: writable<Map<string, PullRequestInfo[]>>(new Map()),
  isLoading: writable(false),
  error: writable<string | null>(null),
  projects: writable<Project[]>([]),
  activeProjectId: writable<string | null>(null),
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
  focusBoardFilters: writable(new Map()),
  startingTasks: writable<Set<string>>(new Set()),
    codeCleanupTasksEnabled: writable(false),
}))

vi.mock('./lib/ipc', () => ({
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
  finalizeClaudeSession: vi.fn(async () => {
    callOrder.push('finalizeClaudeSession')
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
  updateTask: vi.fn(),
  updateTaskStatus: vi.fn(async () => undefined),
  deleteTask: vi.fn(),
  clearDoneTasks: vi.fn(),
  refreshJiraInfo: vi.fn(),
  getAgents: vi.fn(),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  getProjectConfig: vi.fn(async () => null),
  setProjectConfig: vi.fn(),
  startImplementation: vi.fn(),
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

vi.mock('./components/FocusBoard.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/TaskDetailView.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/PrReviewView.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/SkillsView.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/SettingsView.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/WorkQueueView.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/ClaudeAgentPanel.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/PromptInput.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/Modal.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/SearchableSelect.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/Toast.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/CheckpointToast.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/CiFailureToast.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/TaskSpawnedToast.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/AppSidebar.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/ProjectSwitcherModal.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/ProjectSetupDialog.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/IconRail.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/CommandPalette.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/ActionPalette.svelte', () => ({ default: vi.fn() }))

vi.mock('./lib/doingStatus', () => ({
  computeDoingStatus: vi.fn(() => 'idle'),
}))

const mockRouterPushNavState = vi.fn()
const mockRouterBack = vi.fn(() => false)
const mockRouterNavigateToTask = vi.fn((taskId: string) => {
  mockSelectedTaskIdStore.set(taskId)
})
const mockRouterResetToBoard = vi.fn(() => {
  mockCurrentViewStore.set('board')
  mockSelectedTaskIdStore.set(null)
  mockSelectedReviewPrStore.set(null)
})
const mockRouterNavigate = vi.fn((view: string) => {
  if (view === 'board') {
    mockRouterResetToBoard()
    return
  }
  mockCurrentViewStore.set(view as any)
  if (new Set(['pr_review', 'settings', 'workqueue', 'global_settings']).has(view)) {
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
  release: vi.fn(),
}))

vi.mock('lucide-svelte', () => {
  const stub = vi.fn()
  return {
    RefreshCw: stub,
    ChevronLeft: stub,
    ChevronRight: stub,
    ListChecks: stub,
    Settings: stub,
    Plus: stub,
    LayoutDashboard: stub,
    GitPullRequest: stub,
    Sparkles: stub,
    PanelRight: stub,
  }
})

describe('App onMount initialization order', () => {
  beforeEach(() => {
    callOrder.length = 0
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('initializes reviewRequestCount from DB on startup', async () => {
    const { getReviewPrs } = await import('./lib/ipc')
    const stores = await import('./lib/stores')
    const { get } = await import('svelte/store')

    vi.mocked(getReviewPrs).mockResolvedValue([
      { id: 1, number: 10, title: 'PR 1', body: null, state: 'open', draft: false, html_url: 'https://github.com/o/r/pull/10', user_login: 'u1', user_avatar_url: null, repo_owner: 'o', repo_name: 'r', head_ref: 'b1', base_ref: 'main', head_sha: 'sha1', additions: 0, deletions: 0, changed_files: 0, created_at: 1000, updated_at: 1000, viewed_at: null, viewed_head_sha: null },
      { id: 2, number: 20, title: 'PR 2', body: null, state: 'open', draft: false, html_url: 'https://github.com/o/r/pull/20', user_login: 'u2', user_avatar_url: null, repo_owner: 'o', repo_name: 'r', head_ref: 'b2', base_ref: 'main', head_sha: 'sha2', additions: 0, deletions: 0, changed_files: 0, created_at: 2000, updated_at: 2000, viewed_at: 1234567890, viewed_head_sha: 'sha2' },
      { id: 3, number: 30, title: 'PR 3', body: null, state: 'open', draft: false, html_url: 'https://github.com/o/r/pull/30', user_login: 'u3', user_avatar_url: null, repo_owner: 'o', repo_name: 'r', head_ref: 'b3', base_ref: 'main', head_sha: 'sha3', additions: 0, deletions: 0, changed_files: 0, created_at: 3000, updated_at: 3000, viewed_at: null, viewed_head_sha: null },
    ] as any)

    const App = (await import('./App.svelte')).default
    render(App)

    await vi.waitFor(() => {
      expect(getReviewPrs).toHaveBeenCalled()
    })

    // 2 out of 3 PRs are unviewed (viewed_at === null)
    expect(get(stores.reviewRequestCount)).toBe(2)
  }, 15000)

  it('reviewRequestCount respects repo exclusion filter', async () => {
    const { getReviewPrs, getProjectConfig, getAuthoredPrs } = await import('./lib/ipc')
    const stores = await import('./lib/stores')
    const { get } = await import('svelte/store')

    // PRs from two different repos, all unviewed
    vi.mocked(getReviewPrs).mockResolvedValue([
      { id: 1, number: 10, title: 'PR 1', body: null, state: 'open', draft: false, html_url: 'https://github.com/o/r/pull/10', user_login: 'u1', user_avatar_url: null, repo_owner: 'o', repo_name: 'r', head_ref: 'b1', base_ref: 'main', head_sha: 'sha1', additions: 0, deletions: 0, changed_files: 0, created_at: 1000, updated_at: 1000, viewed_at: null, viewed_head_sha: null },
      { id: 2, number: 20, title: 'PR 2', body: null, state: 'open', draft: false, html_url: 'https://github.com/x/y/pull/20', user_login: 'u2', user_avatar_url: null, repo_owner: 'x', repo_name: 'y', head_ref: 'b2', base_ref: 'main', head_sha: 'sha2', additions: 0, deletions: 0, changed_files: 0, created_at: 2000, updated_at: 2000, viewed_at: null, viewed_head_sha: null },
      { id: 3, number: 30, title: 'PR 3', body: null, state: 'open', draft: false, html_url: 'https://github.com/o/r/pull/30', user_login: 'u3', user_avatar_url: null, repo_owner: 'o', repo_name: 'r', head_ref: 'b3', base_ref: 'main', head_sha: 'sha3', additions: 0, deletions: 0, changed_files: 0, created_at: 3000, updated_at: 3000, viewed_at: null, viewed_head_sha: null },
    ] as any)
    vi.mocked(getAuthoredPrs).mockResolvedValue([])

    // Exclude repo x/y
    vi.mocked(getProjectConfig).mockImplementation(async (_projectId: string, key: string) => {
      if (key === 'pr_excluded_repos') return JSON.stringify(['x/y'])
      return null
    })

    const App = (await import('./App.svelte')).default
    render(App)

    await vi.waitFor(() => {
      expect(getReviewPrs).toHaveBeenCalled()
    })

    // 3 PRs unviewed, but x/y is excluded → only 2 from o/r count
    expect(get(stores.reviewRequestCount)).toBe(2)
  }, 15000)

  it('initializes authoredPrCount with merge-conflicted PRs on startup', async () => {
    const { getAuthoredPrs } = await import('./lib/ipc')
    const stores = await import('./lib/stores')
    const { get } = await import('svelte/store')

    const conflictedPr: AuthoredPullRequest = {
      id: 10,
      number: 10,
      title: 'Conflicted PR',
      body: null,
      state: 'open',
      draft: false,
      html_url: 'https://github.com/o/r/pull/10',
      user_login: 'u1',
      user_avatar_url: null,
      repo_owner: 'o',
      repo_name: 'r',
      head_ref: 'feature/conflict',
      base_ref: 'main',
      head_sha: 'sha10',
      additions: 1,
      deletions: 1,
      changed_files: 1,
      ci_status: 'success',
      ci_check_runs: null,
      review_status: 'approved',
      mergeable: false,
      mergeable_state: 'dirty',
      merged_at: null,
      is_queued: false,
      task_id: null,
      created_at: 1000,
      updated_at: 1000,
    }

    vi.mocked(getAuthoredPrs).mockResolvedValue([conflictedPr])

    const App = (await import('./App.svelte')).default
    render(App)

    await vi.waitFor(() => {
      expect(get(stores.authoredPrCount)).toBe(1)
    })
  }, 15000)

  it('refreshes authoredPrCount when authored-prs-updated fires', async () => {
    const { getAuthoredPrs } = await import('./lib/ipc')
    const stores = await import('./lib/stores')
    const { get } = await import('svelte/store')

    const conflictedPr: AuthoredPullRequest = {
      id: 10,
      number: 10,
      title: 'Conflicted PR',
      body: null,
      state: 'open',
      draft: false,
      html_url: 'https://github.com/o/r/pull/10',
      user_login: 'u1',
      user_avatar_url: null,
      repo_owner: 'o',
      repo_name: 'r',
      head_ref: 'feature/conflict',
      base_ref: 'main',
      head_sha: 'sha10',
      additions: 1,
      deletions: 1,
      changed_files: 1,
      ci_status: 'success',
      ci_check_runs: null,
      review_status: 'approved',
      mergeable: false,
      mergeable_state: 'dirty',
      merged_at: null,
      is_queued: false,
      task_id: null,
      created_at: 1000,
      updated_at: 1000,
    }

    vi.mocked(getAuthoredPrs)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([conflictedPr])

    const App = (await import('./App.svelte')).default
    render(App)

    await vi.waitFor(() => {
      expect(eventListeners.has('authored-prs-updated')).toBe(true)
      expect(getAuthoredPrs).toHaveBeenCalledTimes(1)
    })

    expect(get(stores.authoredPrCount)).toBe(0)

    const callback = eventListeners.get('authored-prs-updated')!
    await callback({ payload: undefined })

    await vi.waitFor(() => {
      expect(get(stores.authoredPrCount)).toBe(1)
    })
  }, 15000)

  it('registers event listeners before making IPC data-loading calls', async () => {
    const App = (await import('./App.svelte')).default

    render(App)

    await vi.waitFor(() => {
      expect(callOrder).toContain('listen')
      expect(callOrder).toContain('getProjects')
      expect(callOrder).toContain('getAppMode')
    })

    const firstListen = callOrder.indexOf('listen')
    const firstGetProjects = callOrder.indexOf('getProjects')
    const firstGetAppMode = callOrder.indexOf('getAppMode')

    expect(firstListen).toBeLessThan(firstGetProjects)
    expect(firstListen).toBeLessThan(firstGetAppMode)
  }, 15000)

  describe('selected task clearing', () => {
    it('clears selectedTaskId when the selected task disappears', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const selectedTask: Task = {
        id: 'task-123',
        initial_prompt: 'Selected task',
        prompt: null,
        summary: null,
        status: 'doing',
        jira_key: null,
        jira_title: null,
        jira_status: null,
        jira_assignee: null,
        jira_description: null,
        agent: null,
        permission_mode: null,
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)

      render(App)

      stores.tasks.set([])

      await vi.waitFor(() => {
        expect(get(stores.selectedTaskId)).toBeNull()
      })
    })

    it('keeps selectedTaskId when the selected task is still present', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const selectedTask: Task = {
        id: 'task-456',
        initial_prompt: 'Selected task',
        prompt: null,
        summary: null,
        status: 'doing',
        jira_key: null,
        jira_title: null,
        jira_status: null,
        jira_assignee: null,
        jira_description: null,
        agent: null,
        permission_mode: null,
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.selectedTaskId)).toBe(selectedTask.id)
      })
    })

    it('keeps selectedTaskId when the selected task is pending', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const pendingTask: Task = {
        id: 'task-pending',
        initial_prompt: 'Pending task',
        prompt: null,
        summary: null,
        status: 'backlog',
        jira_key: null,
        jira_title: null,
        jira_status: null,
        jira_assignee: null,
        jira_description: null,
        agent: null,
        permission_mode: null,
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      stores.tasks.set([])
      stores.pendingTask.set(pendingTask)
      stores.selectedTaskId.set(pendingTask.id)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.selectedTaskId)).toBe(pendingTask.id)
      })
    })
  })

  describe('keyboard shortcuts', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    afterEach(() => {
      document.body.innerHTML = ''
    })

    it('CMD+H resets to board view and clears selectedTaskId', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')

      render(App)

      // Simulate being on a task detail view
      stores.selectedTaskId.set('task-123')
      stores.currentView.set('settings')

      vi.mocked(nav.resetToBoard).mockClear()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', metaKey: true, bubbles: true }))

      expect(nav.resetToBoard).toHaveBeenCalled()
    })

    it('CMD+G navigates to pr_review view', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const { get } = await import('svelte/store')

      render(App)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', metaKey: true, bubbles: true }))
      expect(get(stores.currentView)).toBe('pr_review')
    })

    it('CMD+L navigates to skills view', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const { get } = await import('svelte/store')

      render(App)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true, bubbles: true }))
      expect(get(stores.currentView)).toBe('skills')
    })

    it('CMD+comma navigates to settings view', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const { get } = await import('svelte/store')

      render(App)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true }))
      expect(get(stores.currentView)).toBe('settings')
    })

    it('dashboard icon resets to board when a task view is open', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')
      const iconRailModule = await import('./components/IconRail.svelte')

      stores.selectedTaskId.set('task-123')
      stores.currentView.set('board')

      render(App)

      await vi.waitFor(() => {
        expect(iconRailModule.default).toHaveBeenCalled()
      })

      const lastCall = vi.mocked(iconRailModule.default).mock.calls.at(-1)
      expect(lastCall).toBeTruthy()

      if (!lastCall) {
        throw new Error('Expected IconRail to receive props')
      }

      const propsCandidate = lastCall
        .flatMap((arg) => {
          if (typeof arg !== 'object' || arg === null) {
            return []
          }

          if ('props' in arg && typeof arg.props === 'object' && arg.props !== null) {
            return [arg, arg.props]
          }

          return [arg]
        })
        .find((arg): arg is { onNavigate: (view: string) => void } => 'onNavigate' in arg && typeof arg.onNavigate === 'function')

      if (!propsCandidate) {
        throw new Error('Expected IconRail props to include onNavigate')
      }

      vi.mocked(nav.resetToBoard).mockClear()

      propsCandidate.onNavigate('board')

      expect(nav.resetToBoard).toHaveBeenCalled()
    })

    it('CMD+K opens the action palette', async () => {
      const App = (await import('./App.svelte')).default
      const actionPaletteModule = await import('./components/ActionPalette.svelte')

      render(App)

      await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(actionPaletteModule.default).toHaveBeenCalled()
      })
    })

  it('action palette move-to-done resets to board for the selected task view', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')
      const { getTasksForProject, updateTaskStatus } = await import('./lib/ipc')
      const actionPaletteModule = await import('./components/ActionPalette.svelte')

      const selectedTask: Task = {
        id: 'task-123',
        initial_prompt: 'Finish task',
        prompt: null,
        summary: null,
        status: 'doing',
        jira_key: null,
        jira_title: null,
        jira_status: null,
        jira_assignee: null,
        jira_description: null,
        agent: null,
        permission_mode: null,
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      vi.mocked(getTasksForProject).mockResolvedValue([
        selectedTask,
      ])

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)

      render(App)

      await vi.waitFor(() => {
        expect(getTasksForProject).toHaveBeenCalled()
      })

      await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(actionPaletteModule.default).toHaveBeenCalled()
      })

      const lastCall = vi.mocked(actionPaletteModule.default).mock.calls.at(-1)
      expect(lastCall).toBeTruthy()

      if (!lastCall) {
        throw new Error('Expected ActionPalette to receive props')
      }

      const propsCandidate = lastCall
        .flatMap((arg) => {
          if (typeof arg !== 'object' || arg === null) {
            return []
          }

          if ('props' in arg && typeof arg.props === 'object' && arg.props !== null) {
            return [arg, arg.props]
          }

          return [arg]
        })
        .find((arg): arg is { onExecute: (actionId: string) => Promise<void> } => 'onExecute' in arg && typeof arg.onExecute === 'function')

      if (!propsCandidate) {
        throw new Error('Expected ActionPalette props to include onExecute')
      }

      vi.mocked(nav.resetToBoard).mockClear()

      await propsCandidate.onExecute('move-to-done')

    expect(updateTaskStatus).toHaveBeenCalledWith('task-123', 'done')
    expect(nav.resetToBoard).toHaveBeenCalled()
  })

  it('action palette move-to-done uses the task that was selected when the palette opened', async () => {
    const App = (await import('./App.svelte')).default
    const stores = await import('./lib/stores')
    const nav = await import('./lib/router.svelte')
    const { getTasksForProject, updateTaskStatus } = await import('./lib/ipc')
    const actionPaletteModule = await import('./components/ActionPalette.svelte')

    const selectedTask: Task = {
      id: 'task-124',
      initial_prompt: 'Finish task after palette opens',
      prompt: null,
      summary: null,
      status: 'doing',
      jira_key: null,
      jira_title: null,
      jira_status: null,
      jira_assignee: null,
      jira_description: null,
      agent: null,
      permission_mode: null,
      project_id: 'proj-1',
      created_at: 1000,
      updated_at: 1000,
    }

    vi.mocked(getTasksForProject).mockResolvedValue([
      selectedTask,
    ])

    stores.tasks.set([selectedTask])
    stores.pendingTask.set(null)
    stores.selectedTaskId.set(selectedTask.id)

    render(App)

    await vi.waitFor(() => {
      expect(getTasksForProject).toHaveBeenCalled()
    })

    await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

    await vi.waitFor(() => {
      expect(actionPaletteModule.default).toHaveBeenCalled()
    })

    const lastCall = vi.mocked(actionPaletteModule.default).mock.calls.at(-1)
    if (!lastCall) throw new Error('Expected ActionPalette to receive props')

    const propsCandidate = lastCall
      .flatMap((arg) => {
        if (typeof arg !== 'object' || arg === null) return []
        if ('props' in arg && typeof arg.props === 'object' && arg.props !== null) return [arg, arg.props]
        return [arg]
      })
      .find((arg): arg is { onExecute: (actionId: string) => Promise<void> } => 'onExecute' in arg && typeof arg.onExecute === 'function')

    if (!propsCandidate) throw new Error('Expected ActionPalette props to include onExecute')

    stores.selectedTaskId.set(null)
    vi.mocked(nav.resetToBoard).mockClear()

    await propsCandidate.onExecute('move-to-done')

    expect(updateTaskStatus).toHaveBeenCalledWith('task-124', 'done')
    expect(nav.resetToBoard).toHaveBeenCalled()
  })

  it('action palette move-to-done navigates immediately without waiting for backend cleanup', async () => {
    const App = (await import('./App.svelte')).default
    const stores = await import('./lib/stores')
    const nav = await import('./lib/router.svelte')
    const { getTasksForProject, updateTaskStatus } = await import('./lib/ipc')
    const actionPaletteModule = await import('./components/ActionPalette.svelte')

    const selectedTask: Task = {
      id: 'task-123',
      initial_prompt: 'Finish task',
      prompt: null,
      summary: null,
      status: 'doing',
      jira_key: null,
      jira_title: null,
      jira_status: null,
      jira_assignee: null,
      jira_description: null,
      agent: null,
      permission_mode: null,
      project_id: 'proj-1',
      created_at: 1000,
      updated_at: 1000,
    }

    vi.mocked(getTasksForProject).mockResolvedValue([
      selectedTask,
    ])

    stores.tasks.set([selectedTask])
    stores.pendingTask.set(null)
    stores.selectedTaskId.set(selectedTask.id)

    let resolveUpdate: (() => void) | undefined
    vi.mocked(updateTaskStatus).mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        resolveUpdate = resolve
      }),
    )

    render(App)

    await vi.waitFor(() => {
      expect(getTasksForProject).toHaveBeenCalled()
    })

    await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

    await vi.waitFor(() => {
      expect(actionPaletteModule.default).toHaveBeenCalled()
    })

    const lastCall = vi.mocked(actionPaletteModule.default).mock.calls.at(-1)
    expect(lastCall).toBeTruthy()

    if (!lastCall) {
      throw new Error('Expected ActionPalette to receive props')
    }

    const propsCandidate = lastCall
      .flatMap((arg) => {
        if (typeof arg !== 'object' || arg === null) {
          return []
        }

        if ('props' in arg && typeof arg.props === 'object' && arg.props !== null) {
          return [arg, arg.props]
        }

        return [arg]
      })
      .find((arg): arg is { onExecute: (actionId: string) => Promise<void> } => 'onExecute' in arg && typeof arg.onExecute === 'function')

    if (!propsCandidate) {
      throw new Error('Expected ActionPalette props to include onExecute')
    }

    vi.mocked(nav.resetToBoard).mockClear()

    const execution = propsCandidate.onExecute('move-to-done')

    expect(updateTaskStatus).toHaveBeenCalledWith('task-123', 'done')
    expect(nav.resetToBoard).toHaveBeenCalled()

    resolveUpdate?.()
    await execution
  })

    it('action palette move-to-done navigates before IPC call', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')
      const { getTasksForProject, updateTaskStatus } = await import('./lib/ipc')
      const actionPaletteModule = await import('./components/ActionPalette.svelte')

      const selectedTask: Task = {
        id: 'task-200',
        initial_prompt: 'Order test',
        prompt: null,
        summary: null,
        status: 'doing',
        jira_key: null,
        jira_title: null,
        jira_status: null,
        jira_assignee: null,
        jira_description: null,
        agent: null,
        permission_mode: null,
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      vi.mocked(getTasksForProject).mockResolvedValue([
        selectedTask,
      ])

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)

      const callOrder: string[] = []
      vi.mocked(nav.resetToBoard).mockImplementation(() => { callOrder.push('resetToBoard') })
      vi.mocked(updateTaskStatus).mockImplementation(async () => { callOrder.push('updateTaskStatus') })

      render(App)

      await vi.waitFor(() => {
        expect(getTasksForProject).toHaveBeenCalled()
      })

      await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(actionPaletteModule.default).toHaveBeenCalled()
      })

      const lastCall = vi.mocked(actionPaletteModule.default).mock.calls.at(-1)
      if (!lastCall) throw new Error('Expected ActionPalette to receive props')

      const propsCandidate = lastCall
        .flatMap((arg) => {
          if (typeof arg !== 'object' || arg === null) return []
          if ('props' in arg && typeof arg.props === 'object' && arg.props !== null) return [arg, arg.props]
          return [arg]
        })
        .find((arg): arg is { onExecute: (actionId: string) => Promise<void> } => 'onExecute' in arg && typeof arg.onExecute === 'function')

      if (!propsCandidate) throw new Error('Expected ActionPalette props to include onExecute')

      await propsCandidate.onExecute('move-to-done')

      expect(callOrder).toEqual(['resetToBoard', 'updateTaskStatus'])

      vi.mocked(nav.resetToBoard).mockReset()
      vi.mocked(updateTaskStatus).mockReset()
      vi.mocked(updateTaskStatus).mockResolvedValue(undefined)
    })

    it('CMD+SHIFT+F opens search tasks', async () => {
      const App = (await import('./App.svelte')).default
      const commandPaletteModule = await import('./components/CommandPalette.svelte')

      render(App)

      await fireEvent.keyDown(window, { key: 'F', metaKey: true, shiftKey: true, bubbles: true })

      expect(commandPaletteModule.default).toHaveBeenCalled()
    })

    it('? opens the keyboard shortcuts dialog', async () => {
      const App = (await import('./App.svelte')).default
      const modalModule = await import('./components/Modal.svelte')

      render(App)

      await fireEvent.keyDown(window, { key: '?', bubbles: true })

      expect(modalModule.default).toHaveBeenCalled()
    })

    it('pressing 2 cycles to next project and resets to board', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const nav = await import('./lib/router.svelte')
      const { get } = await import('svelte/store')

      const projectList: Project[] = [
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
        { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
      ]
      vi.mocked(ipc.getProjects).mockResolvedValue(projectList)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.projects)).toHaveLength(2)
      })

      vi.mocked(nav.resetToBoard).mockClear()
      stores.activeProjectId.set('proj-1')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }))

      expect(get(stores.activeProjectId)).toBe('proj-2')
      expect(nav.resetToBoard).toHaveBeenCalled()
    })

    it('resets remembered Flow board tab when switching projects', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      const projectList: Project[] = [
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
        { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
      ]
      vi.mocked(ipc.getProjects).mockResolvedValue(projectList)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.projects)).toHaveLength(2)
      })

      stores.focusBoardFilters.set(new Map([
        ['proj-1', 'backlog'],
        ['proj-2', 'in-progress'],
      ]))

      stores.activeProjectId.set('proj-1')
      await vi.waitFor(() => {
        expect(get(stores.focusBoardFilters).get('proj-1')).toBeUndefined()
      })

      stores.focusBoardFilters.set(new Map([
        ['proj-1', 'backlog'],
        ['proj-2', 'in-progress'],
      ]))

      stores.activeProjectId.set('proj-2')
      await vi.waitFor(() => {
        expect(get(stores.focusBoardFilters).get('proj-2')).toBeUndefined()
      })
      expect(get(stores.focusBoardFilters).get('proj-1')).toBe('backlog')
    })

    it('pressing 1 cycles to previous project', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      const projectList: Project[] = [
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
        { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
      ]
      vi.mocked(ipc.getProjects).mockResolvedValue(projectList)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.projects)).toHaveLength(2)
      })

      stores.activeProjectId.set('proj-2')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))

      expect(get(stores.activeProjectId)).toBe('proj-1')
    })

    it('pressing 2 wraps around to first project', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      const projectList: Project[] = [
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
        { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
      ]
      vi.mocked(ipc.getProjects).mockResolvedValue(projectList)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.projects)).toHaveLength(2)
      })

      stores.activeProjectId.set('proj-2')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }))

      expect(get(stores.activeProjectId)).toBe('proj-1')
    })

    it('pressing Ctrl+N cycles to next project on the board and resets to board', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const nav = await import('./lib/router.svelte')
      const { get } = await import('svelte/store')

      const projectList: Project[] = [
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
        { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
      ]
      vi.mocked(ipc.getProjects).mockResolvedValue(projectList)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.projects)).toHaveLength(2)
      })

      stores.currentView.set('board')
      stores.selectedTaskId.set(null)
      vi.mocked(nav.resetToBoard).mockClear()
      stores.activeProjectId.set('proj-1')

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }))

      expect(get(stores.activeProjectId)).toBe('proj-2')
      expect(nav.resetToBoard).toHaveBeenCalled()
    })

    it('pressing Ctrl+P cycles to previous project on the board', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const nav = await import('./lib/router.svelte')
      const { get } = await import('svelte/store')

      const projectList: Project[] = [
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
        { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
      ]
      vi.mocked(ipc.getProjects).mockResolvedValue(projectList)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.projects)).toHaveLength(2)
      })

      stores.currentView.set('board')
      stores.selectedTaskId.set(null)
      vi.mocked(nav.resetToBoard).mockClear()
      stores.activeProjectId.set('proj-2')

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }))

      expect(get(stores.activeProjectId)).toBe('proj-1')
      expect(nav.resetToBoard).toHaveBeenCalled()
    })

    it('1 and 2 do not fire when input is focused', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      const projectList: Project[] = [
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
        { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
      ]
      vi.mocked(ipc.getProjects).mockResolvedValue(projectList)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.projects)).toHaveLength(2)
      })

      stores.activeProjectId.set('proj-1')
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))

      expect(get(stores.activeProjectId)).toBe('proj-1')
    })

    it('? does NOT open dialog when input is focused', async () => {
      const App = (await import('./App.svelte')).default
      render(App)

      // Create and focus an input element
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      // Dispatch ? key and check if preventDefault was called
      const event = new KeyboardEvent('keydown', { key: '?', bubbles: true })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
      window.dispatchEvent(event)

      // preventDefault should NOT be called (handler should not run)
      expect(preventDefaultSpy).not.toHaveBeenCalled()
    })

    it('s does NOT navigate when input is focused', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const { get } = await import('svelte/store')

      stores.currentView.set('board')
      render(App)

      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
      expect(get(stores.currentView)).toBe('board')
    })

    it('? opens dialog when input is NOT focused', async () => {
      const App = (await import('./App.svelte')).default
      render(App)

      // Dispatch ? key and check if preventDefault was called
      const event = new KeyboardEvent('keydown', { key: '?', bubbles: true })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
      window.dispatchEvent(event)

      // preventDefault should be called (handler should run)
      expect(preventDefaultSpy).toHaveBeenCalled()
    })

  })

  describe('github-sync-complete', () => {
    it('preserves locally merged state and definitive mergeability during background sync', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      stores.projects.set([])
      stores.tasks.set([])
      stores.ticketPrs.set(new Map())
      stores.activeProjectId.set('proj-1')

      vi.mocked(ipc.getProjects).mockResolvedValue([])
      vi.mocked(ipc.getTasksForProject).mockResolvedValue([])
      vi.mocked(ipc.getSessions).mockResolvedValue(new Map())
      vi.mocked(ipc.getProjectAttention).mockResolvedValue({
        project_id: 'proj-1',
        needs_input: 0,
        running_agents: 0,
        ci_failures: 0,
        unaddressed_comments: 0,
        completed_agents: 0
      })
      vi.mocked(ipc.getProjectConfig).mockResolvedValue(null)

      const prA: PullRequestInfo = {
        id: 42,
        ticket_id: 'T-42',
        repo_owner: 'owner',
        repo_name: 'repo',
        title: 'PR A',
        url: 'https://example.com',
        state: 'merged',
        merged_at: 1000,
        head_sha: 'abc',
        ci_status: null,
        ci_check_runs: null,
        review_status: null,
        mergeable: true,
        mergeable_state: 'clean',
        created_at: 0,
        updated_at: 0,
        draft: false,
        is_queued: false,
        unaddressed_comment_count: 0
      }
      const prB: PullRequestInfo = {
        ...prA,
        id: 99,
        ticket_id: 'T-99',
        title: 'PR B',
        state: 'open',
        merged_at: null,
        mergeable: false,
        mergeable_state: 'dirty'
      }
      
      stores.ticketPrs.set(new Map([
        ['T-42', [prA]],
        ['T-99', [prB]]
      ]))

      const transientPrA = { ...prA, state: 'open', merged_at: null }
      const transientPrB = { ...prB, mergeable: null, mergeable_state: 'unknown' }
      vi.mocked(ipc.getPullRequests).mockResolvedValue([transientPrA, transientPrB])

      render(App)

      const syncCallback = eventListeners.get('github-sync-complete')
      expect(syncCallback).toBeDefined()
      await syncCallback!()

      await new Promise(r => setTimeout(r, 0))

      const map = get(stores.ticketPrs)
      const newPrA = map.get('T-42')?.[0]
      const newPrB = map.get('T-99')?.[0]

      expect(newPrA?.state).toBe('merged')
      expect(newPrA?.merged_at).toBe(1000)

      expect(newPrB?.mergeable).toBe(false)
      expect(newPrB?.mergeable_state).toBe('dirty')
    })
  })
})
