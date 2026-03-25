import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { AgentSession } from '../lib/types'

type TauriEventCallback = (event: { payload: unknown }) => void

// Mock xterm.js — provide a minimal Terminal stub
vi.mock('@xterm/xterm', () => {
  const Terminal = vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    loadAddon: vi.fn(),
    refresh: vi.fn(),
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

vi.mock('../lib/stores', () => ({
  activeSessions: writable(new Map()),
}))

vi.mock('../lib/ipc', () => ({
  abortImplementation: vi.fn().mockResolvedValue(undefined),
  getLatestSession: vi.fn().mockResolvedValue(null),
  getWorktreeForTask: vi.fn().mockResolvedValue(null),
  spawnPty: vi.fn().mockResolvedValue(1),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  killPty: vi.fn().mockResolvedValue(undefined),
  transcribeAudio: vi.fn(),
  getWhisperModelStatus: vi.fn(),
  downloadWhisperModel: vi.fn(),
}))

vi.mock('../lib/audioRecorder', () => ({
  createAudioRecorder: vi.fn(),
}))

// Mock terminalPool to avoid xterm constructor issues in test environment
const { listenCallbacks, mockPoolEntry, mockSessionHistoryPort, mockShellLifecycleState } = vi.hoisted(() => ({
  listenCallbacks: new Map<string, TauriEventCallback[]>(),
  mockPoolEntry: {
    taskId: '',
    terminal: { write: vi.fn(), dispose: vi.fn(), reset: vi.fn(), cols: 80, rows: 24 },
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
  mockSessionHistoryPort: { value: null as number | null },
  mockShellLifecycleState: {
    ptyActive: false,
    shellExited: false,
    currentPtyInstance: null as number | null,
  },
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockImplementation((eventName: string, cb: TauriEventCallback) => {
    const existing = listenCallbacks.get(eventName) || []
    existing.push(cb)
    listenCallbacks.set(eventName, existing)
    return Promise.resolve(() => {})
  }),
}))

vi.mock('../lib/terminalPool', () => ({
  acquire: vi.fn().mockResolvedValue(mockPoolEntry),
  attach: vi.fn(),
  detach: vi.fn(),
  release: vi.fn(),
  releaseAll: vi.fn(),
  getShellLifecycleState: vi.fn().mockImplementation(() => ({ ...mockShellLifecycleState })),
  isPtyActive: vi.fn().mockImplementation(() => mockShellLifecycleState.ptyActive),
  updateShellLifecycleState: vi.fn().mockImplementation((_taskId: string, state: typeof mockShellLifecycleState) => {
    mockShellLifecycleState.ptyActive = state.ptyActive
    mockShellLifecycleState.shellExited = state.shellExited
    mockShellLifecycleState.currentPtyInstance = state.currentPtyInstance
  }),
  _getPool: vi.fn().mockReturnValue(new Map()),
}))

vi.mock('../lib/useSessionHistory.svelte', () => ({
  createSessionHistory: vi.fn((deps: { setOpencodePort: (port: number) => void }) => ({
    get loadingHistory() { return false },
    loadSessionHistory: vi.fn().mockImplementation(async () => {
      if (mockSessionHistoryPort.value !== null) {
        deps.setOpencodePort(mockSessionHistoryPort.value)
      }
    }),
  })),
}))

import AgentPanel from './AgentPanel.svelte'
import { activeSessions } from '../lib/stores'
import { killPty, spawnPty } from '../lib/ipc'
import { updateShellLifecycleState } from '../lib/terminalPool'

function emitTauriEvent(eventName: string, payload: unknown = {}) {
  const callbacks = listenCallbacks.get(eventName) || []
  for (const cb of callbacks) {
    cb({ payload })
  }
}

describe('AgentPanel (router)', () => {
  beforeEach(() => {
    activeSessions.set(new Map())
    listenCallbacks.clear()
    mockSessionHistoryPort.value = null
    mockPoolEntry.ptyActive = false
    mockPoolEntry.needsClear = false
    mockShellLifecycleState.ptyActive = false
    mockShellLifecycleState.shellExited = false
    mockShellLifecycleState.currentPtyInstance = null
    vi.clearAllMocks()
  })

  it('renders OpenCode panel by default when no session exists', async () => {
    render(AgentPanel, { props: { taskId: 'T-1' } })
    // Wait for async onMount to complete
    await vi.waitFor(() => {
      expect(screen.getByText('No active agent session')).toBeTruthy()
    })
  })

  it('shows guidance text via OpenCode panel', async () => {
    render(AgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      expect(screen.getByText('Use the action buttons in the header to get started')).toBeTruthy()
    })
  })

  it('shows OpenCode panel for opencode provider session', async () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: 'oc-sess-1',
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('Implementing')).toBeTruthy()
    expect(screen.getByText('running')).toBeTruthy()
  })

  it('renders Claude panel for claude-code provider session', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'claude-code',
      claude_session_id: 'claude-sess-1',
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    // ClaudeAgentPanel uses uppercase status and "// " prefixed stage labels
    expect(screen.getByText('RUNNING')).toBeTruthy()
    expect(screen.getByText('claude-sess-1')).toBeTruthy()
  })
})

describe('AgentPanel starting animation', () => {
  beforeEach(() => {
    activeSessions.set(new Map())
    listenCallbacks.clear()
    mockSessionHistoryPort.value = null
    mockPoolEntry.ptyActive = false
    mockPoolEntry.needsClear = false
    mockShellLifecycleState.ptyActive = false
    mockShellLifecycleState.shellExited = false
    mockShellLifecycleState.currentPtyInstance = null
    vi.clearAllMocks()
  })

  it('shows starting animation when isStarting=true and no session', async () => {
    render(AgentPanel, { props: { taskId: 'T-1', isStarting: true } })
    await vi.waitFor(() => {
      expect(screen.getByText('Starting agent session...')).toBeTruthy()
      expect(screen.getByText('Preparing workspace and launching agent')).toBeTruthy()
      expect(screen.queryByText('No active agent session')).toBeNull()
    })
  })

  it('shows idle state when isStarting=false and no session', async () => {
    render(AgentPanel, { props: { taskId: 'T-1', isStarting: false } })
    await vi.waitFor(() => {
      expect(screen.getByText('No active agent session')).toBeTruthy()
      expect(screen.queryByText('Starting agent session...')).toBeNull()
    })
  })

  it('hides starting animation when session exists', async () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: 'oc-sess-1',
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1', isStarting: true } })
    expect(screen.queryByText('Starting agent session...')).toBeNull()
  })
})

describe('OpenCodeAgentPanel (via router)', () => {
  beforeEach(() => {
    activeSessions.set(new Map())
    listenCallbacks.clear()
    mockSessionHistoryPort.value = null
    mockPoolEntry.ptyActive = false
    mockPoolEntry.needsClear = false
    mockShellLifecycleState.ptyActive = false
    mockShellLifecycleState.shellExited = false
    mockShellLifecycleState.currentPtyInstance = null
    vi.clearAllMocks()
  })

  it('shows running session status', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('Implementing')).toBeTruthy()
    expect(screen.getByText('running')).toBeTruthy()
  })

  it('shows different stage labels', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'read_ticket',
      status: 'running',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('Reading Ticket')).toBeTruthy()
  })

  it('shows completed badge when session is completed', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: 'oc-sess-1',
      stage: 'implement',
      status: 'completed',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('completed')).toBeTruthy()
  })

  it('attaches a PTY for completed sessions when mounted', async () => {
    mockSessionHistoryPort.value = 4173

    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: 'oc-sess-1',
      stage: 'implement',
      status: 'completed',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    }

    activeSessions.set(new Map([['T-1', session]]))

    render(AgentPanel, { props: { taskId: 'T-1' } })

    await vi.waitFor(() => {
      expect(spawnPty).toHaveBeenCalledWith('T-1', 4173, 'oc-sess-1', 80, 24)
    })
  })

  it('attaches a PTY for interrupted sessions when mounted', async () => {
    mockSessionHistoryPort.value = 4173

    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: 'oc-sess-1',
      stage: 'implement',
      status: 'interrupted',
      checkpoint_data: null,
      error_message: 'App restarted',
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    }

    activeSessions.set(new Map([['T-1', session]]))

    render(AgentPanel, { props: { taskId: 'T-1' } })

    await vi.waitFor(() => {
      expect(spawnPty).toHaveBeenCalledWith('T-1', 4173, 'oc-sess-1', 80, 24)
    })
  })

  it('attaches a PTY for failed sessions when mounted', async () => {
    mockSessionHistoryPort.value = 4173

    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: 'oc-sess-1',
      stage: 'implement',
      status: 'failed',
      checkpoint_data: null,
      error_message: 'Agent crashed',
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    }

    activeSessions.set(new Map([['T-1', session]]))

    render(AgentPanel, { props: { taskId: 'T-1' } })

    await vi.waitFor(() => {
      expect(spawnPty).toHaveBeenCalledWith('T-1', 4173, 'oc-sess-1', 80, 24)
    })
  })

  it('does not respawn a PTY when lifecycle state is already active', async () => {
    mockSessionHistoryPort.value = 4173
    mockPoolEntry.ptyActive = false
    mockShellLifecycleState.ptyActive = true

    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: 'oc-sess-1',
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    }

    activeSessions.set(new Map([['T-1', session]]))

    render(AgentPanel, { props: { taskId: 'T-1' } })

    await vi.waitFor(() => {
      expect(screen.getByText('running')).toBeTruthy()
    })

    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('does not reattach a PTY when action-complete fires', async () => {
    mockSessionHistoryPort.value = 4173

    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: 'oc-sess-1',
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    }

    activeSessions.set(new Map([['T-1', session]]))

    render(AgentPanel, { props: { taskId: 'T-1' } })

    await vi.waitFor(() => {
      expect(spawnPty).toHaveBeenCalledTimes(1)
    })

    vi.mocked(spawnPty).mockClear()
    mockPoolEntry.ptyActive = false

    emitTauriEvent('action-complete', { task_id: 'T-1' })

    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('updates lifecycle state through terminalPool when aborting', async () => {
    mockShellLifecycleState.ptyActive = true
    mockShellLifecycleState.currentPtyInstance = 42

    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: 'oc-sess-1',
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    }

    activeSessions.set(new Map([['T-1', session]]))

    render(AgentPanel, { props: { taskId: 'T-1' } })

    const abortButton = await screen.findByRole('button', { name: 'Abort' })
    await fireEvent.click(abortButton)

    expect(killPty).toHaveBeenCalledWith('T-1')
    expect(updateShellLifecycleState).toHaveBeenCalledWith('T-1', {
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: 42,
    })
  })

  it('shows question banner when session is paused with checkpoint_data', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'implement',
      status: 'paused',
      checkpoint_data: '{"properties":{"description":"Allow file write to src/main.ts?"}}',
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('Allow file write to src/main.ts?')).toBeTruthy()
  })

  it('shows generic fallback banner when checkpoint_data has no known fields', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'implement',
      status: 'paused',
      checkpoint_data: '{"unknown":"data"}',
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('Agent is waiting for input')).toBeTruthy()
  })

  it('does not show question banner when session is running', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.queryByText('Agent is waiting for input')).toBeNull()
  })

  it('does not show question banner when no session exists', async () => {
    render(AgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      expect(screen.queryByText('Agent is waiting for input')).toBeNull()
    })
  })

  it('shows question text from question.asked event format', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'implement',
      status: 'paused',
      checkpoint_data: JSON.stringify({
        type: 'question.asked',
        properties: {
          id: 'que_abc',
          sessionID: 'ses_xyz',
          questions: [{ question: 'Run or Bike?', header: 'Run or Bike', options: [] }]
        }
      }),
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('Run or Bike?')).toBeTruthy()
  })

  it('renders voice input mic button', async () => {
    render(AgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      const button = screen.getByRole('button', { name: 'Start voice input' })
      expect(button).toBeTruthy()
    })
  })
})
