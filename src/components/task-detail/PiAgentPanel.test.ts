import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createAgentSession,
  mockPoolEntry,
  mockShellLifecycleState,
  resetAgentTerminalTestState,
  setActiveSession,
} from './agentTerminalShell.testUtils'
import PiAgentPanel from './PiAgentPanel.svelte'
import { activeSessions } from '../../lib/stores'

const baseSession = createAgentSession({ provider: 'pi-code' })

describe('PiAgentPanel', () => {
  beforeEach(() => {
    resetAgentTerminalTestState()
  })

  it('renders the terminal container element', async () => {
    render(PiAgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      const termWrapper = document.querySelector('.shell-terminal-wrapper')
      expect(termWrapper).toBeTruthy()
    })
  })

  it('shows "No active agent session" when no session exists', async () => {
    render(PiAgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      expect(screen.getByText('No active agent session')).toBeTruthy()
    })
  })

  it('shows guidance text when no session exists', async () => {
    render(PiAgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      expect(screen.getByText('Use the action buttons in the header to get started')).toBeTruthy()
    })
  })

  it('shows status badge when session is running', () => {
    setActiveSession(baseSession)

    render(PiAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('RUNNING')).toBeTruthy()
  })

  it('shows stage label when session is running', () => {
    setActiveSession(baseSession)

    render(PiAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('// implementing')).toBeTruthy()
  })

  it('shows completed badge when session is completed', () => {
    setActiveSession({ ...baseSession, status: 'completed' })

    render(PiAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('COMPLETED')).toBeTruthy()
  })

  it('shows failed badge when session has failed', () => {
    setActiveSession({ ...baseSession, status: 'failed' })

    render(PiAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('FAILED')).toBeTruthy()
  })

  it('shows interrupted badge when session is interrupted', () => {
    setActiveSession({ ...baseSession, status: 'interrupted' })

    render(PiAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('INTERRUPTED')).toBeTruthy()
  })

  it('shows error status text when session is interrupted', async () => {
    setActiveSession({ ...baseSession, status: 'interrupted' })

    render(PiAgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      expect(screen.getByText('Error occurred')).toBeTruthy()
    })
  })

  it('shows pi session id when available', () => {
    setActiveSession(baseSession)

    render(PiAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('pi-sess-abc123')).toBeTruthy()
  })

  it('renders voice input mic button', async () => {
    render(PiAgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      const button = screen.getByRole('button', { name: 'Start voice input' })
      expect(button).toBeTruthy()
    })
  })

  it('hides "No active agent session" when session exists', () => {
    setActiveSession(baseSession)

    render(PiAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.queryByText('No active agent session')).toBeNull()
  })

  it('calls acquire on mount', async () => {
    const { acquire } = await import('../../lib/terminalPool')

    setActiveSession(baseSession)

    render(PiAgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalledWith('T-1')
    })
  })

  it('calls attach with the pooled terminal entry on mount', async () => {
    const { attach } = await import('../../lib/terminalPool')

    render(PiAgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
  })

  it('test_status_transitions_from_store_updates', async () => {
    setActiveSession({ ...baseSession, status: 'running' })

    render(PiAgentPanel, { props: { taskId: 'T-1' } })
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
    render(PiAgentPanel, { props: { taskId: 'T-1', isStarting: true } })
    await vi.waitFor(() => {
      expect(screen.getByText('Starting agent session...')).toBeTruthy()
      expect(screen.getByText('Preparing workspace and launching agent')).toBeTruthy()
      expect(screen.queryByText('No active agent session')).toBeNull()
    })
  })

  it('hides starting animation when session exists even if isStarting=true', () => {
    setActiveSession(baseSession)

    render(PiAgentPanel, { props: { taskId: 'T-1', isStarting: true } })
    expect(screen.queryByText('Starting agent session...')).toBeNull()
  })

  it('hides the empty-state overlay when terminal pool reports an active PTY', async () => {
    mockPoolEntry.ptyActive = false
    mockShellLifecycleState.ptyActive = true

    render(PiAgentPanel, { props: { taskId: 'T-1' } })

    await vi.waitFor(() => {
      expect(screen.queryByText('No active agent session')).toBeNull()
    })
  })

  it('test_abort_button_visible_only_when_running', async () => {
    setActiveSession({ ...baseSession, status: 'running' })

    const { unmount } = render(PiAgentPanel, { props: { taskId: 'T-1' } })

    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: /abort/i })).toBeTruthy()
    })

    unmount()
    activeSessions.set(new Map())

    setActiveSession({ ...baseSession, status: 'completed' })

    render(PiAgentPanel, { props: { taskId: 'T-1' } })

    await vi.waitFor(() => {
      expect(screen.queryByText('COMPLETED')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /abort/i })).toBeNull()
  })
})
