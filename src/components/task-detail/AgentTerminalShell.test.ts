import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createAgentSession,
  mockPoolEntry,
  resetAgentTerminalTestState,
  setActiveSession,
} from './agentTerminalShell.testUtils'
import AgentTerminalShell from './AgentTerminalShell.svelte'

const baseSession = createAgentSession({ provider: 'pi-code' })

const stageLabels: Record<string, string> = {
  read_ticket: 'reading ticket',
  implement: 'implementing',
  create_pr: 'creating PR',
  address_comments: 'addressing comments',
}

describe('AgentTerminalShell', () => {
  beforeEach(() => {
    resetAgentTerminalTestState()
  })

  it('preserves provider-specific chrome while sharing terminal shell behavior', async () => {
    setActiveSession(baseSession)

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
