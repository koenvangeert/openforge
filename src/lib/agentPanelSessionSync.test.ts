import { describe, expect, it, vi } from 'vitest'

vi.mock('./desktopIpc', () => ({
  listenDesktopEvent: vi.fn(),
}))

import {
  createAgentStatusChangedHandler,
  getAgentPanelStatusFromSessionStatus,
  listenToAgentStatusChanged,
  shouldHydratePtyInstanceFromAgentStatusMetadata,
  type AgentPanelStatus,
} from './agentPanelSessionSync'
import { listenDesktopEvent } from './desktopIpc'

describe('agent panel session status synchronization', () => {
  it.each([
    ['running', 'running'],
    ['paused', 'paused'],
    ['completed', 'complete'],
    ['failed', 'error'],
    ['interrupted', 'error'],
    ['unknown', 'idle'],
    [null, 'idle'],
  ] as Array<[string | null, AgentPanelStatus]>)('maps session status %s to panel status %s', (sessionStatus, expected) => {
    expect(getAgentPanelStatusFromSessionStatus(sessionStatus)).toBe(expected)
  })

  it('ignores status events for other tasks', () => {
    const setStatus = vi.fn()
    const onRunning = vi.fn()
    const handler = createAgentStatusChangedHandler({
      taskId: 'T-1',
      setStatus,
      onRunning,
    })

    handler({ payload: { task_id: 'T-2', status: 'running' } })

    expect(setStatus).not.toHaveBeenCalled()
    expect(onRunning).not.toHaveBeenCalled()
  })

  it('updates panel status and runs the running hook for matching running events', () => {
    const setStatus = vi.fn()
    const onRunning = vi.fn()
    const handler = createAgentStatusChangedHandler({
      taskId: 'T-1',
      setStatus,
      onRunning,
    })

    handler({ payload: { task_id: 'T-1', status: 'running' } })

    expect(setStatus).toHaveBeenCalledWith('running')
    expect(onRunning).toHaveBeenCalledOnce()
  })

  it('does not run the running hook for terminal session statuses', () => {
    const setStatus = vi.fn()
    const onRunning = vi.fn()
    const handler = createAgentStatusChangedHandler({
      taskId: 'T-1',
      setStatus,
      onRunning,
    })

    handler({ payload: { task_id: 'T-1', status: 'completed' } })

    expect(setStatus).toHaveBeenCalledWith('complete')
    expect(onRunning).not.toHaveBeenCalled()
  })

  it('surfaces paused permission requests without treating them as running', () => {
    const setStatus = vi.fn()
    const onRunning = vi.fn()
    const handler = createAgentStatusChangedHandler({
      taskId: 'T-1',
      setStatus,
      onRunning,
    })

    handler({ payload: { task_id: 'T-1', status: 'paused', kind: 'requested_permission' } })

    expect(setStatus).toHaveBeenCalledWith('paused')
    expect(onRunning).not.toHaveBeenCalled()
  })

  it('hydrates PTY instance ids from matching running agent status events', () => {
    const setStatus = vi.fn()
    const onPtyInstanceId = vi.fn()
    const handler = createAgentStatusChangedHandler({
      taskId: 'T-1',
      setStatus,
      onPtyInstanceId,
    })

    handler({ payload: { task_id: 'T-1', status: 'running', kind: 'became_busy', pty_instance_id: 42 } })

    expect(onPtyInstanceId).toHaveBeenCalledWith(42)
  })

  it('does not hydrate PTY instance ids from terminal agent status events', () => {
    const setStatus = vi.fn()
    const onPtyInstanceId = vi.fn()
    const handler = createAgentStatusChangedHandler({
      taskId: 'T-1',
      setStatus,
      onPtyInstanceId,
    })

    handler({ payload: { task_id: 'T-1', status: 'completed', kind: 'ended', pty_instance_id: 42 } })

    expect(setStatus).toHaveBeenCalledWith('complete')
    expect(onPtyInstanceId).not.toHaveBeenCalled()
  })

  it.each([
    ['running', undefined, true],
    ['running', null, true],
    ['running', 'started', true],
    ['running', 'became_busy', true],
    ['running', 'became_idle', false],
    ['running', 'ended', false],
    ['completed', 'ended', false],
    ['paused', 'requested_permission', false],
  ] as const)('decides PTY hydration for status %s and kind %s', (status, kind, expected) => {
    expect(shouldHydratePtyInstanceFromAgentStatusMetadata(status, kind)).toBe(expected)
  })

  it('subscribes through the desktop event adapter so Electron and Tauri share the same path', async () => {
    const unlisten = vi.fn()
    vi.mocked(listenDesktopEvent).mockResolvedValueOnce(unlisten)

    await expect(listenToAgentStatusChanged({ taskId: 'T-1', setStatus: vi.fn() })).resolves.toBe(unlisten)

    expect(listenDesktopEvent).toHaveBeenCalledWith('agent-status-changed', expect.any(Function))
  })

  it('ignores unrecognized status events so stale events do not reset local panel state', () => {
    const setStatus = vi.fn()
    const handler = createAgentStatusChangedHandler({
      taskId: 'T-1',
      setStatus,
    })

    handler({ payload: { task_id: 'T-1', status: 'unknown' } })

    expect(setStatus).not.toHaveBeenCalled()
  })
})
