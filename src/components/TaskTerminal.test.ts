import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

vi.mock('../lib/ipc', () => ({
  spawnShellPty: vi.fn().mockResolvedValue(1),
  killPty: vi.fn().mockResolvedValue(undefined),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  getPtyBuffer: vi.fn().mockResolvedValue(null),
}))

let listenCallback: ((event: { payload: unknown }) => void) | null = null

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockImplementation((_event: string, cb: (event: { payload: unknown }) => void) => {
    listenCallback = cb
    return Promise.resolve(() => {})
  }),
}))

const { mockPoolEntry } = vi.hoisted(() => ({
  mockPoolEntry: {
    taskId: '',
    terminal: { write: vi.fn(), dispose: vi.fn(), reset: vi.fn(), cols: 80, rows: 24, options: { theme: {} } },
    fitAddon: { fit: vi.fn() },
    hostDiv: document.createElement('div'),
    ptyActive: false,
    needsClear: false,
    unlisteners: [] as Array<() => void>,
    resizeObserver: null,
    visibilityObserver: null,
    resizeTimeout: null,
    attached: false,
  },
}))

vi.mock('../lib/terminalPool', () => ({
  acquire: vi.fn().mockResolvedValue(mockPoolEntry),
  attach: vi.fn(),
  detach: vi.fn(),
  release: vi.fn(),
}))

import TaskTerminal from './TaskTerminal.svelte'

describe('TaskTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPoolEntry.ptyActive = false
    mockPoolEntry.attached = false
    mockPoolEntry.needsClear = false
    listenCallback = null
  })

  it('renders terminal wrapper div', async () => {
    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree' } })
    await vi.waitFor(() => {
      const termWrapper = document.querySelector('.shell-terminal-wrapper')
      expect(termWrapper).toBeTruthy()
    })
  })

  it('calls acquire with shell key on mount', async () => {
    const { acquire } = await import('../lib/terminalPool')

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree' } })
    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalledWith('T-1-shell')
    })
  })

  it('calls attach with pool entry and wrapper element', async () => {
    const { attach } = await import('../lib/terminalPool')

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree' } })
    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
  })

  it('calls detach on component destroy', async () => {
    const { detach, attach } = await import('../lib/terminalPool')

    const { unmount } = render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree' } })
    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalled()
    })

    unmount()
    expect(detach).toHaveBeenCalledWith(mockPoolEntry)
  })

  it('spawns shell PTY when ptyActive is false', async () => {
    const { spawnShellPty } = await import('../lib/ipc')
    mockPoolEntry.ptyActive = false

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree' } })
    await vi.waitFor(() => {
      expect(spawnShellPty).toHaveBeenCalledWith('T-1-shell', '/path/to/worktree', 80, 24)
    })
  })

  it('does not spawn shell PTY when ptyActive is true', async () => {
    const { spawnShellPty } = await import('../lib/ipc')
    const { acquire } = await import('../lib/terminalPool')
    mockPoolEntry.ptyActive = true

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree' } })
    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalled()
    })

    expect(spawnShellPty).not.toHaveBeenCalled()
  })

  it('shows shell exited overlay when PTY exits', async () => {
    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree' } })

    await vi.waitFor(() => {
      expect(listenCallback).not.toBeNull()
    })

    listenCallback!({ payload: {} })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell exited')).toBeTruthy()
    })
  })

  it('shows restart button when shell has exited', async () => {
    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree' } })

    await vi.waitFor(() => {
      expect(listenCallback).not.toBeNull()
    })

    listenCallback!({ payload: {} })

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy()
    })
  })

  it('restart button calls killPty and spawnShellPty', async () => {
    const { killPty, spawnShellPty } = await import('../lib/ipc')

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree' } })

    // Wait for mount to complete and listener to be set up
    await vi.waitFor(() => {
      expect(listenCallback).not.toBeNull()
    })

    // Simulate shell exit
    listenCallback!({ payload: {} })

    // Wait for restart button to appear
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy()
    })

    // Click restart button
    const restartButton = screen.getByRole('button', { name: 'Restart' })
    await fireEvent.click(restartButton)

    // Verify killPty was called with shell key
    await vi.waitFor(() => {
      expect(killPty).toHaveBeenCalledWith('T-1-shell')
    })

    // Verify spawnShellPty was called twice (once on mount, once on restart)
    await vi.waitFor(() => {
      expect(spawnShellPty).toHaveBeenCalledTimes(2)
      expect(spawnShellPty).toHaveBeenLastCalledWith('T-1-shell', '/path/to/worktree', 80, 24)
    })
  })
})
