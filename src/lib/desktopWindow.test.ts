import { describe, expect, it, vi } from 'vitest'
import { createDesktopWindow, type DesktopCloseRequestEvent } from './desktopWindow'

describe('desktop window abstraction', () => {
  it('requires the Electron preload bridge for desktop window controls', () => {
    expect(() => createDesktopWindow({ electronBridge: null, close: vi.fn() })).toThrow('Electron shell')
  })

  it('adapts Electron beforeunload into close-request callbacks', async () => {
    const listeners = new Map<string, EventListener>()
    const addEventListener = vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
      if (typeof listener === 'function') listeners.set(type, listener)
    })
    const removeEventListener = vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type)
    })
    const handler = vi.fn((event: DesktopCloseRequestEvent) => event.preventDefault())
    const desktopWindow = createDesktopWindow({
      electronBridge: { version: 1, invoke: vi.fn(), onEvent: vi.fn() },
      close: vi.fn(),
    })

    const unlisten = await desktopWindow.onCloseRequested(handler)
    const event = new Event('beforeunload', { cancelable: true })
    listeners.get('beforeunload')?.(event)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)

    unlisten()
    const secondEvent = new Event('beforeunload', { cancelable: true })
    listeners.get('beforeunload')?.(secondEvent)
    expect(handler).toHaveBeenCalledTimes(1)

    addEventListener.mockRestore()
    removeEventListener.mockRestore()
  })

  it('does not re-run Electron close-request handlers when destroy closes after confirmation', async () => {
    const listeners = new Map<string, EventListener>()
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
      if (typeof listener === 'function') listeners.set(type, listener)
    })
    vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type)
    })
    const close = vi.fn(() => {
      listeners.get('beforeunload')?.(new Event('beforeunload', { cancelable: true }))
    })
    const handler = vi.fn((event: DesktopCloseRequestEvent) => event.preventDefault())
    const desktopWindow = createDesktopWindow({
      electronBridge: { version: 1, invoke: vi.fn(), onEvent: vi.fn() },
      close,
    })

    await desktopWindow.onCloseRequested(handler)
    await desktopWindow.destroy()

    expect(close).toHaveBeenCalledTimes(1)
    expect(handler).not.toHaveBeenCalled()

    vi.restoreAllMocks()
  })
})
