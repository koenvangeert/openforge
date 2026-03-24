import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock xterm and addons (required by TaskTerminal)
vi.mock('@xterm/xterm', () => {
  const Terminal = vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    loadAddon: vi.fn(),
    refresh: vi.fn(),
    focus: vi.fn(),
    reset: vi.fn(),
    cols: 80,
    rows: 24,
    options: { theme: {} },
  }))
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  const FitAddon = vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
  }))
  return { FitAddon }
})

vi.mock('@xterm/addon-web-links', () => {
  const WebLinksAddon = vi.fn().mockImplementation(() => ({}))
  return { WebLinksAddon }
})

vi.mock('@xterm/addon-webgl', () => {
  const WebglAddon = vi.fn().mockImplementation(() => ({
    onContextLoss: vi.fn(),
  }))
  return { WebglAddon }
})

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

const { killPtyMock, spawnShellPtyMock } = vi.hoisted(() => ({
  killPtyMock: vi.fn().mockResolvedValue(undefined),
  spawnShellPtyMock: vi.fn().mockResolvedValue(1),
}))

vi.mock('../lib/ipc', () => ({
  spawnShellPty: spawnShellPtyMock,
  killPty: killPtyMock,
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  getPtyBuffer: vi.fn().mockResolvedValue(null),
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockImplementation(() => Promise.resolve(() => {})),
}))

const { releaseMock } = vi.hoisted(() => ({
  releaseMock: vi.fn(),
}))

vi.mock('../lib/terminalPool', () => ({
  acquire: vi.fn().mockResolvedValue({
    taskId: '',
    terminal: {
      write: vi.fn(),
      dispose: vi.fn(),
      reset: vi.fn(),
      cols: 80,
      rows: 24,
      options: { theme: {} },
      onData: vi.fn(),
      loadAddon: vi.fn(),
      refresh: vi.fn(),
      focus: vi.fn(),
      open: vi.fn(),
    },
    fitAddon: { fit: vi.fn(), proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }) },
    hostDiv: document.createElement('div'),
    ptyActive: false,
    needsClear: false,
    unlisteners: [],
    resizeObserver: null,
    visibilityObserver: null,
    resizeTimeout: null,
    attached: false,
  }),
  attach: vi.fn(),
  detach: vi.fn(),
  release: releaseMock,
  focusTerminal: vi.fn(),
}))

// Mock TaskTerminal to avoid complex terminal setup in tab tests
vi.mock('./TaskTerminal.svelte', () => ({
  default: vi.fn(),
}))

import TerminalTabs from './TerminalTabs.svelte'

describe('TerminalTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    killPtyMock.mockResolvedValue(undefined)
    releaseMock.mockReturnValue(undefined)
  })

  it('renders with 1 tab "Shell 1" on mount', async () => {
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        worktreePath: '/path/to/worktree',
        isFullscreen: false,
        onFullscreenToggle: null,
        onTabChange: null,
        onTabCountChange: null,
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })
  })

  it('"+" button adds new tab with incremented label', async () => {
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        worktreePath: '/path/to/worktree',
        isFullscreen: false,
        onFullscreenToggle: null,
        onTabChange: null,
        onTabCountChange: null,
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })

    const addButton = screen.getByRole('button', { name: '+' })
    await fireEvent.click(addButton)

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 2')).toBeTruthy()
    })
  })

  it('clicking a tab switches to it', async () => {
    const onTabChange = vi.fn()
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        worktreePath: '/path/to/worktree',
        isFullscreen: false,
        onFullscreenToggle: null,
        onTabChange,
        onTabCountChange: null,
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })

    // Add a second tab
    const addButton = screen.getByRole('button', { name: '+' })
    await fireEvent.click(addButton)

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 2')).toBeTruthy()
    })

    // Click Shell 1 tab
    const shell1Tab = screen.getByText('Shell 1')
    await fireEvent.click(shell1Tab)

    await vi.waitFor(() => {
      expect(onTabChange).toHaveBeenCalledWith(0)
    })
  })

  it('close button hidden/disabled on sole remaining tab', async () => {
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        worktreePath: '/path/to/worktree',
        isFullscreen: false,
        onFullscreenToggle: null,
        onTabChange: null,
        onTabCountChange: null,
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })

    // With only 1 tab, close button should be disabled or hidden
    const closeButtons = screen.queryAllByRole('button', { name: '×' })
    if (closeButtons.length > 0) {
      expect((closeButtons[0] as HTMLButtonElement).disabled).toBe(true)
    } else {
      expect(closeButtons.length).toBe(0)
    }
  })

  it('close button visible and enabled when 2+ tabs', async () => {
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        worktreePath: '/path/to/worktree',
        isFullscreen: false,
        onFullscreenToggle: null,
        onTabChange: null,
        onTabCountChange: null,
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })

    const addButton = screen.getByRole('button', { name: '+' })
    await fireEvent.click(addButton)

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 2')).toBeTruthy()
    })

    // With 2 tabs, close buttons should be visible and enabled
    const closeButtons = screen.getAllByRole('button', { name: '×' })
    expect(closeButtons.length).toBeGreaterThanOrEqual(1)
    closeButtons.forEach(btn => {
      expect((btn as HTMLButtonElement).disabled).toBe(false)
    })
  })

  it('closing a tab calls killPty(key) and release(key)', async () => {
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        worktreePath: '/path/to/worktree',
        isFullscreen: false,
        onFullscreenToggle: null,
        onTabChange: null,
        onTabCountChange: null,
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })

    // Add a second tab
    const addButton = screen.getByRole('button', { name: '+' })
    await fireEvent.click(addButton)

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 2')).toBeTruthy()
    })

    // Close Shell 2 (the active tab)
    const closeButtons = screen.getAllByRole('button', { name: '×' })
    await fireEvent.click(closeButtons[closeButtons.length - 1])

    await vi.waitFor(() => {
      expect(killPtyMock).toHaveBeenCalledWith('T-1-shell-1')
      expect(releaseMock).toHaveBeenCalledWith('T-1-shell-1')
    })
  })

  it('tab indices never reuse (close Shell 2, add new → Shell 3, not Shell 2)', async () => {
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        worktreePath: '/path/to/worktree',
        isFullscreen: false,
        onFullscreenToggle: null,
        onTabChange: null,
        onTabCountChange: null,
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })

    // Add Shell 2
    const addButton = screen.getByRole('button', { name: '+' })
    await fireEvent.click(addButton)

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 2')).toBeTruthy()
    })

    // Close Shell 2
    const closeButtons = screen.getAllByRole('button', { name: '×' })
    await fireEvent.click(closeButtons[closeButtons.length - 1])

    await vi.waitFor(() => {
      expect(screen.queryByText('Shell 2')).toBeNull()
    })

    // Add new tab — should be Shell 3, not Shell 2
    await fireEvent.click(addButton)

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 3')).toBeTruthy()
      expect(screen.queryByText('Shell 2')).toBeNull()
    })
  })

  it('⌘+Shift+T creates new terminal tab', async () => {
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        worktreePath: '/path/to/worktree',
        isFullscreen: false,
        onFullscreenToggle: null,
        onTabChange: null,
        onTabCountChange: null,
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })

    await fireEvent.keyDown(document, { code: 'KeyT', metaKey: true, shiftKey: true })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 2')).toBeTruthy()
    })
  })

  it('onTabChange callback fires when active tab changes', async () => {
    const onTabChange = vi.fn()
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        worktreePath: '/path/to/worktree',
        isFullscreen: false,
        onFullscreenToggle: null,
        onTabChange,
        onTabCountChange: null,
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })

    // Add second tab (switches to it automatically)
    const addButton = screen.getByRole('button', { name: '+' })
    await fireEvent.click(addButton)

    await vi.waitFor(() => {
      expect(onTabChange).toHaveBeenCalled()
    })
  })

  it('onTabCountChange callback fires when tab count changes', async () => {
    const onTabCountChange = vi.fn()
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        worktreePath: '/path/to/worktree',
        isFullscreen: false,
        onFullscreenToggle: null,
        onTabChange: null,
        onTabCountChange,
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })

    // onTabCountChange should have been called on mount with count=1
    await vi.waitFor(() => {
      expect(onTabCountChange).toHaveBeenCalledWith(1)
    })

    // Add second tab
    const addButton = screen.getByRole('button', { name: '+' })
    await fireEvent.click(addButton)

    await vi.waitFor(() => {
      expect(onTabCountChange).toHaveBeenCalledWith(2)
    })
  })

  it('closing a tab removes it from the tab bar', async () => {
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        worktreePath: '/path/to/worktree',
        isFullscreen: false,
        onFullscreenToggle: null,
        onTabChange: null,
        onTabCountChange: null,
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })

    // Add second tab
    const addButton = screen.getByRole('button', { name: '+' })
    await fireEvent.click(addButton)

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 2')).toBeTruthy()
    })

    // Close Shell 2
    const closeButtons = screen.getAllByRole('button', { name: '×' })
    await fireEvent.click(closeButtons[closeButtons.length - 1])

    await vi.waitFor(() => {
      expect(screen.queryByText('Shell 2')).toBeNull()
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })
  })

  it('switches to adjacent tab after closing active tab', async () => {
    const onTabChange = vi.fn()
    render(TerminalTabs, {
      props: {
        taskId: 'T-1',
        worktreePath: '/path/to/worktree',
        isFullscreen: false,
        onFullscreenToggle: null,
        onTabChange,
        onTabCountChange: null,
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 1')).toBeTruthy()
    })

    // Add second tab (becomes active)
    const addButton = screen.getByRole('button', { name: '+' })
    await fireEvent.click(addButton)

    await vi.waitFor(() => {
      expect(screen.getByText('Shell 2')).toBeTruthy()
    })

    onTabChange.mockClear()

    // Close Shell 2 (active) — should switch to Shell 1
    const closeButtons = screen.getAllByRole('button', { name: '×' })
    await fireEvent.click(closeButtons[closeButtons.length - 1])

    await vi.waitFor(() => {
      // Should have switched to Shell 1 (index 0)
      expect(onTabChange).toHaveBeenCalledWith(0)
    })
  })
})
