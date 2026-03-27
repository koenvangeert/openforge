import { describe, it, expect, vi, beforeEach } from 'vitest'

let webLinksHandler: ((event: MouseEvent, uri: string) => void) | null = null
let webglContextLossHandler: (() => void) | null = null

interface TerminalMockOptions {
  fontFamily?: string
}

function getTerminalFontFamily(terminal: unknown): string | undefined {
  if (typeof terminal !== 'object' || terminal === null || !('options' in terminal)) {
    return undefined
  }

  const options = terminal.options
  if (typeof options !== 'object' || options === null || !('fontFamily' in options)) {
    return undefined
  }

  return typeof options.fontFamily === 'string' ? options.fontFamily : undefined
}

// Mock xterm.js — class-style so `new Terminal(...)` works in vitest
vi.mock('@xterm/xterm', () => {
  class Terminal {
    options: TerminalMockOptions
    constructor(options: TerminalMockOptions = {}) {
      this.options = options
    }
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

vi.mock('@xterm/addon-web-links', () => {
  class WebLinksAddon {
    constructor(handler?: (event: MouseEvent, uri: string) => void) {
      webLinksHandler = handler ?? null
    }

    activate = vi.fn()
    dispose = vi.fn()
  }

  return { WebLinksAddon }
})

vi.mock('@xterm/addon-webgl', () => {
  class WebglAddon {
    onContextLoss = vi.fn((handler: () => void) => {
      webglContextLossHandler = handler
      return { dispose: vi.fn() }
    })
    activate = vi.fn()
    dispose = vi.fn()
  }

  return { WebglAddon }
})

vi.mock('./ipc', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

import { createTerminal } from './useTerminal.svelte'
import { openUrl } from './ipc'

describe('createTerminal', () => {
  let onData: (data: string) => void
  let onResize: (cols: number, rows: number) => void

  beforeEach(() => {
    onData = vi.fn<(data: string) => void>()
    onResize = vi.fn<(cols: number, rows: number) => void>()
    webLinksHandler = null
    webglContextLossHandler = null
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

  it('initializes terminal with the correct font family stack including JetBrains Mono and Nerd Font fallback', async () => {
    const handle = createTerminal({ onData, onResize })
    const mockEl = document.createElement('div') as HTMLDivElement
    handle.terminalEl = mockEl
    await handle.mount()
    expect(getTerminalFontFamily(handle.terminal)).toBe("'JetBrains Mono', 'Symbols Nerd Font', 'Symbols Nerd Font Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace")
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

  it('mount loads WebLinksAddon and routes links through openUrl', async () => {
    const handle = createTerminal({ onData, onResize })
    const mockEl = document.createElement('div') as HTMLDivElement
    handle.terminalEl = mockEl

    await handle.mount()

    expect(handle.terminal!.loadAddon).toHaveBeenCalledTimes(3)
    expect(webLinksHandler).not.toBeNull()

    webLinksHandler!(new MouseEvent('click'), 'https://example.com/docs')

    expect(openUrl).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('mount attempts WebGL after terminal.open and tolerates WebGL setup failure', async () => {
    const handle = createTerminal({ onData, onResize })
    const mockEl = document.createElement('div') as HTMLDivElement
    handle.terminalEl = mockEl

    await expect(handle.mount()).resolves.toBeUndefined()

    const openSpy = handle.terminal!.open as ReturnType<typeof vi.fn>
    const loadAddonSpy = handle.terminal!.loadAddon as ReturnType<typeof vi.fn>

    expect(openSpy).toHaveBeenCalledWith(mockEl)
    expect(loadAddonSpy).toHaveBeenCalledTimes(3)
    expect(openSpy.mock.invocationCallOrder[0]).toBeLessThan(loadAddonSpy.mock.invocationCallOrder[2])
  })

  it('mount disposes the WebGL addon on context loss', async () => {
    const handle = createTerminal({ onData, onResize })
    const mockEl = document.createElement('div') as HTMLDivElement
    handle.terminalEl = mockEl

    await handle.mount()

    const loadAddonSpy = handle.terminal!.loadAddon as ReturnType<typeof vi.fn>
    const webglAddon = loadAddonSpy.mock.calls[2][0] as { dispose: ReturnType<typeof vi.fn> }

    expect(webglContextLossHandler).not.toBeNull()

    webglContextLossHandler!()

    expect(webglAddon.dispose).toHaveBeenCalledTimes(1)
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
