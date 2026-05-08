import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { activeSessions, checkpointNotification, taskRuntimeInfo } from './stores'
import type { AgentSession } from './types'
import { registerAppDesktopEventListeners } from './appDesktopEventListeners'
import type { AppEventListen } from './appDesktopEventListeners'
import { appShellEventContracts } from './electronMigrationContracts'
import type { DesktopUnlistenFn } from './desktopIpc'

vi.mock('./terminalPool', () => ({
  release: vi.fn(),
  replayPtyBuffersForActiveTerminals: vi.fn(async () => undefined),
}))

vi.mock('./ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ipc')>()
  return {
    ...actual,
    getLatestSession: vi.fn(),
    finalizeAgentSession: vi.fn(),
    getTaskDetail: vi.fn(),
  }
})

import { release, replayPtyBuffersForActiveTerminals } from './terminalPool'
import { finalizeAgentSession, getLatestSession } from './ipc'

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
  const unlisten: DesktopUnlistenFn = vi.fn()
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

describe('registerAppDesktopEventListeners', () => {
  beforeEach(() => {
    activeSessions.set(new Map())
    checkpointNotification.set(null)
    taskRuntimeInfo.set(new Map())
    vi.clearAllMocks()
  })

  it('registers window close handling and all shell event channels', async () => {
    const { deps, listen, onCloseRequested } = createHarness()

    const unlisteners = await registerAppDesktopEventListeners(deps)

    expect(onCloseRequested).toHaveBeenCalledWith(deps.onCloseRequested)
    expect(unlisteners).toHaveLength(appShellEventContracts.length + 1)
    expect(listen.mock.calls.map(([eventName]) => eventName)).toEqual(
      appShellEventContracts.map(contract => contract.eventName),
    )
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

    await registerAppDesktopEventListeners(deps)
    await handlers.get('action-complete')?.({ payload: { task_id: 'task-1' } })

    expect(get(activeSessions).get('task-1')?.status).toBe('completed')
    expect(get(activeSessions).get('task-1')?.checkpoint_data).toBeNull()
    expect(get(checkpointNotification)).toBeNull()
    expect(deps.loadTasks).toHaveBeenCalledOnce()
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
  })

  it('reloads authoritative state when the app event stream reports a delivery gap', async () => {
    const { deps, handlers } = createHarness()

    await registerAppDesktopEventListeners(deps)
    await handlers.get('openforge-app-events-gap')?.({
      payload: { requestedAfter: 'epoch-1:1', oldestAvailable: 'epoch-1:4', newestAvailable: 'epoch-1:8' },
    })

    expect(deps.loadTasks).toHaveBeenCalledOnce()
    expect(deps.loadSessions).toHaveBeenCalledOnce()
    expect(deps.loadPullRequests).toHaveBeenCalledOnce()
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
    expect(deps.refreshPrCounts).toHaveBeenCalledOnce()
    expect(replayPtyBuffersForActiveTerminals).toHaveBeenCalledOnce()
  })

  it('applies sidecar-forwarded OpenCode checkpoint events to active sessions', async () => {
    const { deps, handlers } = createHarness()
    activeSessions.set(new Map([['task-1', createSession({ status: 'running', checkpoint_data: null })]]))

    await registerAppDesktopEventListeners(deps)
    await handlers.get('agent-event')?.({
      payload: {
        task_id: 'task-1',
        event_type: 'permission.asked',
        data: '{"properties":{"description":"Allow file write?"}}',
        timestamp: 123,
      },
    })

    expect(get(activeSessions).get('task-1')?.status).toBe('paused')
    expect(get(activeSessions).get('task-1')?.checkpoint_data).toBe('{"properties":{"description":"Allow file write?"}}')
    expect(get(checkpointNotification)?.ticketId).toBe('task-1')
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
  })

  it('records runtime info and latest session on session-resumed without legacy OpenCode server port state', async () => {
    const { deps, handlers } = createHarness()
    vi.mocked(getLatestSession).mockResolvedValue(createSession({ id: 'session-resumed' }))

    await registerAppDesktopEventListeners(deps)
    await handlers.get('session-resumed')?.({
      payload: { task_id: 'task-1', workspace_path: '/tmp/work' },
    })

    expect(get(taskRuntimeInfo).get('task-1')).toEqual({ workspacePath: '/tmp/work' })
    expect(get(activeSessions).get('task-1')?.id).toBe('session-resumed')
  })

  it('finalizes agent PTY exits through the provider-neutral IPC wrapper', async () => {
    vi.useFakeTimers()
    const { deps, handlers } = createHarness()

    await registerAppDesktopEventListeners(deps)
    await handlers.get('agent-pty-exited')?.({ payload: { task_id: 'task-1', success: true } })
    await vi.advanceTimersByTimeAsync(1500)

    expect(finalizeAgentSession).toHaveBeenCalledWith('task-1', true)
    vi.useRealTimers()
  })

  it('clears active session and releases terminal when task is deleted', async () => {
    const { deps, handlers } = createHarness()
    activeSessions.set(new Map([['task-1', createSession()]]))

    await registerAppDesktopEventListeners(deps)
    await handlers.get('task-changed')?.({ payload: { action: 'deleted', task_id: 'task-1' } })

    expect(get(activeSessions).has('task-1')).toBe(false)
    expect(release).toHaveBeenCalledWith('task-1')
    expect(deps.loadTasks).toHaveBeenCalledOnce()
  })
})
