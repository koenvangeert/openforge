import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tauriInvokeMock, tauriListenMock } = vi.hoisted(() => ({
  tauriInvokeMock: vi.fn(),
  tauriListenMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriInvokeMock,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauriListenMock,
}))

import { invokeDesktopCommand, listenDesktopEvent } from './desktopIpc'

describe('desktop IPC transport', () => {
  beforeEach(() => {
    tauriInvokeMock.mockReset()
    tauriListenMock.mockReset()
    delete window.openforge
  })

  it('uses Electron preload invoke when window.openforge is present', async () => {
    const electronInvoke = vi.fn().mockResolvedValue({ id: 'P-1' })
    window.openforge = {
      version: 1,
      invoke: electronInvoke,
      onEvent: vi.fn(),
    }

    await expect(invokeDesktopCommand('get_project', { projectId: 'P-1' })).resolves.toEqual({ id: 'P-1' })

    expect(electronInvoke).toHaveBeenCalledWith('get_project', { projectId: 'P-1' })
    expect(tauriInvokeMock).not.toHaveBeenCalled()
  })

  it('falls back to Tauri invoke when Electron preload is unavailable', async () => {
    tauriInvokeMock.mockResolvedValue(['P-1'])

    await expect(invokeDesktopCommand('get_projects')).resolves.toEqual(['P-1'])

    expect(tauriInvokeMock).toHaveBeenCalledWith('get_projects')
  })

  it('preserves payloads when falling back to Tauri invoke', async () => {
    tauriInvokeMock.mockResolvedValue(7)

    await invokeDesktopCommand('pty_spawn_shell', {
      taskId: 'T-1',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      terminalIndex: 2,
    })

    expect(tauriInvokeMock).toHaveBeenCalledWith('pty_spawn_shell', {
      taskId: 'T-1',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      terminalIndex: 2,
    })
  })

  it('subscribes through Electron preload events and returns a synchronous unsubscriber', async () => {
    const unsubscribe = vi.fn()
    const electronHandlers: Array<(payload: unknown) => void> = []
    const onEvent = vi.fn((_eventName: string, handler: (payload: unknown) => void) => {
      electronHandlers.push(handler)
      return unsubscribe
    })
    const handler = vi.fn()
    window.openforge = {
      version: 1,
      invoke: vi.fn(),
      onEvent,
    }

    const unlisten = await listenDesktopEvent('task-changed', handler)
    expect(electronHandlers).toHaveLength(1)
    electronHandlers[0]({ action: 'updated', task_id: 'T-1' })

    expect(onEvent).toHaveBeenCalledWith('task-changed', expect.any(Function))
    expect(handler).toHaveBeenCalledWith({ event: 'task-changed', payload: { action: 'updated', task_id: 'T-1' } })
    unlisten()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(tauriListenMock).not.toHaveBeenCalled()
  })

  it('falls back to Tauri events when Electron preload is unavailable', async () => {
    const tauriUnlisten = vi.fn()
    tauriListenMock.mockResolvedValue(tauriUnlisten)
    const handler = vi.fn()

    const unlisten = await listenDesktopEvent('task-changed', handler)

    expect(tauriListenMock).toHaveBeenCalledWith('task-changed', handler)
    unlisten()
    expect(tauriUnlisten).toHaveBeenCalledOnce()
  })
})
