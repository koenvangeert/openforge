import { describe, expect, it, vi } from 'vitest'
import { openDevToolsForDevelopment, shouldOpenDevTools } from './devTools'

describe('Electron development DevTools policy', () => {
  it('opens renderer DevTools automatically for the Vite development renderer', () => {
    const openDevTools = vi.fn()

    const didOpen = openDevToolsForDevelopment(
      { webContents: { openDevTools } },
      { ELECTRON_RENDERER_URL: 'http://127.0.0.1:1420' },
    )

    expect(didOpen).toBe(true)
    expect(openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
  })

  it('allows devtools to be explicitly disabled for development smoke runs', () => {
    expect(shouldOpenDevTools({
      ELECTRON_RENDERER_URL: 'http://127.0.0.1:1420',
      OPENFORGE_ELECTRON_DEVTOOLS: '0',
    })).toBe(false)
  })

  it('keeps packaged production windows closed unless explicitly enabled', () => {
    const openDevTools = vi.fn()

    const didOpen = openDevToolsForDevelopment({ webContents: { openDevTools } }, {})

    expect(didOpen).toBe(false)
    expect(openDevTools).not.toHaveBeenCalled()
  })

  it('can be explicitly enabled without a development renderer URL', () => {
    expect(shouldOpenDevTools({ OPENFORGE_ELECTRON_DEVTOOLS: '1' })).toBe(true)
  })
})
