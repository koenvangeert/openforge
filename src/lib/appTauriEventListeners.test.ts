import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { activeSessions, checkpointNotification, taskRuntimeInfo } from './stores'
import type { AgentSession } from './types'
import { registerAppTauriEventListeners } from './appTauriEventListeners'
import type { AppEventListen } from './appTauriEventListeners'
import type { UnlistenFn } from '@tauri-apps/api/event'

vi.mock('./terminalPool', () => ({
  release: vi.fn(),
}))

vi.mock('./ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ipc')>()
  return {
    ...actual,
    getLatestSession: vi.fn(),
    finalizeClaudeSession: vi.fn(),
    getTaskDetail: vi.fn(),
  }
})

import { release } from './terminalPool'
import { getLatestSession } from './ipc'

function createSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'session-1',
    ticket_id: 'task-1',
    provider: 'opencode',
    opencode_session_id: 'provider-session-1',
    claude_session_id: null,
    pi_session_id: null,
    status: 'running',
    stage: 'running',
    checkpoint_data: null,
    error_message: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  }
}

function createHarness() {
  const handlers = new Map<string, (event: { payload: unknown }) => unknown>()
  const unlisten: UnlistenFn = vi.fn()
  const listen = vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => unknown) => {
    handlers.set(eventName, handler)
    return unlisten
  })
  const onCloseRequested = vi.fn(async () => unlisten)

  const deps = {
    appWindow: { onCloseRequested },
    onCloseRequested: vi.fn(),
    loadTasks: vi.fn(async () => undefined),
    loadSessions: vi.fn(async () => undefined),
    loadPullRequests: vi.fn(async () => undefined),
    loadProjectAttention: vi.fn(async () => undefined),
    refreshPrCounts: vi.fn(async () => undefined),
    listen: listen as unknown as AppEventListen,
  }

  return { handlers, deps, unlisten, listen, onCloseRequested }
}

describe('registerAppTauriEventListeners', () => {
  beforeEach(() => {
    activeSessions.set(new Map())
    checkpointNotification.set(null)
    taskRuntimeInfo.set(new Map())
    vi.clearAllMocks()
  })

  it('registers window close handling and all shell event channels', async () => {
    const { deps, listen, onCloseRequested } = createHarness()

    const unlisteners = await registerAppTauriEventListeners(deps)

    expect(onCloseRequested).toHaveBeenCalledWith(deps.onCloseRequested)
    expect(unlisteners).toHaveLength(18)
    expect(listen.mock.calls.map(([eventName]) => eventName)).toEqual([
      'github-sync-complete',
      'review-status-changed',
      'action-complete',
      'implementation-failed',
      'server-resumed',
      'startup-resume-complete',
      'new-pr-comment',
      'comment-addressed',
      'ci-status-changed',
      'agent-event',
      'session-aborted',
      'agent-status-changed',
      'agent-pty-exited',
      'review-pr-count-changed',
      'authored-prs-updated',
      'github-rate-limited',
      'task-changed',
    ])
  })

  it('marks action-complete sessions completed and clears checkpoint notification', async () => {
    const { deps, handlers } = createHarness()
    activeSessions.set(new Map([['task-1', createSession()]]))
    checkpointNotification.set({
      ticketId: 'task-1',
      ticketKey: 'task-1',
      sessionId: 'session-1',
      stage: 'running',
      message: 'Agent needs input',
      timestamp: 123,
    })

    await registerAppTauriEventListeners(deps)
    await handlers.get('action-complete')?.({ payload: { task_id: 'task-1' } })

    expect(get(activeSessions).get('task-1')?.status).toBe('completed')
    expect(get(activeSessions).get('task-1')?.checkpoint_data).toBeNull()
    expect(get(checkpointNotification)).toBeNull()
    expect(deps.loadTasks).toHaveBeenCalledOnce()
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
  })

  it('records runtime info and latest session on server-resumed', async () => {
    const { deps, handlers } = createHarness()
    vi.mocked(getLatestSession).mockResolvedValue(createSession({ id: 'session-resumed' }))

    await registerAppTauriEventListeners(deps)
    await handlers.get('server-resumed')?.({
      payload: { task_id: 'task-1', port: 1234, workspace_path: '/tmp/work' },
    })

    expect(get(taskRuntimeInfo).get('task-1')).toEqual({ workspacePath: '/tmp/work', opencodePort: 1234 })
    expect(get(activeSessions).get('task-1')?.id).toBe('session-resumed')
  })

  it('clears active session and releases terminal when task is deleted', async () => {
    const { deps, handlers } = createHarness()
    activeSessions.set(new Map([['task-1', createSession()]]))

    await registerAppTauriEventListeners(deps)
    await handlers.get('task-changed')?.({ payload: { action: 'deleted', task_id: 'task-1' } })

    expect(get(activeSessions).has('task-1')).toBe(false)
    expect(release).toHaveBeenCalledWith('task-1')
    expect(deps.loadTasks).toHaveBeenCalledOnce()
  })
})
