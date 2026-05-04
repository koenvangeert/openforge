import { describe, expect, it, vi } from 'vitest'

vi.mock('./desktopIpc', () => ({
  listenDesktopEvent: vi.fn(),
}))

import {
  createAgentStatusChangedHandler,
  getAgentPanelStatusFromSessionStatus,
  listenToAgentStatusChanged,
  type AgentPanelStatus,
} from './agentPanelSessionSync'
import { listenDesktopEvent } from './desktopIpc'

describe('agent panel session status synchronization', () => {
  it.each([
    ['running', 'running'],
    ['paused', 'running'],
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
