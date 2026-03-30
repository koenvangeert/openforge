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
  killShellsForTask: vi.fn().mockResolvedValue(undefined),
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
    spawnPending: false,
    currentPtyInstance: null,
  },
}))

vi.mock('../lib/terminalPool', () => ({
  acquire: vi.fn().mockImplementation(async (taskId: string) => {
    mockPoolEntry.taskId = taskId
    return mockPoolEntry
  }),
  attach: vi.fn(),
  detach: vi.fn(),
  release: vi.fn(),
  shouldSpawnPty: vi.fn((entry) => !entry.ptyActive && !entry.spawnPending && !entry.needsClear),
  markPtySpawnPending: vi.fn((entry) => {
    entry.spawnPending = true
  }),
  clearPtySpawnPending: vi.fn((entry) => {
    entry.spawnPending = false
  }),
  setCurrentPtyInstance: vi.fn((entry, instanceId) => {
    entry.currentPtyInstance = instanceId
  }),
  getShellLifecycleState: vi.fn(() => ({
    ptyActive: mockPoolEntry.ptyActive,
    shellExited: !mockPoolEntry.ptyActive && mockPoolEntry.needsClear,
    currentPtyInstance: mockPoolEntry.currentPtyInstance,
  })),
  updateShellLifecycleState: vi.fn((taskId, state) => {
    if (taskId === mockPoolEntry.taskId) {
      mockPoolEntry.ptyActive = state.ptyActive
      mockPoolEntry.needsClear = state.shellExited
      mockPoolEntry.currentPtyInstance = state.currentPtyInstance
    }
  }),
  isShellExited: vi.fn(() => {
    return !mockPoolEntry.ptyActive && mockPoolEntry.needsClear
  }),
}))

import TaskTerminal from './TaskTerminal.svelte'

describe('TaskTerminal', () => {
  it('calls onExit when a matching pty-exit event fires', async () => {
    const onExitMock = vi.fn()
    
    render(TaskTerminal, { 
      props: { 
        taskId: 'T-1', worktreePath: '/path/to/worktree', 
        terminalKey: 'T-1-shell-2', terminalIndex: 2, 
        isActive: true, onExit: onExitMock 
      } 
    })

    await vi.waitFor(() => {
      expect(listenCallback).not.toBeNull()
    })

    // simulate matching instance
    const { updateShellLifecycleState } = await import('../lib/terminalPool')
    updateShellLifecycleState('T-1-shell-2', { ptyActive: true, shellExited: false, currentPtyInstance: 1 })
    
    if (!listenCallback) {
      throw new Error('Expected pty-exit listener to be registered')
    }

    listenCallback({ payload: { instance_id: 1 } })

    expect(onExitMock).toHaveBeenCalled()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockPoolEntry.taskId = ''
    mockPoolEntry.ptyActive = false
    mockPoolEntry.attached = false
    mockPoolEntry.needsClear = false
    mockPoolEntry.currentPtyInstance = null
    mockPoolEntry.terminal.cols = 80
    mockPoolEntry.terminal.rows = 24
    listenCallback = null
  })

  function emitPtyExit(payload: unknown = {}): void {
    if (!listenCallback) {
      throw new Error('Expected pty-exit listener to be registered')
    }

    listenCallback({ payload })
  }

  it('renders terminal wrapper div', async () => {
    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })
    await vi.waitFor(() => {
      const termWrapper = document.querySelector('.shell-terminal-wrapper')
      expect(termWrapper).toBeTruthy()
    })
  })

  it('calls acquire with terminalKey prop on mount', async () => {
    const { acquire } = await import('../lib/terminalPool')

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })
    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalledWith('T-1-shell-0')
    })
  })

  it('calls attach with pool entry and wrapper element', async () => {
    const { attach } = await import('../lib/terminalPool')

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })
    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
  })

  it('does not attach when inactive, then attaches when activated', async () => {
    const { attach } = await import('../lib/terminalPool')

    const { rerender } = render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: false } })

    await vi.waitFor(() => {
      expect(document.querySelector('.shell-terminal-wrapper')).toBeTruthy()
    })

    expect(attach).not.toHaveBeenCalled()

    await rerender({ taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true })

    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
  })

  it('does not detach when becoming inactive, so pooled terminal stays mounted in place', async () => {
    const { attach, detach } = await import('../lib/terminalPool')

    const { rerender } = render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })

    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalled()
    })

    vi.mocked(detach).mockClear()

    await rerender({ taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: false })

    expect(detach).not.toHaveBeenCalled()
  })

  it('calls detach on component destroy', async () => {
    const { detach, attach } = await import('../lib/terminalPool')

    const { unmount } = render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })
    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalled()
    })

    unmount()
    expect(detach).toHaveBeenCalledWith(mockPoolEntry)
  })

  it('spawns shell PTY with terminalIndex when ptyActive is false', async () => {
    const { spawnShellPty } = await import('../lib/ipc')
    mockPoolEntry.ptyActive = false

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-2', terminalIndex: 2, isActive: true } })
    await vi.waitFor(() => {
      expect(spawnShellPty).toHaveBeenCalledWith('T-1', '/path/to/worktree', 80, 24, 2)
    })
  })

  it('does not spawn shell PTY when ptyActive is true', async () => {
    const { spawnShellPty } = await import('../lib/ipc')
    const { acquire } = await import('../lib/terminalPool')
    mockPoolEntry.ptyActive = true

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })
    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalled()
    })

    expect(spawnShellPty).not.toHaveBeenCalled()
  })

  it('does not spawn shell PTY while inactive', async () => {
    const { spawnShellPty } = await import('../lib/ipc')
    mockPoolEntry.ptyActive = false

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: false } })

    await vi.waitFor(() => {
      expect(document.querySelector('.shell-terminal-wrapper')).toBeTruthy()
    })

    expect(spawnShellPty).not.toHaveBeenCalled()
  })

  it('waits for pooled attach sizing before spawning the shell PTY', async () => {
    const { spawnShellPty } = await import('../lib/ipc')
    const { attach } = await import('../lib/terminalPool')

    let resolveAttach!: () => void
    const attachPromise = new Promise<void>((resolve) => {
      resolveAttach = () => {
        mockPoolEntry.terminal.cols = 132
        mockPoolEntry.terminal.rows = 40
        resolve()
      }
    })

    vi.mocked(attach).mockImplementationOnce(() => attachPromise)

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(spawnShellPty).not.toHaveBeenCalled()

    resolveAttach()

    await vi.waitFor(() => {
      expect(spawnShellPty).toHaveBeenCalledWith('T-1', '/path/to/worktree', 132, 40, 0)
    })
  })

  it('does not spawn a shell after unmount when attach resolves late', async () => {
    const { spawnShellPty } = await import('../lib/ipc')
    const { attach } = await import('../lib/terminalPool')

    let resolveAttach!: () => void
    const attachPromise = new Promise<void>((resolve) => {
      resolveAttach = resolve
    })

    vi.mocked(attach).mockImplementationOnce(() => attachPromise)

    const view = render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })

    view.unmount()
    resolveAttach()
    await Promise.resolve()

    expect(spawnShellPty).not.toHaveBeenCalled()
  })

  it('shows shell exited overlay when PTY exits', async () => {
    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })

    await vi.waitFor(() => {
      expect(listenCallback).not.toBeNull()
    })

    emitPtyExit()

    await vi.waitFor(() => {
      expect(screen.getByText('Shell exited')).toBeTruthy()
    })
  })

  it('ignores stale pty-exit events from older shell instances', async () => {
    const { spawnShellPty } = await import('../lib/ipc')
    vi.mocked(spawnShellPty).mockResolvedValue(2)

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })

    await vi.waitFor(() => {
      expect(listenCallback).not.toBeNull()
      expect(spawnShellPty).toHaveBeenCalled()
    })

    emitPtyExit({ instance_id: 1 })

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(screen.queryByText('Shell exited')).toBeNull()
  })

  it('shows restart button when shell has exited', async () => {
    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })

    await vi.waitFor(() => {
      expect(listenCallback).not.toBeNull()
    })

    emitPtyExit()

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy()
    })
  })

  it('does not override terminal theme on mount', async () => {
    const { attach } = await import('../lib/terminalPool')

    // Set a theme before mount to simulate pool's theme subscription
    const originalTheme = { background: '#POOLBG', foreground: '#POOLFG' }
    mockPoolEntry.terminal.options.theme = { ...originalTheme }

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true } })
    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalled()
    })

    // Theme should remain unchanged — TaskTerminal must not override pool theme
    const theme = mockPoolEntry.terminal.options.theme as Record<string, string>
    expect(theme.background).toBe('#POOLBG')
    expect(theme.foreground).toBe('#POOLFG')
  })

  it('listens for pty-exit event with terminalKey', async () => {
    const { listen } = await import('@tauri-apps/api/event')

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-2', terminalIndex: 2, isActive: true } })

    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledWith('pty-exit-T-1-shell-2', expect.any(Function))
    })
  })

  it('shows shell exited overlay immediately when pool says shell already exited', async () => {
    mockPoolEntry.ptyActive = false
    mockPoolEntry.needsClear = true

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-2', terminalIndex: 2, isActive: true } })

    await vi.waitFor(() => {
      expect(screen.getByText('Shell exited')).toBeTruthy()
    })
  })

  it('restart button calls killPty with terminalKey and spawnShellPty with terminalIndex', async () => {
    const { killPty, spawnShellPty } = await import('../lib/ipc')

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-2', terminalIndex: 2, isActive: true } })

    // Wait for mount to complete and listener to be set up
    await vi.waitFor(() => {
      expect(listenCallback).not.toBeNull()
    })

    // Simulate shell exit
    emitPtyExit()

    // Wait for restart button to appear
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy()
    })

    // Click restart button
    const restartButton = screen.getByRole('button', { name: 'Restart' })
    await fireEvent.click(restartButton)

    // Verify killPty was called with terminalKey
    await vi.waitFor(() => {
      expect(killPty).toHaveBeenCalledWith('T-1-shell-2')
    })

    // Verify spawnShellPty was called twice (once on mount, once on restart) with terminalIndex
    await vi.waitFor(() => {
      expect(spawnShellPty).toHaveBeenCalledTimes(2)
      expect(spawnShellPty).toHaveBeenLastCalledWith('T-1', '/path/to/worktree', 80, 24, 2)
    })
  })

  it('restart marks pool entry active immediately', async () => {
    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-2', terminalIndex: 2, isActive: true } })

    await vi.waitFor(() => {
      expect(listenCallback).not.toBeNull()
    })

    emitPtyExit()

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy()
    })

    mockPoolEntry.ptyActive = false
    const restartButton = screen.getByRole('button', { name: 'Restart' })
    await fireEvent.click(restartButton)

    expect(mockPoolEntry.ptyActive).toBe(true)
  })

  it('does not spawn the same shell twice while the initial spawn is still in flight', async () => {
    const { spawnShellPty } = await import('../lib/ipc')

    let resolveSpawn!: () => void
    vi.mocked(spawnShellPty).mockImplementation(() => new Promise<number>((resolve) => {
      resolveSpawn = () => resolve(1)
    }))

    const first = render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-2', terminalIndex: 2, isActive: true } })

    await vi.waitFor(() => {
      expect(spawnShellPty).toHaveBeenCalledTimes(1)
    })

    first.unmount()

    render(TaskTerminal, { props: { taskId: 'T-1', worktreePath: '/path/to/worktree', terminalKey: 'T-1-shell-2', terminalIndex: 2, isActive: true } })

    expect(spawnShellPty).toHaveBeenCalledTimes(1)

    resolveSpawn()
  })
})
