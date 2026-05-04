import { listenDesktopEvent, type DesktopUnlistenFn } from './desktopIpc'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { get } from 'svelte/store'
import { getPtyBuffer, openUrl, resizePty, writePty } from './ipc'
import { getTerminalOptions, preloadTerminalFonts } from './terminalOptions'
import { getTerminalTheme, themeMode } from './theme'
import type { PtyEvent } from './types'

export interface PoolEntry {
  taskId: string
  terminal: Terminal
  fitAddon: FitAddon
  hostDiv: HTMLDivElement
  ptyActive: boolean
  needsClear: boolean
  unlisteners: DesktopUnlistenFn[]
  resizeObserver: ResizeObserver | null
  visibilityObserver: IntersectionObserver | null
  resizeTimeout: ReturnType<typeof setTimeout> | null
  attached: boolean
  spawnPending: boolean
  currentPtyInstance: number | null
  webglAddon: WebglAddon | null
}

export interface TerminalTab {
  index: number
  key: string
  label: string
}

export interface TaskTerminalTabsSession {
  tabs: TerminalTab[]
  activeTabIndex: number
  nextIndex: number
}

export interface ShellLifecycleState {
  ptyActive: boolean
  shellExited: boolean
  currentPtyInstance: number | null
}

const pool = new Map<string, PoolEntry>()
const taskTabSessions = new Map<string, TaskTerminalTabsSession>()
const openedTerminals = new WeakSet<Terminal>()

function createDefaultTaskTabsSession(taskId: string): TaskTerminalTabsSession {
  return {
    tabs: [{ index: 0, key: `${taskId}-shell-0`, label: 'Shell 1' }],
    activeTabIndex: 0,
    nextIndex: 1,
  }
}

function createHostDiv(): HTMLDivElement {
  const div = document.createElement('div')
  div.style.width = '100%'
  div.style.height = '100%'
  return div
}

function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

export function isValidTerminalDimensions(dimensions: { cols: unknown; rows: unknown } | null | undefined): dimensions is { cols: number; rows: number } {
  if (!dimensions) return false
  if (typeof dimensions.cols !== 'number' || typeof dimensions.rows !== 'number') return false
  return !Number.isNaN(dimensions.cols) && !Number.isNaN(dimensions.rows)
}

function safeFit(entry: PoolEntry): boolean {
  if (!entry.fitAddon || !entry.hostDiv) return false
  if (entry.hostDiv.clientWidth === 0 || entry.hostDiv.clientHeight === 0) return false
  const proposed = entry.fitAddon.proposeDimensions()
  if (!isValidTerminalDimensions(proposed)) return false
  entry.fitAddon.fit()
  return true
}

function refreshTerminal(entry: PoolEntry): void {
  entry.terminal.refresh(0, (entry.terminal.rows ?? 1) - 1)
}

function refreshAndFocus(entry: PoolEntry): void {
  refreshTerminal(entry)
  if (!isModalOpen()) entry.terminal.focus()
}

function syncPtySize(entry: PoolEntry): void {
  if (!entry.ptyActive) return

  resizePty(entry.taskId, entry.terminal.cols, entry.terminal.rows)
    .catch(e => console.error('[terminalPool] resize failed:', e))
}

function waitForInitialFit(entry: PoolEntry): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      if (!entry.attached) {
        resolve()
        return
      }

      if (safeFit(entry)) {
        refreshAndFocus(entry)
        syncPtySize(entry)
        resolve()
        return
      }

      void waitForInitialFit(entry).then(() => resolve())
    })
  })
}

function loadWebLinksAddon(terminal: Terminal): void {
  const webLinksAddon = new WebLinksAddon((event, uri) => {
    event.preventDefault()
    openUrl(uri).catch(error => {
      console.error('[terminalPool] Failed to open terminal link:', error)
    })
  })

  terminal.loadAddon(webLinksAddon)
}

function loadWebglAddon(entry: PoolEntry): void {
  if (entry.webglAddon !== null) return

  try {
    const webglAddon = new WebglAddon()
    webglAddon.onContextLoss(() => {
      webglAddon.dispose()
      if (entry.webglAddon === webglAddon) {
        entry.webglAddon = null
      }
      requestAnimationFrame(() => {
        if (!entry.attached || entry.webglAddon !== null) return
        loadWebglAddon(entry)
        safeFit(entry)
        syncPtySize(entry)
        refreshTerminal(entry)
      })
    })
    entry.terminal.loadAddon(webglAddon)
    entry.webglAddon = webglAddon
  } catch (error) {
    console.warn('[terminalPool] WebGL addon unavailable, falling back to default renderer:', error)
  }
}

export async function acquire(taskId: string): Promise<PoolEntry> {
  const existing = pool.get(taskId)
  if (existing) return existing

  const terminal = new Terminal(getTerminalOptions(get(themeMode)))

  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  loadWebLinksAddon(terminal)

  const hostDiv = createHostDiv()

  await preloadTerminalFonts()

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
    spawnPending: false,
    currentPtyInstance: null,
    webglAddon: null,
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
  entry.unlisteners.push(await listenDesktopEvent<PtyEvent>(`pty-output-${taskId}`, (event) => {
    const instanceId = event.payload.instance_id
    if (instanceId != null && entry.currentPtyInstance != null && instanceId !== entry.currentPtyInstance) {
      return
    }
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
  entry.unlisteners.push(await listenDesktopEvent<PtyEvent>(`pty-exit-${taskId}`, (event) => {
    const instanceId = event.payload.instance_id
    if (instanceId != null && entry.currentPtyInstance != null && instanceId !== entry.currentPtyInstance) {
      return
    }
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

export async function attach(entry: PoolEntry, wrapperEl: HTMLDivElement): Promise<void> {
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
  loadWebglAddon(entry)

  // Set up ResizeObserver
  entry.resizeObserver = new ResizeObserver((entries) => {
    if (!entry.hostDiv || !entry.terminal) return
    const { width, height } = entries[0].contentRect
    if (width === 0 || height === 0) return
    if (entry.resizeTimeout) clearTimeout(entry.resizeTimeout)
    entry.resizeTimeout = setTimeout(() => {
      entry.resizeTimeout = null
      safeFit(entry)
      syncPtySize(entry)
    }, 100)
  })
  entry.resizeObserver.observe(entry.hostDiv)

  // Set up IntersectionObserver for visibility-based refresh
  entry.visibilityObserver = new IntersectionObserver((entries) => {
    const last = entries[entries.length - 1]
    if (last.isIntersecting) {
      requestAnimationFrame(() => {
        safeFit(entry)
        syncPtySize(entry)
        refreshAndFocus(entry)
      })
    }
  }, { threshold: 0 })
  entry.visibilityObserver.observe(entry.hostDiv)

  await waitForInitialFit(entry)
}

export async function recoverActiveTerminal(entry: PoolEntry): Promise<void> {
  if (!entry.attached) return
  loadWebglAddon(entry)
  await waitForInitialFit(entry)
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
  entry.unlisteners.forEach(fn => {
    fn()
  })
  entry.unlisteners.length = 0
  entry.terminal.dispose()
  pool.delete(taskId)
}

export function shouldSpawnPty(entry: PoolEntry): boolean {
  return !entry.ptyActive && !entry.spawnPending && !entry.needsClear
}

export function markPtySpawnPending(entry: PoolEntry): void {
  entry.spawnPending = true
}

export function clearPtySpawnPending(entry: PoolEntry): void {
  entry.spawnPending = false
}

export function setCurrentPtyInstance(entry: PoolEntry, instanceId: number | null): void {
  entry.currentPtyInstance = instanceId
}

export function isShellExited(taskId: string): boolean {
  const entry = pool.get(taskId)
  if (!entry) return false
  return !entry.ptyActive && entry.needsClear
}

export function getShellLifecycleState(taskId: string): ShellLifecycleState {
  const entry = pool.get(taskId)
  return {
    ptyActive: entry?.ptyActive ?? false,
    shellExited: entry ? !entry.ptyActive && entry.needsClear : false,
    currentPtyInstance: entry?.currentPtyInstance ?? null,
  }
}

export function updateShellLifecycleState(taskId: string, state: ShellLifecycleState): void {
  const entry = pool.get(taskId)
  if (!entry) return

  entry.ptyActive = state.ptyActive
  entry.needsClear = state.shellExited
  entry.currentPtyInstance = state.currentPtyInstance
}

export function getTaskTerminalTabsSession(taskId: string): TaskTerminalTabsSession {
  const existing = taskTabSessions.get(taskId)
  if (existing) return existing

  const session = createDefaultTaskTabsSession(taskId)
  taskTabSessions.set(taskId, session)
  return session
}

export function updateTaskTerminalTabsSession(taskId: string, session: TaskTerminalTabsSession): void {
  taskTabSessions.set(taskId, session)
}

export function clearTaskTerminalTabsSession(taskId: string): void {
  taskTabSessions.delete(taskId)
}

export function releaseAll(): void {
  for (const taskId of [...pool.keys()]) {
    release(taskId)
  }
  taskTabSessions.clear()
}

export function releaseAllForTask(taskId: string): number {
  let count = 0
  const keysToRelease: string[] = []

  for (const key of pool.keys()) {
    if (key.startsWith(`${taskId}-shell-`)) {
      keysToRelease.push(key)
    }
  }

  for (const key of keysToRelease) {
    release(key)
    count++
  }

  return count
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
