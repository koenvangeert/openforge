import { render, screen } from '@testing-library/svelte'
import type { Component } from 'svelte'
import { describe, it, expect, vi } from 'vitest'
import type { AgentSession } from '../../lib/types'
import { activeSessions } from '../../lib/stores'

interface MockWritable<T> {
  set(value: T): void
  update(updater: (value: T) => T): void
  subscribe(run: (value: T) => void): () => void
}

type DesktopEventCallback = (event: { payload: unknown }) => void

const mocks = vi.hoisted(() => {
  function createMockWritable<T>(initialValue: T): MockWritable<T> {
    let value = initialValue
    const subscribers = new Set<(value: T) => void>()

    function notify() {
      subscribers.forEach((subscriber) => subscriber(value))
    }

    return {
      set(nextValue: T) {
        value = nextValue
        notify()
      },
      update(updater: (value: T) => T) {
        value = updater(value)
        notify()
      },
      subscribe(run: (value: T) => void) {
        run(value)
        subscribers.add(run)
        return () => {
          subscribers.delete(run)
        }
      },
    }
  }

  const activeSessions = createMockWritable<Map<string, AgentSession>>(new Map())
  const poolEntry = {
    taskId: '',
    terminal: { write: vi.fn(), dispose: vi.fn(), reset: vi.fn(), cols: 80, rows: 24 },
    fitAddon: { fit: vi.fn(), proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }) },
    hostDiv: document.createElement('div'),
    ptyActive: false,
    needsClear: false,
    unlisteners: [] as Array<() => void>,
    resizeObserver: null,
    visibilityObserver: null,
    resizeTimeout: null,
    attached: false,
  }
  const shellLifecycleState = {
    ptyActive: false,
    shellExited: false,
    currentPtyInstance: null as number | null,
  }
  const listenCallbacks = new Map<string, DesktopEventCallback[]>()

  return { activeSessions, poolEntry, shellLifecycleState, listenCallbacks }
})

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

vi.mock('../../lib/stores', () => ({
  activeSessions: mocks.activeSessions,
}))

vi.mock('../../lib/ipc', () => ({
  abortImplementation: vi.fn().mockResolvedValue(undefined),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  killPty: vi.fn().mockResolvedValue(undefined),
  transcribeAudio: vi.fn(),
  getWhisperModelStatus: vi.fn(),
  downloadWhisperModel: vi.fn(),
  getPtyBuffer: vi.fn().mockResolvedValue(null),
  getLatestSession: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../lib/desktopIpc', () => ({
  listenDesktopEvent: vi.fn().mockImplementation((eventName: string, cb: DesktopEventCallback) => {
    const existing = mocks.listenCallbacks.get(eventName) || []
    existing.push(cb)
    mocks.listenCallbacks.set(eventName, existing)
    return Promise.resolve(() => {})
  }),
}))

vi.mock('../../lib/audioRecorder', () => ({
  createAudioRecorder: vi.fn(),
}))

vi.mock('../../lib/terminalPool', () => ({
  acquire: vi.fn().mockResolvedValue(mocks.poolEntry),
  attach: vi.fn(),
  detach: vi.fn(),
  release: vi.fn(),
  getShellLifecycleState: vi.fn().mockImplementation(() => ({ ...mocks.shellLifecycleState })),
  isPtyActive: vi.fn().mockImplementation(() => mocks.shellLifecycleState.ptyActive),
  isValidTerminalDimensions: vi.fn().mockReturnValue(true),
  updateShellLifecycleState: vi.fn().mockImplementation((_taskId: string, state: typeof mocks.shellLifecycleState) => {
    mocks.shellLifecycleState.ptyActive = state.ptyActive
    mocks.shellLifecycleState.shellExited = state.shellExited
    mocks.shellLifecycleState.currentPtyInstance = state.currentPtyInstance
  }),
}))

export const mockPoolEntry = mocks.poolEntry
export const mockShellLifecycleState = mocks.shellLifecycleState
export const listenCallbacks = mocks.listenCallbacks

export function resetAgentTerminalTestState() {
  vi.clearAllMocks()
  mocks.activeSessions.set(new Map())
  mocks.poolEntry.ptyActive = false
  mocks.poolEntry.attached = false
  mocks.poolEntry.fitAddon.fit.mockClear()
  mocks.poolEntry.fitAddon.proposeDimensions.mockClear()
  mocks.poolEntry.terminal.write.mockClear()
  mocks.poolEntry.terminal.reset.mockClear()
  mocks.poolEntry.terminal.dispose.mockClear()
  mocks.listenCallbacks.clear()
  mocks.shellLifecycleState.ptyActive = false
  mocks.shellLifecycleState.shellExited = false
  mocks.shellLifecycleState.currentPtyInstance = null
}

export function createAgentSession(overrides: Partial<AgentSession> = {}): AgentSession {
  const provider = overrides.provider ?? 'pi-code'

  return {
    id: 'ses-1',
    ticket_id: 'T-1',
    opencode_session_id: null,
    stage: 'implement',
    status: 'running',
    checkpoint_data: null,
    error_message: null,
    created_at: 1000,
    updated_at: 2000,
    provider,
    claude_session_id: provider === 'claude-code' ? 'claude-sess-abc123' : null,
    pi_session_id: provider === 'pi-code' ? 'pi-sess-abc123' : null,
    ...overrides,
  }
}

export function setActiveSession(session: AgentSession = createAgentSession()) {
  const sessions = new Map<string, AgentSession>()
  sessions.set(session.ticket_id, session)
  mocks.activeSessions.set(sessions)
}

interface ProviderPanelBehaviorOptions {
  name: string
  component: Component<{ taskId: string; isStarting?: boolean }>
  baseSession: AgentSession
}

export function describeProviderPanelBehavior({ name, component, baseSession }: ProviderPanelBehaviorOptions) {
  describe(`${name} shared provider-panel behavior`, () => {
    it('renders the terminal container element', async () => {
      render(component, { props: { taskId: 'T-1' } })
      await vi.waitFor(() => {
        const termWrapper = document.querySelector('.shell-terminal-wrapper')
        expect(termWrapper).toBeTruthy()
      })
    })

    it('shows "No active agent session" when no session exists', async () => {
      render(component, { props: { taskId: 'T-1' } })
      await vi.waitFor(() => {
        expect(screen.getByText('No active agent session')).toBeTruthy()
      })
    })

    it('shows guidance text when no session exists', async () => {
      render(component, { props: { taskId: 'T-1' } })
      await vi.waitFor(() => {
        expect(screen.getByText('Use the action buttons in the header to get started')).toBeTruthy()
      })
    })

    it('shows status badge when session is running', () => {
      setActiveSession(baseSession)

      render(component, { props: { taskId: 'T-1' } })
      expect(screen.getByText('RUNNING')).toBeTruthy()
    })

    it('shows stage label when session is running', () => {
      setActiveSession(baseSession)

      render(component, { props: { taskId: 'T-1' } })
      expect(screen.getByText('// implementing')).toBeTruthy()
    })

    it('shows completed badge when session is completed', () => {
      setActiveSession({ ...baseSession, status: 'completed' })

      render(component, { props: { taskId: 'T-1' } })
      expect(screen.getByText('COMPLETED')).toBeTruthy()
    })

    it('shows failed badge when session has failed', () => {
      setActiveSession({ ...baseSession, status: 'failed' })

      render(component, { props: { taskId: 'T-1' } })
      expect(screen.getByText('FAILED')).toBeTruthy()
    })

    it('shows interrupted badge when session is interrupted', () => {
      setActiveSession({ ...baseSession, status: 'interrupted' })

      render(component, { props: { taskId: 'T-1' } })
      expect(screen.getByText('INTERRUPTED')).toBeTruthy()
    })

    it('shows error status text when session is interrupted', async () => {
      setActiveSession({ ...baseSession, status: 'interrupted' })

      render(component, { props: { taskId: 'T-1' } })
      await vi.waitFor(() => {
        expect(screen.getByText('Error occurred')).toBeTruthy()
      })
    })

    it('renders voice input mic button', async () => {
      render(component, { props: { taskId: 'T-1' } })
      await vi.waitFor(() => {
        const button = screen.getByRole('button', { name: 'Start voice input' })
        expect(button).toBeTruthy()
      })
    })

    it('hides "No active agent session" when session exists', () => {
      setActiveSession(baseSession)

      render(component, { props: { taskId: 'T-1' } })
      expect(screen.queryByText('No active agent session')).toBeNull()
    })

    it('calls acquire on mount', async () => {
      const { acquire } = await import('../../lib/terminalPool')

      setActiveSession(baseSession)

      render(component, { props: { taskId: 'T-1' } })
      await vi.waitFor(() => {
        expect(acquire).toHaveBeenCalledWith('T-1')
      })
    })

    it('calls attach with the pooled terminal entry on mount', async () => {
      const { attach } = await import('../../lib/terminalPool')

      render(component, { props: { taskId: 'T-1' } })
      await vi.waitFor(() => {
        expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
      })
    })

    it('updates status when active session store changes', async () => {
      setActiveSession({ ...baseSession, status: 'running' })

      render(component, { props: { taskId: 'T-1' } })
      expect(screen.getByText('RUNNING')).toBeTruthy()

      setActiveSession({ ...baseSession, status: 'completed' })

      await vi.waitFor(() => {
        expect(screen.getByText('COMPLETED')).toBeTruthy()
      })
      expect(screen.queryByText('RUNNING')).toBeNull()

      setActiveSession({ ...baseSession, status: 'failed' })

      await vi.waitFor(() => {
        expect(screen.getByText('FAILED')).toBeTruthy()
      })
      expect(screen.queryByText('COMPLETED')).toBeNull()
    })

    it('shows starting animation when isStarting=true and no session', async () => {
      render(component, { props: { taskId: 'T-1', isStarting: true } })
      await vi.waitFor(() => {
        expect(screen.getByText('Starting agent session...')).toBeTruthy()
        expect(screen.getByText('Preparing workspace and launching agent')).toBeTruthy()
        expect(screen.queryByText('No active agent session')).toBeNull()
      })
    })

    it('hides starting animation when session exists even if isStarting=true', () => {
      setActiveSession(baseSession)

      render(component, { props: { taskId: 'T-1', isStarting: true } })
      expect(screen.queryByText('Starting agent session...')).toBeNull()
    })

    it('hides the empty-state overlay when terminal pool reports an active PTY', async () => {
      mockPoolEntry.ptyActive = false
      mockShellLifecycleState.ptyActive = true

      render(component, { props: { taskId: 'T-1' } })

      await vi.waitFor(() => {
        expect(screen.queryByText('No active agent session')).toBeNull()
      })
    })

    it('shows abort button only while the session is running', async () => {
      setActiveSession({ ...baseSession, status: 'running' })

      const { unmount } = render(component, { props: { taskId: 'T-1' } })

      await vi.waitFor(() => {
        expect(screen.queryByRole('button', { name: /abort/i })).toBeTruthy()
      })

      unmount()
      activeSessions.set(new Map())

      setActiveSession({ ...baseSession, status: 'completed' })

      render(component, { props: { taskId: 'T-1' } })

      await vi.waitFor(() => {
        expect(screen.queryByText('COMPLETED')).toBeTruthy()
      })
      expect(screen.queryByRole('button', { name: /abort/i })).toBeNull()
    })
  })
}
