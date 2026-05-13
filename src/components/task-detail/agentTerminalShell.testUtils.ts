import { vi } from 'vitest'
import type { AgentSession } from '../../lib/types'

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
  const provider = overrides.provider ?? 'pi'

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
    pi_session_id: provider === 'pi' ? 'pi-sess-abc123' : null,
    ...overrides,
  }
}

export function setActiveSession(session: AgentSession = createAgentSession()) {
  const sessions = new Map<string, AgentSession>()
  sessions.set(session.ticket_id, session)
  mocks.activeSessions.set(sessions)
}
