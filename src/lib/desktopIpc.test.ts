import { beforeEach, describe, expect, it, vi } from 'vitest'

import { invokeDesktopCommand, listenDesktopEvent } from './desktopIpc'

describe('desktop IPC transport', () => {
  beforeEach(() => {
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
  })

  it('fails fast outside the Electron shell instead of falling back to Tauri invoke', async () => {
    await expect(invokeDesktopCommand('get_projects')).rejects.toThrow('Electron shell')
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
  })

  it('fails fast outside the Electron shell instead of falling back to Tauri events', async () => {
    await expect(listenDesktopEvent('task-changed', vi.fn())).rejects.toThrow('Electron shell')
  })
})
