import { render } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Task, AgentSession, Project, ProjectAttention, OpenCodeStatus, PullRequestInfo, CheckpointNotification, CiFailureNotification } from './lib/types'

const callOrder: string[] = []

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName: string) => {
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
  taskSpawned: writable<{ taskId: string; title: string } | null>(null),
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
  searchQuery: writable(''),
  skills: writable([]),
  selectedSkillName: writable(null),
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
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  getProjectConfig: vi.fn(),
  setProjectConfig: vi.fn(),
  startImplementation: vi.fn(),
  runAction: vi.fn(),
  getWorktreeForTask: vi.fn(),
  getSessionStatus: vi.fn(),
  abortSession: vi.fn(),
  getAgentLogs: vi.fn(),
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
}))

vi.mock('./components/KanbanBoard.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/TaskDetailView.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/PrReviewView.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/SkillsView.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/ClaudeAgentPanel.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/PromptInput.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/Modal.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/SettingsPanel.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/GlobalSettingsPanel.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/Toast.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/CheckpointToast.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/CiFailureToast.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/TaskSpawnedToast.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/ProjectSwitcher.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/ProjectSetupDialog.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/IconRail.svelte', () => ({ default: vi.fn() }))

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

vi.mock('lucide-svelte', () => ({
  RefreshCw: vi.fn(),
}))

describe('App onMount initialization order', () => {
  beforeEach(() => {
    callOrder.length = 0
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

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

    expect(firstListen).toBeLessThan(firstGetProjects, 'listen() should be called before getProjects()')
    expect(firstListen).toBeLessThan(firstGetAppMode, 'listen() should be called before getAppMode()')
  })
})
