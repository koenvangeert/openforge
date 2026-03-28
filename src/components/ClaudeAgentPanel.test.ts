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

vi.mock('../lib/stores', () => ({
  activeSessions: writable(new Map()),
}))

vi.mock('../lib/ipc', () => ({
  abortImplementation: vi.fn().mockResolvedValue(undefined),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  killPty: vi.fn().mockResolvedValue(undefined),
  transcribeAudio: vi.fn(),
  getWhisperModelStatus: vi.fn(),
  downloadWhisperModel: vi.fn(),
  getPtyBuffer: vi.fn().mockResolvedValue(null),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('../lib/audioRecorder', () => ({
  createAudioRecorder: vi.fn(),
}))

// Mock terminalPool to avoid xterm constructor issues in test environment
const { mockPoolEntry, mockShellLifecycleState } = vi.hoisted(() => ({
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
  mockShellLifecycleState: {
    ptyActive: false,
  },
}))

vi.mock('../lib/terminalPool', () => ({
  acquire: vi.fn().mockResolvedValue(mockPoolEntry),
  attach: vi.fn(),
  detach: vi.fn(),
  release: vi.fn(),
  isPtyActive: vi.fn().mockImplementation(() => mockShellLifecycleState.ptyActive),
}))

import ClaudeAgentPanel from './ClaudeAgentPanel.svelte'
import { activeSessions } from '../lib/stores'

const baseSession: AgentSession = {
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
  claude_session_id: 'claude-sess-abc123',
}

describe('ClaudeAgentPanel', () => {
  beforeEach(() => {
    activeSessions.set(new Map())
    mockPoolEntry.ptyActive = false
    mockPoolEntry.attached = false
    mockShellLifecycleState.ptyActive = false
  })

  it('renders the terminal container element', async () => {
    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      const termWrapper = document.querySelector('.shell-terminal-wrapper')
      expect(termWrapper).toBeTruthy()
    })
  })

  it('shows "No active agent session" when no session exists', async () => {
    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      expect(screen.getByText('No active agent session')).toBeTruthy()
    })
  })

  it('shows guidance text when no session exists', async () => {
    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      expect(screen.getByText('Use the action buttons in the header to get started')).toBeTruthy()
    })
  })

  it('shows status badge when session is running', () => {
    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', baseSession)
    activeSessions.set(sessions)

    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('RUNNING')).toBeTruthy()
  })

  it('shows stage label when session is running', () => {
    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', baseSession)
    activeSessions.set(sessions)

    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('// implementing')).toBeTruthy()
  })

  it('shows completed badge when session is completed', () => {
    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', { ...baseSession, status: 'completed' })
    activeSessions.set(sessions)

    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('COMPLETED')).toBeTruthy()
  })

  it('shows failed badge when session has failed', () => {
    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', { ...baseSession, status: 'failed' })
    activeSessions.set(sessions)

    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('FAILED')).toBeTruthy()
  })

  it('shows interrupted badge when session is interrupted', () => {
    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', { ...baseSession, status: 'interrupted' })
    activeSessions.set(sessions)

    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('INTERRUPTED')).toBeTruthy()
  })

  it('shows error status text when session is interrupted', async () => {
    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', { ...baseSession, status: 'interrupted' })
    activeSessions.set(sessions)

    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      expect(screen.getByText('Error occurred')).toBeTruthy()
    })
  })

  it('shows claude session id when available', () => {
    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', baseSession)
    activeSessions.set(sessions)

    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('claude-sess-abc123')).toBeTruthy()
  })

  it('renders voice input mic button', async () => {
    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      const button = screen.getByRole('button', { name: 'Start voice input' })
      expect(button).toBeTruthy()
    })
  })

  it('hides "No active agent session" when session exists', () => {
    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', baseSession)
    activeSessions.set(sessions)

    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.queryByText('No active agent session')).toBeNull()
  })

  it('calls acquire on mount', async () => {
    const { acquire } = await import('../lib/terminalPool')

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', baseSession)
    activeSessions.set(sessions)

    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalledWith('T-1')
    })
  })

  it('calls attach with the pooled terminal entry on mount', async () => {
    const { attach } = await import('../lib/terminalPool')

    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
  })

  it('test_status_transitions_from_store_updates', async () => {
    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', { ...baseSession, status: 'running' })
    activeSessions.set(sessions)

    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('RUNNING')).toBeTruthy()

    const completedSessions = new Map<string, AgentSession>()
    completedSessions.set('T-1', { ...baseSession, status: 'completed' })
    activeSessions.set(completedSessions)

    await vi.waitFor(() => {
      expect(screen.getByText('COMPLETED')).toBeTruthy()
    })
    expect(screen.queryByText('RUNNING')).toBeNull()

    const failedSessions = new Map<string, AgentSession>()
    failedSessions.set('T-1', { ...baseSession, status: 'failed' })
    activeSessions.set(failedSessions)

    await vi.waitFor(() => {
      expect(screen.getByText('FAILED')).toBeTruthy()
    })
    expect(screen.queryByText('COMPLETED')).toBeNull()
  })

  it('shows starting animation when isStarting=true and no session', async () => {
    render(ClaudeAgentPanel, { props: { taskId: 'T-1', isStarting: true } })
    await vi.waitFor(() => {
      expect(screen.getByText('Starting agent session...')).toBeTruthy()
      expect(screen.getByText('Preparing workspace and launching agent')).toBeTruthy()
      expect(screen.queryByText('No active agent session')).toBeNull()
    })
  })

  it('hides starting animation when session exists even if isStarting=true', () => {
    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', baseSession)
    activeSessions.set(sessions)

    render(ClaudeAgentPanel, { props: { taskId: 'T-1', isStarting: true } })
    expect(screen.queryByText('Starting agent session...')).toBeNull()
  })

  it('hides the empty-state overlay when terminal pool reports an active PTY', async () => {
    mockPoolEntry.ptyActive = false
    mockShellLifecycleState.ptyActive = true

    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })

    await vi.waitFor(() => {
      expect(screen.queryByText('No active agent session')).toBeNull()
    })
  })

  it('test_abort_button_visible_only_when_running', async () => {
    const runningSessions = new Map<string, AgentSession>()
    runningSessions.set('T-1', { ...baseSession, status: 'running' })
    activeSessions.set(runningSessions)

    const { unmount } = render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })

    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: /abort/i })).toBeTruthy()
    })

    unmount()
    activeSessions.set(new Map())

    const completedSessions = new Map<string, AgentSession>()
    completedSessions.set('T-1', { ...baseSession, status: 'completed' })
    activeSessions.set(completedSessions)

    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })

    await vi.waitFor(() => {
      expect(screen.queryByText('COMPLETED')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /abort/i })).toBeNull()
  })
})
