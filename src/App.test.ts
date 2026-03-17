import { render } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Task, AgentSession, Project, ProjectAttention, PullRequestInfo, CheckpointNotification, CiFailureNotification, RateLimitNotification, ShepherdMessage, ShepherdStatus } from './lib/types'

const callOrder: string[] = []

const eventListeners = new Map<string, Function>()

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
  selectedTaskId: writable<string | null>(null),
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
  currentView: writable('board'),
  reviewPrs: writable([]),
  selectedReviewPr: writable(null),
  prFileDiffs: writable([]),
  reviewRequestCount: writable(0),
  reviewComments: writable([]),
  pendingManualComments: writable([]),
  selectedReviewPrDetails: writable(null),
  reviewPullRequestDiff: writable(null),
  authoredPrCount: writable(0),
  commandHeld: writable(false),
  startingTasks: writable<Set<string>>(new Set()),
  codeCleanupTasksEnabled: writable(false),
   shepherdEnabled: writable(false),
   actionItemCount: writable(0),
   shepherdMessages: writable<ShepherdMessage[]>([]),
   shepherdStatus: writable<ShepherdStatus>('disabled'),
}))

vi.mock('./lib/ipc', () => ({
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
  updateTaskStatus: vi.fn(),
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
   notifyShepherdEvent: vi.fn(async () => {}),
   getShepherdMessages: vi.fn(async () => []),
   sendShepherdMessage: vi.fn(async () => {}),
   clearShepherdMessages: vi.fn(async () => {}),
   getShepherdEnabled: vi.fn(async () => false),
   getActionItemCount: vi.fn(async () => 0),
}))

vi.mock('./components/KanbanBoard.svelte', () => ({ default: vi.fn() }))
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

vi.mock('./lib/navigation', () => ({
  pushNavState: vi.fn(),
  navigateBack: vi.fn(),
  resetToBoard: vi.fn(),
}))

vi.mock('./lib/terminalPool', () => ({
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

  describe('keyboard shortcuts', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    afterEach(() => {
      document.body.innerHTML = ''
    })

    it('CMD+H navigates to board view', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const { get } = await import('svelte/store')

      render(App)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', metaKey: true, bubbles: true }))
      expect(get(stores.currentView)).toBe('board')
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

    it('pressing 2 cycles to next project and resets to board', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const nav = await import('./lib/navigation')
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

    it('s navigates to shepherd view when shepherd is enabled', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const { get } = await import('svelte/store')

      stores.shepherdEnabled.set(true)
      render(App)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
      expect(get(stores.currentView)).toBe('shepherd')
    })

    it('s does NOT navigate to shepherd when shepherd is disabled', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const { get } = await import('svelte/store')

      stores.shepherdEnabled.set(false)
      stores.currentView.set('board')
      render(App)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
      expect(get(stores.currentView)).toBe('board')
    })

    it('s does NOT navigate when input is focused', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const { get } = await import('svelte/store')

      stores.shepherdEnabled.set(true)
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
})

describe('Shepherd event wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventListeners.clear()
  })

  afterEach(() => {
    vi.clearAllMocks()
    eventListeners.clear()
  })

  it('calls notifyShepherdEvent with task-created when task-changed event has action=created', async () => {
    const ipc = await import('./lib/ipc')
    const stores = await import('./lib/stores')

    const App = (await import('./App.svelte')).default
    render(App)

    await vi.waitFor(() => {
      expect(eventListeners.has('task-changed')).toBe(true)
    }, { timeout: 5000 })

    stores.shepherdEnabled.set(true)

    const taskChangedCallback = eventListeners.get('task-changed')!
    await taskChangedCallback({
      payload: { action: 'created', task_id: 'task-123' }
    })

    expect(ipc.notifyShepherdEvent).toHaveBeenCalledWith('task-created', {
      action: 'created',
      task_id: 'task-123'
    })
  })

  it('calls notifyShepherdEvent with task-moved when task-changed event has action=updated', async () => {
    const ipc = await import('./lib/ipc')
    const stores = await import('./lib/stores')

    const App = (await import('./App.svelte')).default
    render(App)

    await vi.waitFor(() => {
      expect(eventListeners.has('task-changed')).toBe(true)
    }, { timeout: 5000 })

    stores.shepherdEnabled.set(true)

    const taskChangedCallback = eventListeners.get('task-changed')!
    await taskChangedCallback({
      payload: { action: 'updated', task_id: 'task-456' }
    })

    expect(ipc.notifyShepherdEvent).toHaveBeenCalledWith('task-moved', {
      action: 'updated',
      task_id: 'task-456'
    })
  })

  it('calls notifyShepherdEvent with task-deleted when task-changed event has action=deleted', async () => {
    const ipc = await import('./lib/ipc')
    const stores = await import('./lib/stores')

    const App = (await import('./App.svelte')).default
    render(App)

    await vi.waitFor(() => {
      expect(eventListeners.has('task-changed')).toBe(true)
    }, { timeout: 5000 })

    stores.shepherdEnabled.set(true)

    const taskChangedCallback = eventListeners.get('task-changed')!
    await taskChangedCallback({
      payload: { action: 'deleted', task_id: 'task-789' }
    })

    expect(ipc.notifyShepherdEvent).toHaveBeenCalledWith('task-deleted', {
      action: 'deleted',
      task_id: 'task-789'
    })
  })

  it('does not call notifyShepherdEvent when shepherdEnabled is false', async () => {
    const ipc = await import('./lib/ipc')
    const stores = await import('./lib/stores')

    stores.shepherdEnabled.set(false)

    const App = (await import('./App.svelte')).default
    render(App)

    await vi.waitFor(() => {
      expect(eventListeners.has('task-changed')).toBe(true)
    })

    const taskChangedCallback = eventListeners.get('task-changed')!
    await taskChangedCallback({
      payload: { action: 'created', task_id: 'task-999' }
    })

    expect(ipc.notifyShepherdEvent).not.toHaveBeenCalled()
  })

  describe('action item count updates', () => {
    it('action-item-created event triggers count refresh when shepherd enabled', async () => {
      const { listen } = await import('@tauri-apps/api/event')
      const ipc = await import('./lib/ipc')
      const stores = await import('./lib/stores')
      const { get } = await import('svelte/store')

      vi.mocked(ipc.getActionItemCount).mockResolvedValue(5)

      const App = (await import('./App.svelte')).default
      render(App)

      await vi.waitFor(() => {
        const calls = vi.mocked(listen).mock.calls
        const hasActionItemCreated = calls.some(call => call[0] === 'action-item-created')
        expect(hasActionItemCreated).toBe(true)
      })

      stores.activeProjectId.set('proj-1')
      stores.shepherdEnabled.set(true)

      const actionItemCreatedCall = vi.mocked(listen).mock.calls.find(
        call => call[0] === 'action-item-created'
      )
      expect(actionItemCreatedCall).toBeDefined()

      const actionItemCreatedCallback = actionItemCreatedCall![1] as Function
      await actionItemCreatedCallback({})

      await vi.waitFor(() => {
        expect(ipc.getActionItemCount).toHaveBeenCalledWith('proj-1')
        expect(get(stores.actionItemCount)).toBe(5)
      })
    })

    it('action-item-dismissed event triggers count refresh when shepherd enabled', async () => {
      const { listen } = await import('@tauri-apps/api/event')
      const ipc = await import('./lib/ipc')
      const stores = await import('./lib/stores')
      const { get } = await import('svelte/store')

      vi.mocked(ipc.getActionItemCount).mockResolvedValue(3)

      const App = (await import('./App.svelte')).default
      render(App)

      await vi.waitFor(() => {
        const calls = vi.mocked(listen).mock.calls
        const hasActionItemDismissed = calls.some(call => call[0] === 'action-item-dismissed')
        expect(hasActionItemDismissed).toBe(true)
      })

      stores.activeProjectId.set('proj-1')
      stores.shepherdEnabled.set(true)

      const actionItemDismissedCall = vi.mocked(listen).mock.calls.find(
        call => call[0] === 'action-item-dismissed'
      )
      expect(actionItemDismissedCall).toBeDefined()

      const actionItemDismissedCallback = actionItemDismissedCall![1] as Function
      await actionItemDismissedCallback({})

      await vi.waitFor(() => {
        expect(ipc.getActionItemCount).toHaveBeenCalledWith('proj-1')
        expect(get(stores.actionItemCount)).toBe(3)
      })
    })

    it('action-item-created event does NOT trigger count refresh when shepherd disabled', async () => {
      const { listen } = await import('@tauri-apps/api/event')
      const ipc = await import('./lib/ipc')
      const stores = await import('./lib/stores')

      const App = (await import('./App.svelte')).default
      render(App)

      await vi.waitFor(() => {
        const calls = vi.mocked(listen).mock.calls
        const hasActionItemCreated = calls.some(call => call[0] === 'action-item-created')
        expect(hasActionItemCreated).toBe(true)
      })

      stores.activeProjectId.set('proj-1')
      stores.shepherdEnabled.set(false)

      vi.mocked(ipc.getActionItemCount).mockClear()

      const actionItemCreatedCall = vi.mocked(listen).mock.calls.find(
        call => call[0] === 'action-item-created'
      )
      expect(actionItemCreatedCall).toBeDefined()

      const actionItemCreatedCallback = actionItemCreatedCall![1] as Function
      await actionItemCreatedCallback({})

      expect(ipc.getActionItemCount).not.toHaveBeenCalled()
    })
  })

  describe('loadProjects activeProjectId management', () => {
    it('resets activeProjectId to first project when the active project is no longer in the list', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      stores.activeProjectId.set('proj-deleted')

      vi.mocked(ipc.getProjects).mockResolvedValue([
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
      ])

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.projects)).toHaveLength(1)
      })

      expect(get(stores.activeProjectId)).toBe('proj-1')
    })

    it('resets activeProjectId to null when all projects were deleted', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      stores.activeProjectId.set('proj-deleted')

      vi.mocked(ipc.getProjects).mockResolvedValue([])

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.projects)).toHaveLength(0)
      })

      expect(get(stores.activeProjectId)).toBeNull()
    })
  })
})
