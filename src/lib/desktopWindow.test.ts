import { describe, expect, it, vi } from 'vitest'
import { createDesktopWindow } from './desktopWindow'

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
