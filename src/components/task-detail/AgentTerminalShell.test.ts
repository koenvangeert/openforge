import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { AgentSession } from '../../lib/types'

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

vi.mock('../../lib/stores', () => ({
  activeSessions: writable(new Map()),
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
}))

vi.mock('../../lib/desktopIpc', () => ({
  listenDesktopEvent: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('../../lib/audioRecorder', () => ({
  createAudioRecorder: vi.fn(),
}))

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
    shellExited: false,
    currentPtyInstance: null as number | null,
  },
}))

vi.mock('../../lib/terminalPool', () => ({
  acquire: vi.fn().mockResolvedValue(mockPoolEntry),
  attach: vi.fn(),
  detach: vi.fn(),
  release: vi.fn(),
  getShellLifecycleState: vi.fn().mockImplementation(() => ({ ...mockShellLifecycleState })),
  isPtyActive: vi.fn().mockImplementation(() => mockShellLifecycleState.ptyActive),
  updateShellLifecycleState: vi.fn().mockImplementation((_taskId: string, state: typeof mockShellLifecycleState) => {
    mockShellLifecycleState.ptyActive = state.ptyActive
    mockShellLifecycleState.shellExited = state.shellExited
    mockShellLifecycleState.currentPtyInstance = state.currentPtyInstance
  }),
}))

import AgentTerminalShell from './AgentTerminalShell.svelte'
import { activeSessions } from '../../lib/stores'

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
  provider: 'pi-code',
  claude_session_id: null,
  pi_session_id: 'pi-sess-abc123',
}

const stageLabels: Record<string, string> = {
  read_ticket: 'reading ticket',
  implement: 'implementing',
  create_pr: 'creating PR',
  address_comments: 'addressing comments',
}

describe('AgentTerminalShell', () => {
  beforeEach(() => {
    activeSessions.set(new Map())
    mockPoolEntry.ptyActive = false
    mockPoolEntry.attached = false
    mockShellLifecycleState.ptyActive = false
  })

  it('preserves provider-specific chrome while sharing terminal shell behavior', async () => {
    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', baseSession)
    activeSessions.set(sessions)

    const { acquire, attach } = await import('../../lib/terminalPool')

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        runningText: 'Pi agent running...',
        logPrefix: 'PiAgentPanel',
        sessionIdKey: 'pi_session_id',
        rootTestId: 'pi-agent-panel',
        stageLabels,
      },
    })

    expect(await screen.findByText('Pi agent running...')).toBeTruthy()
    expect(screen.getByText('// implementing')).toBeTruthy()
    expect(screen.getByText('RUNNING')).toBeTruthy()
    expect(screen.getByText('pi-sess-abc123')).toBeTruthy()
    expect(screen.getByTestId('pi-agent-panel')).toBeTruthy()
    expect(document.querySelector('.shell-terminal-wrapper')).toBeTruthy()

    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalledWith('T-1')
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
  })

  it('shows the shared starting empty state when no session is active', async () => {
    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        isStarting: true,
        runningText: 'Claude agent running...',
        logPrefix: 'ClaudeAgentPanel',
        sessionIdKey: 'claude_session_id',
        stageLabels,
      },
    })

    expect(await screen.findByText('Starting agent session...')).toBeTruthy()
    expect(screen.getByText('Preparing workspace and launching agent')).toBeTruthy()
    expect(screen.queryByText('No active agent session')).toBeNull()
  })
})
