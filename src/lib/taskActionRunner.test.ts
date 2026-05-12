import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { PullRequestInfo, Project, Task } from './types'

vi.mock('./ipc', () => ({
  deleteTask: vi.fn(),
  getSessionStatus: vi.fn(),
  mergePullRequest: vi.fn(),
  startImplementation: vi.fn(),
}))

vi.mock('./ptySubmit', () => ({
  writePtyWithSubmit: vi.fn(),
}))

vi.mock('./terminalPool', () => ({
  focusTerminal: vi.fn(),
  isPtyActive: vi.fn(() => false),
}))

vi.mock('./moveToComplete', () => ({
  moveTaskToComplete: vi.fn(),
}))

import { createTaskActionRunner } from './taskActionRunner'
import {
  activeSessions,
  error,
  startingTasks,
  taskRuntimeInfo,
  ticketPrs,
} from './stores'
import { getSessionStatus, mergePullRequest, startImplementation } from './ipc'
import { focusTerminal, isPtyActive } from './terminalPool'
import { writePtyWithSubmit } from './ptySubmit'

const activeProject: Project = {
  id: 'proj-1',
  name: 'Project',
  path: '/project',
  created_at: 1000,
  updated_at: 1000,
}

const task: Task = {
  id: 'T-42',
  initial_prompt: 'Prompt',
  prompt: null,
  summary: null,
  status: 'doing',
  agent: null,
  permission_mode: null,
  depends_on: [],
  project_id: 'proj-1',
  created_at: 1000,
  updated_at: 1000,
}

function createPullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 42,
    ticket_id: task.id,
    repo_owner: 'owner',
    repo_name: 'repo',
    title: 'PR',
    url: 'https://example.com/pr',
    state: 'open',
    merged_at: null,
    head_sha: 'abc',
    ci_status: 'success',
    ci_check_runs: null,
    review_status: 'approved',
    mergeable: true,
    mergeable_state: 'clean',
    created_at: 0,
    updated_at: 0,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    ...overrides,
  }
}

describe('createTaskActionRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeSessions.set(new Map())
    error.set(null)
    startingTasks.set(new Set())
    taskRuntimeInfo.set(new Map())
    ticketPrs.set(new Map())
    vi.mocked(isPtyActive).mockReturnValue(false)
  })

  it('starts a task, stores runtime/session state, reloads tasks, and clears starting state', async () => {
    const loadTasks = vi.fn(async () => undefined)
    const triggerGithubSync = vi.fn(async () => undefined)
    vi.mocked(startImplementation).mockResolvedValue({ session_id: 'session-1', workspace_path: '/workspace/T-42', task_id: task.id, port: 0 } as any)
    vi.mocked(getSessionStatus).mockResolvedValue({ ticket_id: task.id, status: 'running' } as any)

    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks,
      triggerGithubSync,
    })

    await runner.handleRunAction({ taskId: task.id, actionPrompt: '', agent: null })

    expect(startImplementation).toHaveBeenCalledWith(task.id, activeProject.path)
    expect(get(taskRuntimeInfo).get(task.id)).toEqual({ workspacePath: '/workspace/T-42' })
    expect(get(activeSessions).get(task.id)).toEqual({ ticket_id: task.id, status: 'running' })
    expect(loadTasks).toHaveBeenCalledOnce()
    expect(focusTerminal).toHaveBeenCalledWith(task.id)
    expect(get(startingTasks).has(task.id)).toBe(false)
  })

  it('writes to an active PTY instead of starting a new implementation', async () => {
    vi.mocked(isPtyActive).mockReturnValue(true)
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
      triggerGithubSync: vi.fn(async () => undefined),
    })

    await runner.handleRunAction({ taskId: task.id, actionPrompt: 'continue', agent: null })

    expect(writePtyWithSubmit).toHaveBeenCalledWith(task.id, 'continue')
    expect(startImplementation).not.toHaveBeenCalled()
    expect(focusTerminal).toHaveBeenCalledWith(task.id)
  })

  it('does not merge and sets the exact disambiguation error when multiple PRs are ready', async () => {
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
      triggerGithubSync: vi.fn(async () => undefined),
    })
    const firstReadyPr = createPullRequest({ id: 1, title: 'First ready PR', head_sha: 'abc' })
    const secondReadyPr = createPullRequest({ id: 2, title: 'Second ready PR', head_sha: 'def' })
    ticketPrs.set(new Map([[task.id, [firstReadyPr, secondReadyPr]]]))

    await runner.mergeReadyPullRequest(task)

    expect(mergePullRequest).not.toHaveBeenCalled()
    expect(get(ticketPrs).get(task.id)).toEqual([firstReadyPr, secondReadyPr])
    expect(get(error)).toBe('Multiple pull requests are ready to merge. Open the task details to choose the correct PR.')
  })

  it('marks a single ready PR merged locally and then triggers GitHub sync', async () => {
    const triggerGithubSync = vi.fn(async () => undefined)
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
      triggerGithubSync,
    })
    const readyPr = createPullRequest()
    ticketPrs.set(new Map([[task.id, [readyPr]]]))
    vi.mocked(mergePullRequest).mockResolvedValue(undefined)

    await runner.mergeReadyPullRequest(task)

    expect(mergePullRequest).toHaveBeenCalledWith('owner', 'repo', 42)
    expect(get(ticketPrs).get(task.id)?.[0].state).toBe('merged')
    expect(get(ticketPrs).get(task.id)?.[0].merged_at).not.toBeNull()
    expect(triggerGithubSync).toHaveBeenCalledOnce()
  })
})
