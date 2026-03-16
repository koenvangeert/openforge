import { render } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Task, AgentSession, Project, ProjectAttention, PullRequestInfo, CheckpointNotification, CiFailureNotification } from './lib/types'

const callOrder: string[] = []

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_eventName: string) => {
    callOrder.push('listen')
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
  skills: writable([]),
  selectedSkillName: writable(null),
  startingTasks: writable(new Set()),
  codeCleanupTasksEnabled: writable(false),
  authoredPrCount: writable(0),
  commandHeld: writable(false),
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
  getProjectConfig: vi.fn(),
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
  getAuthoredPrs: vi.fn(async () => []),
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

    it('pressing 2 cycles to next project', async () => {
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
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }))

      expect(get(stores.activeProjectId)).toBe('proj-2')
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
