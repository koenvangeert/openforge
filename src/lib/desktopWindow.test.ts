import { describe, expect, it, vi } from 'vitest'
import { createDesktopWindow, type DesktopCloseRequestEvent } from './desktopWindow'

describe('desktop window abstraction', () => {
  it('does not call Tauri getCurrentWindow when the Electron preload bridge is present', async () => {
    const getCurrentWindow = vi.fn(() => {
      throw new Error('Tauri metadata is unavailable in Electron')
    })
    const close = vi.fn()

    const desktopWindow = createDesktopWindow({
      electronBridge: { version: 1, invoke: vi.fn(), onEvent: vi.fn() },
      close,
      getCurrentWindow,
    })

    await expect(desktopWindow.onCloseRequested(() => undefined)).resolves.toEqual(expect.any(Function))
    await desktopWindow.destroy()

    expect(getCurrentWindow).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
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
      getCurrentWindow: vi.fn(),
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
      getCurrentWindow: vi.fn(),
    })

    await desktopWindow.onCloseRequested(handler)
    await desktopWindow.destroy()

    expect(close).toHaveBeenCalledTimes(1)
    expect(handler).not.toHaveBeenCalled()

    vi.restoreAllMocks()
  })

  it('delegates close-request handling and destroy to Tauri when Electron bridge is absent', async () => {
    const unlisten = vi.fn()
    const onCloseRequested = vi.fn(async () => unlisten)
    const destroy = vi.fn(async () => undefined)
    const getCurrentWindow = vi.fn(() => ({ onCloseRequested, destroy }))
    const handler = vi.fn()

    const desktopWindow = createDesktopWindow({
      electronBridge: null,
      close: vi.fn(),
      getCurrentWindow,
    })

    await expect(desktopWindow.onCloseRequested(handler)).resolves.toBe(unlisten)
    await desktopWindow.destroy()

    expect(getCurrentWindow).toHaveBeenCalledTimes(1)
    expect(onCloseRequested).toHaveBeenCalledWith(handler)
    expect(destroy).toHaveBeenCalled()
  })
})
