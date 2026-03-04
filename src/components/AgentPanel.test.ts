import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { AgentSession } from '../lib/types'

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
  getAgentLogs: vi.fn().mockResolvedValue([]),
  transcribeAudio: vi.fn(),
  getWhisperModelStatus: vi.fn(),
  downloadWhisperModel: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('../lib/audioRecorder', () => ({
  createAudioRecorder: vi.fn(),
}))

// Mock terminalPool to avoid xterm constructor issues in test environment
const { mockPoolEntry } = vi.hoisted(() => ({
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
}))

vi.mock('../lib/terminalPool', () => ({
  acquire: vi.fn().mockResolvedValue(mockPoolEntry),
  attach: vi.fn(),
  detach: vi.fn(),
  release: vi.fn(),
  releaseAll: vi.fn(),
  _getPool: vi.fn().mockReturnValue(new Map()),
}))

vi.mock('../lib/useSessionHistory.svelte', () => ({
  createSessionHistory: vi.fn(() => ({
    get loadingHistory() { return false },
    get storedEvents() { return [] },
    loadSessionHistory: vi.fn().mockResolvedValue(undefined),
  })),
}))

import AgentPanel from './AgentPanel.svelte'
import { activeSessions } from '../lib/stores'

describe('AgentPanel (router)', () => {
  beforeEach(() => {
    activeSessions.set(new Map())
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
    expect(screen.getByText('Implementing')).toBeTruthy()
    expect(screen.getByText('running')).toBeTruthy()
  })
})

describe('OpenCodeAgentPanel (via router)', () => {
  beforeEach(() => {
    activeSessions.set(new Map())
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
