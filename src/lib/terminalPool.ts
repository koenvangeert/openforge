import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { listen } from '@tauri-apps/api/event'
import type { UnlistenFn } from '@tauri-apps/api/event'
import type { PtyEvent } from './types'
import { writePty, resizePty, getPtyBuffer } from './ipc'
import { themeMode, getTerminalTheme } from './theme'
import { get } from 'svelte/store'

export interface PoolEntry {
  taskId: string
  terminal: Terminal
  fitAddon: FitAddon
  hostDiv: HTMLDivElement
  ptyActive: boolean
  needsClear: boolean
  unlisteners: UnlistenFn[]
  resizeObserver: ResizeObserver | null
  visibilityObserver: IntersectionObserver | null
  resizeTimeout: ReturnType<typeof setTimeout> | null
  attached: boolean
}

const pool = new Map<string, PoolEntry>()
const openedTerminals = new WeakSet<Terminal>()

function createHostDiv(): HTMLDivElement {
  const div = document.createElement('div')
  div.style.width = '100%'
  div.style.height = '100%'
  return div
}

function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

function safeFit(entry: PoolEntry): void {
  if (!entry.fitAddon || !entry.hostDiv) return
  if (entry.hostDiv.clientWidth === 0 || entry.hostDiv.clientHeight === 0) return
  const proposed = entry.fitAddon.proposeDimensions()
  if (!proposed || isNaN(proposed.cols) || isNaN(proposed.rows)) return
  entry.fitAddon.fit()
}

export async function acquire(taskId: string): Promise<PoolEntry> {
  const existing = pool.get(taskId)
  if (existing) return existing

  const terminal = new Terminal({
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    fontSize: 13,
    lineHeight: 1.4,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 10000,
    theme: getTerminalTheme(get(themeMode)),
    allowProposedApi: true,
  })

  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  const hostDiv = createHostDiv()

  // Wait for fonts before opening terminal (document.fonts may be unavailable in test envs)
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await Promise.race([
      document.fonts.ready,
      new Promise<void>(resolve => setTimeout(resolve, 3000)),
    ])
  }

  // NOTE: terminal.open() is deferred to the first attach() call so that
  // xterm.js measures character dimensions against a DOM-attached container
  // with real pixel dimensions. Calling open() on a detached 0×0 div causes
  // CharSizeService to produce invalid measurements, making fitAddon unable
  // to compute proper terminal dimensions. xterm.js buffers write() calls
  // until open() is invoked, so buffer replay and listeners work correctly.

  const entry: PoolEntry = {
    taskId,
    terminal,
    fitAddon,
    hostDiv,
    ptyActive: false,
    needsClear: false,
    unlisteners: [],
    resizeObserver: null,
    visibilityObserver: null,
    resizeTimeout: null,
    attached: false,
  }

  // Replay buffered output from backend
  try {
    const buffered = await getPtyBuffer(taskId)
    if (buffered) {
      terminal.write(buffered)
      entry.ptyActive = true
    }
  } catch (e) {
    console.error('[terminalPool] Failed to get PTY buffer:', e)
  }

  // Persistent PTY output listener (survives component unmount)
  entry.unlisteners.push(await listen<PtyEvent>(`pty-output-${taskId}`, (event) => {
    if (event.payload.data) {
      if (entry.needsClear) {
        entry.terminal.reset()
        entry.needsClear = false
      }
      entry.terminal.write(event.payload.data)
      entry.ptyActive = true
    }
  }))

  // Persistent PTY exit listener
  entry.unlisteners.push(await listen<PtyEvent>(`pty-exit-${taskId}`, () => {
    entry.ptyActive = false
    entry.needsClear = true
  }))

  // Terminal onData -> write to PTY (guarded by ptyActive)
  terminal.onData((data: string) => {
    if (entry.ptyActive) {
      writePty(taskId, data).catch(e => console.error('[terminalPool] write failed:', e))
    }
  })

  pool.set(taskId, entry)
  return entry
}

export function attach(entry: PoolEntry, wrapperEl: HTMLDivElement): void {
  if (entry.attached) return

  wrapperEl.appendChild(entry.hostDiv)
  entry.attached = true

  // Open terminal into the now-DOM-attached hostDiv (first attach only).
  // Deferred from acquire() so xterm.js CharSizeService measures character
  // dimensions against a container with real pixel dimensions.
  if (!openedTerminals.has(entry.terminal)) {
    entry.terminal.open(entry.hostDiv)
    openedTerminals.add(entry.terminal)
  }

  // Set up ResizeObserver
  entry.resizeObserver = new ResizeObserver((entries) => {
    if (!entry.hostDiv || !entry.terminal) return
    const { width, height } = entries[0].contentRect
    if (width === 0 || height === 0) return
    if (entry.resizeTimeout) clearTimeout(entry.resizeTimeout)
    entry.resizeTimeout = setTimeout(() => {
      entry.resizeTimeout = null
      safeFit(entry)
      if (entry.ptyActive) {
        resizePty(entry.taskId, entry.terminal.cols, entry.terminal.rows)
          .catch(e => console.error('[terminalPool] resize failed:', e))
      }
    }, 100)
  })
  entry.resizeObserver.observe(entry.hostDiv)

  // Set up IntersectionObserver for visibility-based refresh
  entry.visibilityObserver = new IntersectionObserver((entries) => {
    const last = entries[entries.length - 1]
    if (last.isIntersecting) {
      requestAnimationFrame(() => {
        safeFit(entry)
        entry.terminal.refresh(0, (entry.terminal.rows ?? 1) - 1)
        if (!isModalOpen()) entry.terminal.focus()
      })
    }
  }, { threshold: 0 })
  entry.visibilityObserver.observe(entry.hostDiv)

  // Initial fit, refresh, focus
  requestAnimationFrame(() => {
    safeFit(entry)
    entry.terminal.refresh(0, (entry.terminal.rows ?? 1) - 1)
    if (!isModalOpen()) entry.terminal.focus()
  })
}

export function detach(entry: PoolEntry): void {
  if (!entry.attached) return

  if (entry.resizeTimeout) clearTimeout(entry.resizeTimeout)
  entry.resizeTimeout = null

  if (entry.resizeObserver) {
    entry.resizeObserver.disconnect()
    entry.resizeObserver = null
  }

  if (entry.visibilityObserver) {
    entry.visibilityObserver.disconnect()
    entry.visibilityObserver = null
  }

  // Remove host div from DOM but keep the terminal alive
  if (entry.hostDiv.parentNode) {
    entry.hostDiv.parentNode.removeChild(entry.hostDiv)
  }

  entry.attached = false
}

export function release(taskId: string): void {
  const entry = pool.get(taskId)
  if (!entry) return

  detach(entry)
  entry.unlisteners.forEach(fn => fn())
  entry.unlisteners.length = 0
  entry.terminal.dispose()
  pool.delete(taskId)
}

export function releaseAll(): void {
  for (const taskId of [...pool.keys()]) {
    release(taskId)
  }
}

themeMode.subscribe((mode) => {
  const theme = getTerminalTheme(mode)
  for (const entry of pool.values()) {
    entry.terminal.options.theme = theme
  }
})

export function focusTerminal(taskId: string): void {
  const entry = pool.get(taskId)
  if (entry?.attached) {
    entry.terminal.focus()
  }
}

export function isPtyActive(taskId: string): boolean {
  return pool.get(taskId)?.ptyActive ?? false
}

export function _getPool(): Map<string, PoolEntry> {
  return pool
}
