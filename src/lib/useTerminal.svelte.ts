import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { get } from 'svelte/store'
import { openUrl } from './ipc'
import { getTerminalOptions } from './terminalOptions'
import { getTerminalTheme, themeMode } from './theme'

function loadWebLinksAddon(terminal: Terminal): void {
  const webLinksAddon = new WebLinksAddon((event, uri) => {
    event.preventDefault()
    openUrl(uri).catch(error => {
      console.error('[useTerminal] Failed to open terminal link:', error)
    })
  })

  terminal.loadAddon(webLinksAddon)
}

function loadWebglAddon(terminal: Terminal): void {
  try {
    const webglAddon = new WebglAddon()
    webglAddon.onContextLoss(() => {
      webglAddon.dispose()
    })
    terminal.loadAddon(webglAddon)
  } catch (error) {
    console.warn('[useTerminal] WebGL addon unavailable, falling back to default renderer:', error)
  }
}

export interface TerminalHandle {
  terminalEl: HTMLDivElement | null
  readonly terminal: Terminal | null
  readonly terminalMounted: boolean
  mount(): Promise<void>
  safeFit(): void
  dispose(): void
}

export function createTerminal(deps: {
  onData: (data: string) => void
  onResize: (cols: number, rows: number) => void
}): TerminalHandle {
  let terminal = $state<Terminal | null>(null)
  let fitAddon: FitAddon | null = null

  let terminalEl = $state<HTMLDivElement | null>(null)
  let terminalMounted = $state(false)
  let resizeObserver: ResizeObserver | null = null
  let resizeTimeout: ReturnType<typeof setTimeout> | null = null
  let visibilityObserver: IntersectionObserver | null = null
  let themeUnsub: (() => void) | null = null

  function safeFit(): void {
    if (!fitAddon || !terminalEl) return
    if (terminalEl.clientWidth === 0 || terminalEl.clientHeight === 0) return
    const proposed = fitAddon.proposeDimensions()
    if (!proposed || isNaN(proposed.cols) || isNaN(proposed.rows)) return
    fitAddon.fit()
  }

  async function mount(): Promise<void> {
    if (terminalMounted || !terminalEl) return

    // Initialize xterm.js Terminal (deferred to mount so mocks are active in tests)
    terminal = new Terminal(getTerminalOptions(get(themeMode)))
    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    loadWebLinksAddon(terminal)

    // Wait for fonts to load so CharSizeService measures correctly
    await Promise.race([
      document.fonts.ready,
      new Promise<void>(resolve => setTimeout(resolve, 3000)),
    ])

    terminal.open(terminalEl)
    loadWebglAddon(terminal)
    terminal.focus()
    terminalMounted = true
    requestAnimationFrame(() => safeFit())

    resizeObserver = new ResizeObserver((entries) => {
      if (!terminalEl || !terminal) return
      const { width, height } = entries[0].contentRect
      if (width === 0 || height === 0) return
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        resizeTimeout = null
        safeFit()
        deps.onResize(terminal!.cols, terminal!.rows)
      }, 100)
    })
    resizeObserver.observe(terminalEl)

    // Re-fit and refresh terminal when it becomes visible (e.g., after tab/view switch)
    visibilityObserver = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry.isIntersecting) {
        requestAnimationFrame(() => {
          safeFit()
          terminal?.refresh(0, (terminal?.rows ?? 1) - 1)
          terminal?.focus()
        })
      }
    }, { threshold: 0 })
    visibilityObserver.observe(terminalEl)

    terminal.onData(deps.onData)

    themeUnsub = themeMode.subscribe((mode) => {
      if (terminal?.options) terminal.options.theme = getTerminalTheme(mode)
    })
  }

  function dispose(): void {
    if (resizeTimeout) clearTimeout(resizeTimeout)
    if (resizeObserver) resizeObserver.disconnect()
    if (visibilityObserver) visibilityObserver.disconnect()
    if (themeUnsub) themeUnsub()
    if (terminal) terminal.dispose()
  }

  return {
    get terminalEl() { return terminalEl },
    set terminalEl(el: HTMLDivElement | null) { terminalEl = el },
    get terminal() { return terminal },
    get terminalMounted() { return terminalMounted },
    mount,
    safeFit,
    dispose,
  }
}
