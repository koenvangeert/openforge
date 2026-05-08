import { describe, expect, it, vi } from 'vitest'
import { createDesktopWindow, type DesktopCloseRequestEvent } from './desktopWindow'

describe('desktop window abstraction', () => {
  it('requires the Electron preload bridge for desktop window controls', () => {
    expect(() => createDesktopWindow({ electronBridge: null })).toThrow('Electron shell')
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

  it('requests Electron app quit when destroy closes after confirmation', async () => {
    const quitApp = vi.fn(async () => undefined)
    const desktopWindow = createDesktopWindow({
      electronBridge: { version: 1, invoke: vi.fn(), onEvent: vi.fn() },
      quitApp,
    })

    await desktopWindow.destroy()

    expect(quitApp).toHaveBeenCalledTimes(1)
  })

  it('does not re-run Electron close-request handlers when destroy requests app quit after confirmation', async () => {
    const listeners = new Map<string, EventListener>()
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
      if (typeof listener === 'function') listeners.set(type, listener)
    })
    vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type)
    })
    const quitApp = vi.fn(async () => {
      listeners.get('beforeunload')?.(new Event('beforeunload', { cancelable: true }))
    })
    const handler = vi.fn((event: DesktopCloseRequestEvent) => event.preventDefault())
    const desktopWindow = createDesktopWindow({
      electronBridge: { version: 1, invoke: vi.fn(), onEvent: vi.fn() },
      quitApp,
    })

    await desktopWindow.onCloseRequested(handler)
    await desktopWindow.destroy()

    expect(quitApp).toHaveBeenCalledTimes(1)
    expect(handler).not.toHaveBeenCalled()

    vi.restoreAllMocks()
  })
})
