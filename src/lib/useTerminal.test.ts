import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock xterm.js — class-style so `new Terminal(...)` works in vitest
vi.mock('@xterm/xterm', () => {
  class Terminal {
    open = vi.fn()
    write = vi.fn()
    dispose = vi.fn()
    onData = vi.fn()
    loadAddon = vi.fn()
    refresh = vi.fn()
    focus = vi.fn()
    cols = 80
    rows = 24
  }
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit = vi.fn()
    dispose = vi.fn()
    proposeDimensions = vi.fn().mockReturnValue({ cols: 80, rows: 24 })
  }
  return { FitAddon }
})

import { createTerminal } from './useTerminal.svelte'

describe('createTerminal', () => {
  let onData: (data: string) => void
  let onResize: (cols: number, rows: number) => void

  beforeEach(() => {
    onData = vi.fn<(data: string) => void>()
    onResize = vi.fn<(cols: number, rows: number) => void>()
    // Polyfill document.fonts which is not available in jsdom
    Object.defineProperty(document, 'fonts', {
      value: { ready: Promise.resolve() },
      writable: true,
      configurable: true,
    })
    // Polyfill ResizeObserver and IntersectionObserver which are not in jsdom
    global.ResizeObserver = class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    } as unknown as typeof ResizeObserver
    global.IntersectionObserver = class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    } as unknown as typeof IntersectionObserver
  })

  it('starts with terminalMounted = false', () => {
    const handle = createTerminal({ onData, onResize })
    expect(handle.terminalMounted).toBe(false)
  })

  it('starts with terminalEl = null', () => {
    const handle = createTerminal({ onData, onResize })
    expect(handle.terminalEl).toBeNull()
  })

  it('starts with terminal = null before mount', () => {
    const handle = createTerminal({ onData, onResize })
    expect(handle.terminal).toBeNull()
  })

  it('terminalEl is settable', () => {
    const handle = createTerminal({ onData, onResize })
    const mockEl = document.createElement('div') as HTMLDivElement
    handle.terminalEl = mockEl
    expect(handle.terminalEl).toBe(mockEl)
  })

  it('safeFit does not throw when terminalEl is null', () => {
    const handle = createTerminal({ onData, onResize })
    expect(() => handle.safeFit()).not.toThrow()
  })

  it('safeFit does not throw when terminalEl has zero dimensions', () => {
    const handle = createTerminal({ onData, onResize })
    const mockEl = document.createElement('div') as HTMLDivElement
    // jsdom elements have 0 width/height by default
    handle.terminalEl = mockEl
    expect(() => handle.safeFit()).not.toThrow()
  })

  it('mount calls terminal.open() and terminal.focus() when terminalEl is set', async () => {
    const handle = createTerminal({ onData, onResize })
    const mockEl = document.createElement('div') as HTMLDivElement
    handle.terminalEl = mockEl
    await handle.mount()
    expect(handle.terminal!.open).toHaveBeenCalledWith(mockEl)
    expect(handle.terminal!.focus).toHaveBeenCalled()
  })

  it('mount sets terminalMounted to true', async () => {
    const handle = createTerminal({ onData, onResize })
    const mockEl = document.createElement('div') as HTMLDivElement
    handle.terminalEl = mockEl
    await handle.mount()
    expect(handle.terminalMounted).toBe(true)
  })

  it('mount is idempotent — second call does nothing', async () => {
    const handle = createTerminal({ onData, onResize })
    const mockEl = document.createElement('div') as HTMLDivElement
    handle.terminalEl = mockEl
    await handle.mount()
    await handle.mount()
    expect(handle.terminal!.open).toHaveBeenCalledTimes(1)
  })

  it('mount does nothing when terminalEl is null', async () => {
    const handle = createTerminal({ onData, onResize })
    await handle.mount()
    expect(handle.terminalMounted).toBe(false)
    expect(handle.terminal).toBeNull()
  })

  it('mount registers onData callback via terminal.onData', async () => {
    const handle = createTerminal({ onData, onResize })
    const mockEl = document.createElement('div') as HTMLDivElement
    handle.terminalEl = mockEl
    await handle.mount()
    expect(handle.terminal!.onData).toHaveBeenCalledWith(onData)
  })

  it('dispose does not throw when terminal not yet mounted', () => {
    const handle = createTerminal({ onData, onResize })
    expect(() => handle.dispose()).not.toThrow()
  })

  it('dispose calls terminal.dispose() after mount', async () => {
    const handle = createTerminal({ onData, onResize })
    const mockEl = document.createElement('div') as HTMLDivElement
    handle.terminalEl = mockEl
    await handle.mount()
    handle.dispose()
    expect(handle.terminal!.dispose).toHaveBeenCalled()
  })
})
