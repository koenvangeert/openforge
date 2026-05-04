import { describe, expect, it, vi } from 'vitest'
import { createOpenForgePreloadApi } from './preloadApi'

describe('Electron preload API skeleton', () => {
  it('exposes a narrow bridge without raw Node or HTTP capabilities', () => {
    const ipc = {
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }

    const api = createOpenForgePreloadApi(ipc)

    expect(Object.keys(api).sort()).toEqual(['invoke', 'onEvent', 'version'])
    expect(api).not.toHaveProperty('require')
    expect(api).not.toHaveProperty('fetch')
    expect(api).not.toHaveProperty('process')
  })

  it('routes command requests through one Electron IPC channel', async () => {
    const ipc = {
      invoke: vi.fn().mockResolvedValue({ ok: true }),
      on: vi.fn(),
      off: vi.fn(),
    }

    const api = createOpenForgePreloadApi(ipc)
    await expect(api.invoke('get_projects')).resolves.toEqual({ ok: true })

    expect(ipc.invoke).toHaveBeenCalledWith('openforge:invoke', {
      command: 'get_projects',
      payload: null,
    })
  })

  it('subscribes and unsubscribes to filtered app event payloads', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const ipc = {
      invoke: vi.fn(),
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener)
      }),
      off: vi.fn(),
    }
    const handler = vi.fn()

    const api = createOpenForgePreloadApi(ipc)
    const unsubscribe = api.onEvent('task-changed', handler)

    listeners.get('openforge:event')?.({}, { eventName: 'github-sync-complete', payload: {} })
    listeners.get('openforge:event')?.({}, { eventName: 'task-changed', payload: { action: 'updated', task_id: 'T-1' } })
    unsubscribe()

    expect(handler).toHaveBeenCalledWith({ action: 'updated', task_id: 'T-1' })
    expect(ipc.off).toHaveBeenCalledWith('openforge:event', expect.any(Function))
  })
})
