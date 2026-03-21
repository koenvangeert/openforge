import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Track listen callbacks so tests can simulate events
const listenCallbacks = new Map<string, (event: unknown) => void>()
const unlistenFns: Array<ReturnType<typeof vi.fn>> = []
let webLinksHandler: ((event: MouseEvent, uri: string) => void) | null = null
let webglContextLossHandler: (() => void) | null = null

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName: string, cb: (event: unknown) => void) => {
    listenCallbacks.set(eventName, cb)
    const unlisten = vi.fn()
    unlistenFns.push(unlisten)
    return unlisten
  }),
}))

vi.mock('@xterm/xterm', () => {
  class Terminal {
    open = vi.fn()
    write = vi.fn()
    dispose = vi.fn()
    onData = vi.fn().mockReturnValue({ dispose: vi.fn() })
    loadAddon = vi.fn()
    refresh = vi.fn()
    focus = vi.fn()
    reset = vi.fn()
    cols = 80
    rows = 24
  }
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit = vi.fn()
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
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  getPtyBuffer: vi.fn().mockResolvedValue(null),
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

import { acquire, attach, detach, release, releaseAll, _getPool, isPtyActive, focusTerminal } from './terminalPool'
import { openUrl } from './ipc'

// Stub browser APIs not available in jsdom
globalThis.ResizeObserver = class {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
} as unknown as typeof ResizeObserver

globalThis.IntersectionObserver = class {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
} as unknown as typeof IntersectionObserver

describe('terminalPool', () => {
  beforeEach(() => {
    releaseAll()
    listenCallbacks.clear()
    unlistenFns.length = 0
    webLinksHandler = null
    webglContextLossHandler = null
    vi.clearAllMocks()
  })

  afterEach(() => {
    releaseAll()
  })

  it('acquire creates a new pool entry', async () => {
    const entry = await acquire('task-1')
    expect(entry).toBeDefined()
    expect(entry.taskId).toBe('task-1')
    expect(entry.terminal).toBeDefined()
    expect(entry.fitAddon).toBeDefined()
    expect(entry.hostDiv).toBeInstanceOf(HTMLDivElement)
    expect(entry.attached).toBe(false)
    expect(_getPool().has('task-1')).toBe(true)
  })

  it('acquire returns existing entry on second call', async () => {
    const entry1 = await acquire('task-2')
    const entry2 = await acquire('task-2')
    expect(entry1).toBe(entry2)
  })

  it('acquire sets up pty-output and pty-exit listeners', async () => {
    await acquire('task-3')
    expect(listenCallbacks.has('pty-output-task-3')).toBe(true)
    expect(listenCallbacks.has('pty-exit-task-3')).toBe(true)
  })

  it('acquire loads WebLinksAddon and routes links through openUrl', async () => {
    const entry = await acquire('task-links')

    expect(entry.terminal.loadAddon).toHaveBeenCalledTimes(2)
    expect(webLinksHandler).not.toBeNull()

    webLinksHandler!(new MouseEvent('click'), 'https://example.com/pool')

    expect(openUrl).toHaveBeenCalledWith('https://example.com/pool')
  })

  it('attach appends hostDiv to wrapper and marks attached', async () => {
    const entry = await acquire('task-4')
    const wrapper = document.createElement('div')

    attach(entry, wrapper)

    expect(wrapper.contains(entry.hostDiv)).toBe(true)
    expect(entry.attached).toBe(true)
  })

  it('attach attempts WebGL after terminal.open and tolerates WebGL setup failure', async () => {
    const entry = await acquire('task-webgl')
    const wrapper = document.createElement('div')

    attach(entry, wrapper)

    const openSpy = entry.terminal.open as ReturnType<typeof vi.fn>
    const loadAddonSpy = entry.terminal.loadAddon as ReturnType<typeof vi.fn>

    expect(openSpy).toHaveBeenCalledWith(entry.hostDiv)
    expect(loadAddonSpy).toHaveBeenCalledTimes(3)
    expect(openSpy.mock.invocationCallOrder[0]).toBeLessThan(loadAddonSpy.mock.invocationCallOrder[2])
  })

  it('attach disposes the WebGL addon on context loss', async () => {
    const entry = await acquire('task-webgl-context-loss')
    const wrapper = document.createElement('div')

    attach(entry, wrapper)

    const loadAddonSpy = entry.terminal.loadAddon as ReturnType<typeof vi.fn>
    const webglAddon = loadAddonSpy.mock.calls[2][0] as { dispose: ReturnType<typeof vi.fn> }

    expect(webglContextLossHandler).not.toBeNull()

    webglContextLossHandler!()

    expect(webglAddon.dispose).toHaveBeenCalledTimes(1)
  })

  it('attach is idempotent', async () => {
    const entry = await acquire('task-5')
    const wrapper = document.createElement('div')

    attach(entry, wrapper)
    attach(entry, wrapper)

    expect(wrapper.childElementCount).toBe(1)
  })

  it('detach removes hostDiv from DOM', async () => {
    const entry = await acquire('task-6')
    const wrapper = document.createElement('div')

    attach(entry, wrapper)
    expect(wrapper.contains(entry.hostDiv)).toBe(true)

    detach(entry)
    expect(wrapper.contains(entry.hostDiv)).toBe(false)
    expect(entry.attached).toBe(false)
  })

  it('detach is safe to call when not attached', async () => {
    const entry = await acquire('task-7')
    expect(() => detach(entry)).not.toThrow()
  })

  it('release disposes terminal and removes from pool', async () => {
    const entry = await acquire('task-8')
    const disposeSpy = entry.terminal.dispose as ReturnType<typeof vi.fn>

    release('task-8')

    expect(disposeSpy).toHaveBeenCalled()
    expect(_getPool().has('task-8')).toBe(false)
  })

  it('release calls unlisten functions', async () => {
    await acquire('task-9')
    const savedUnlistens = [...unlistenFns]

    release('task-9')

    for (const fn of savedUnlistens) {
      expect(fn).toHaveBeenCalled()
    }
  })

  it('release is safe for unknown taskId', () => {
    expect(() => release('nonexistent')).not.toThrow()
  })

  it('releaseAll clears all entries', async () => {
    await acquire('task-a')
    await acquire('task-b')
    expect(_getPool().size).toBe(2)

    releaseAll()
    expect(_getPool().size).toBe(0)
  })

  it('pty-output listener writes to terminal', async () => {
    const entry = await acquire('task-10')
    const writeSpy = entry.terminal.write as ReturnType<typeof vi.fn>

    const outputCb = listenCallbacks.get('pty-output-task-10')!
    outputCb({ payload: { data: 'hello world' } })

    expect(writeSpy).toHaveBeenCalledWith('hello world')
    expect(entry.ptyActive).toBe(true)
  })

  it('pty-exit listener marks ptyActive false and needsClear true', async () => {
    const entry = await acquire('task-11')
    entry.ptyActive = true

    const exitCb = listenCallbacks.get('pty-exit-task-11')!
    exitCb({ payload: {} })

    expect(entry.ptyActive).toBe(false)
    expect(entry.needsClear).toBe(true)
  })

  it('needsClear causes terminal.reset on next pty-output', async () => {
    const entry = await acquire('task-12')
    entry.needsClear = true
    const resetSpy = entry.terminal.reset as ReturnType<typeof vi.fn>
    const writeSpy = entry.terminal.write as ReturnType<typeof vi.fn>

    const outputCb = listenCallbacks.get('pty-output-task-12')!
    outputCb({ payload: { data: 'new session output' } })

    expect(resetSpy).toHaveBeenCalled()
    expect(writeSpy).toHaveBeenCalledWith('new session output')
    expect(entry.needsClear).toBe(false)
  })

  it('terminal survives detach/re-attach cycle', async () => {
    const entry = await acquire('task-13')
    const wrapper1 = document.createElement('div')
    const wrapper2 = document.createElement('div')

    attach(entry, wrapper1)
    expect(entry.attached).toBe(true)

    // Simulate pty output while attached
    const outputCb = listenCallbacks.get('pty-output-task-13')!
    outputCb({ payload: { data: 'first output' } })

    detach(entry)
    expect(entry.attached).toBe(false)

    // Output while detached still writes to terminal
    outputCb({ payload: { data: 'background output' } })
    expect((entry.terminal.write as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('background output')

    // Re-acquire returns same entry
    const reacquired = await acquire('task-13')
    expect(reacquired).toBe(entry)

    // Re-attach to different wrapper
    attach(reacquired, wrapper2)
    expect(wrapper2.contains(entry.hostDiv)).toBe(true)
    expect(entry.attached).toBe(true)
  })

  describe('isPtyActive', () => {
    it('returns true when pool entry has ptyActive true', async () => {
      const entry = await acquire('task-pty-check')
      entry.ptyActive = true
      expect(isPtyActive('task-pty-check')).toBe(true)
    })

    it('returns false when pool entry has ptyActive false', async () => {
      const entry = await acquire('task-pty-off')
      entry.ptyActive = false
      expect(isPtyActive('task-pty-off')).toBe(false)
    })

    it('returns false for unknown task', () => {
      expect(isPtyActive('nonexistent')).toBe(false)
    })
  })

  describe('focusTerminal', () => {
    it('calls terminal.focus() for an attached entry', async () => {
      const entry = await acquire('task-focus')
      const wrapper = document.createElement('div')
      attach(entry, wrapper)
      const focusSpy = entry.terminal.focus as ReturnType<typeof vi.fn>
      focusSpy.mockClear()

      focusTerminal('task-focus')

      expect(focusSpy).toHaveBeenCalled()
    })

    it('does nothing for unknown taskId', () => {
      expect(() => focusTerminal('nonexistent')).not.toThrow()
    })

    it('does nothing for a detached entry', async () => {
      const entry = await acquire('task-focus-detached')
      const focusSpy = entry.terminal.focus as ReturnType<typeof vi.fn>
      focusSpy.mockClear()

      focusTerminal('task-focus-detached')

      expect(focusSpy).not.toHaveBeenCalled()
    })
  })

  describe('modal focus suppression', () => {
    it('attach does not focus terminal when a modal dialog is open', async () => {
      // Simulate an open modal dialog in the DOM
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      document.body.appendChild(dialog)

      const entry = await acquire('task-modal')
      const wrapper = document.createElement('div')
      document.body.appendChild(wrapper)

      // Give hostDiv real dimensions so safeFit doesn't bail
      Object.defineProperty(entry.hostDiv, 'clientWidth', { value: 800 })
      Object.defineProperty(entry.hostDiv, 'clientHeight', { value: 600 })

      const focusSpy = entry.terminal.focus as ReturnType<typeof vi.fn>
      focusSpy.mockClear()

      attach(entry, wrapper)

      // Flush the requestAnimationFrame callback
      await new Promise(resolve => requestAnimationFrame(resolve))

      expect(focusSpy).not.toHaveBeenCalled()

      // Cleanup
      document.body.removeChild(dialog)
      document.body.removeChild(wrapper)
    })

    it('attach focuses terminal when no modal dialog is open', async () => {
      const entry = await acquire('task-no-modal')
      const wrapper = document.createElement('div')
      document.body.appendChild(wrapper)

      Object.defineProperty(entry.hostDiv, 'clientWidth', { value: 800 })
      Object.defineProperty(entry.hostDiv, 'clientHeight', { value: 600 })

      const focusSpy = entry.terminal.focus as ReturnType<typeof vi.fn>
      focusSpy.mockClear()

      attach(entry, wrapper)

      // Flush the requestAnimationFrame callback
      await new Promise(resolve => requestAnimationFrame(resolve))

      expect(focusSpy).toHaveBeenCalled()

      // Cleanup
      document.body.removeChild(wrapper)
    })
  })

  describe('shell-key independence', () => {
    it('agent key and shell key create separate pool entries', async () => {
      const agentEntry = await acquire('T-42')
      const shellEntry = await acquire('T-42-shell')

      expect(agentEntry).toBeDefined()
      expect(shellEntry).toBeDefined()
      expect(agentEntry).not.toBe(shellEntry)
      expect(agentEntry.taskId).toBe('T-42')
      expect(shellEntry.taskId).toBe('T-42-shell')
      expect(_getPool().has('T-42')).toBe(true)
      expect(_getPool().has('T-42-shell')).toBe(true)
      expect(_getPool().size).toBe(2)
    })

    it('releasing agent key does not affect shell key entry', async () => {
      await acquire('T-43')
      const shellEntry = await acquire('T-43-shell')

      release('T-43')

      expect(_getPool().has('T-43')).toBe(false)
      expect(_getPool().has('T-43-shell')).toBe(true)
      expect(_getPool().get('T-43-shell')).toBe(shellEntry)
    })

    it('both entries have independent ptyActive state', async () => {
      const agentEntry = await acquire('T-44')
      const shellEntry = await acquire('T-44-shell')

      const agentOutputCb = listenCallbacks.get('pty-output-T-44')!
      agentOutputCb({ payload: { data: 'agent output' } })

      expect(agentEntry.ptyActive).toBe(true)
      expect(shellEntry.ptyActive).toBe(false)

      const shellOutputCb = listenCallbacks.get('pty-output-T-44-shell')!
      shellOutputCb({ payload: { data: 'shell output' } })

      expect(agentEntry.ptyActive).toBe(true)
      expect(shellEntry.ptyActive).toBe(true)

      const agentExitCb = listenCallbacks.get('pty-exit-T-44')!
      agentExitCb({ payload: {} })

      expect(agentEntry.ptyActive).toBe(false)
      expect(shellEntry.ptyActive).toBe(true)
    })
  })
})
