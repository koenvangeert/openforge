import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createAgentSession,
  listenCallbacks,
  mockPoolEntry,
  mockShellLifecycleState,
  resetAgentTerminalTestState,
  setActiveSession,
} from './agentTerminalShell.testUtils'
import AgentTerminalShell from './AgentTerminalShell.svelte'

const baseSession = createAgentSession({ provider: 'pi' })

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

  it.each([
    {
      providerName: 'Pi',
      session: createAgentSession({ provider: 'pi', pi_session_id: 'pi-sess-abc123' }),
      runningText: 'Pi agent running...',
      logPrefix: 'AgentPanel:Pi',
      sessionIdKey: 'pi_session_id' as const,
      expectedCommand: 'pi --session pi-sess-abc123',
    },
    {
      providerName: 'Claude',
      session: createAgentSession({ provider: 'claude-code', claude_session_id: 'claude-sess-abc123' }),
      runningText: 'Claude agent running...',
      logPrefix: 'AgentPanel:Claude',
      sessionIdKey: 'claude_session_id' as const,
      expectedCommand: 'claude --resume claude-sess-abc123',
    },
    {
      providerName: 'OpenCode',
      session: createAgentSession({ provider: 'opencode', opencode_session_id: 'opencode-sess-abc123' }),
      runningText: 'Agent running...',
      logPrefix: 'AgentPanel:OpenCode',
      sessionIdKey: 'opencode_session_id' as const,
      expectedCommand: 'opencode --session opencode-sess-abc123',
    },
  ])('keeps the pooled terminal attached across $providerName unmount/remount without clearing or killing the PTY', async ({
    session,
    runningText,
    logPrefix,
    sessionIdKey,
    expectedCommand,
  }) => {
    setActiveSession(session)
    mockShellLifecycleState.ptyActive = true

    const { acquire, attach, detach, release } = await import('../../lib/terminalPool')
    const { killPty } = await import('../../lib/ipc')

    const firstRender = render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        runningText,
        logPrefix,
        sessionIdKey,
        stageLabels,
      },
    })

    expect(await screen.findByText(expectedCommand)).toBeTruthy()
    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })

    firstRender.unmount()
    expect(detach).toHaveBeenCalledWith(mockPoolEntry)
    expect(release).not.toHaveBeenCalled()
    expect(killPty).not.toHaveBeenCalled()
    expect(mockPoolEntry.terminal.reset).not.toHaveBeenCalled()
    expect(mockPoolEntry.terminal.dispose).not.toHaveBeenCalled()

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        runningText,
        logPrefix,
        sessionIdKey,
        stageLabels,
      },
    })

    expect(await screen.findByText(expectedCommand)).toBeTruthy()
    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalledTimes(2)
      expect(attach).toHaveBeenCalledTimes(2)
      expect(attach).toHaveBeenLastCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
    expect(release).not.toHaveBeenCalled()
    expect(killPty).not.toHaveBeenCalled()
    expect(mockPoolEntry.terminal.reset).not.toHaveBeenCalled()
    expect(mockPoolEntry.terminal.dispose).not.toHaveBeenCalled()
  })

  it('hydrates PTY instance metadata from status events while preserving active pooled terminal state', async () => {
    setActiveSession(createAgentSession({ provider: 'opencode', opencode_session_id: 'opencode-sess-abc123' }))
    mockShellLifecycleState.ptyActive = true

    const { updateShellLifecycleState } = await import('../../lib/terminalPool')

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        runningText: 'Agent running...',
        logPrefix: 'AgentPanel:OpenCode',
        sessionIdKey: 'opencode_session_id',
        stageLabels,
      },
    })

    await vi.waitFor(() => {
      expect(listenCallbacks.get('agent-status-changed')?.length).toBe(1)
    })

    listenCallbacks.get('agent-status-changed')?.[0]?.({
      payload: { task_id: 'T-1', status: 'running', pty_instance_id: 42 },
    })

    expect(updateShellLifecycleState).toHaveBeenCalledWith('T-1', {
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: 42,
    })
    expect(screen.getByText('Agent running...')).toBeTruthy()
    expect(screen.queryByText('No active agent session')).toBeNull()
  })

  it('preserves provider-specific chrome while sharing terminal shell behavior', async () => {
    setActiveSession(baseSession)

    const { acquire, attach } = await import('../../lib/terminalPool')

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        runningText: 'Pi agent running...',
        logPrefix: 'AgentPanel:Pi',
        sessionIdKey: 'pi_session_id',
        rootTestId: 'pi-agent-panel',
        stageLabels,
      },
    })

    expect(await screen.findByText('Pi agent running...')).toBeTruthy()
    expect(screen.getByText('// implementing')).toBeTruthy()
    expect(screen.getByText('RUNNING')).toBeTruthy()
    expect(screen.getByText('pi --session pi-sess-abc123')).toBeTruthy()
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
        logPrefix: 'AgentPanel:Claude',
        sessionIdKey: 'claude_session_id',
        stageLabels,
      },
    })

    expect(await screen.findByText('Starting agent session...')).toBeTruthy()
    expect(screen.getByText('Preparing workspace and launching agent')).toBeTruthy()
    expect(screen.queryByText('No active agent session')).toBeNull()
  })

  it('shows Claude permission requests as needing permission instead of still running', () => {
    setActiveSession(createAgentSession({
      provider: 'claude-code',
      status: 'paused',
      claude_session_id: 'claude-sess-abc123',
    }))

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        runningText: 'Claude agent running...',
        logPrefix: 'AgentPanel:Claude',
        sessionIdKey: 'claude_session_id',
        stageLabels,
      },
    })

    expect(screen.getByText('Agent needs permission')).toBeTruthy()
    expect(screen.getByText('PAUSED')).toBeTruthy()
    expect(screen.queryByText('Claude agent running...')).toBeNull()
  })

  it('shows OpenCode checkpoint question text from the shared terminal shell', () => {
    setActiveSession(createAgentSession({
      provider: 'opencode',
      status: 'paused',
      opencode_session_id: 'opencode-sess-abc123',
      checkpoint_data: '{"properties":{"description":"Allow file write to src/main.ts?"}}',
    }))

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        runningText: 'Agent running...',
        logPrefix: 'AgentPanel:OpenCode',
        sessionIdKey: 'opencode_session_id',
        stageLabels,
      },
    })

    expect(screen.getByText('Allow file write to src/main.ts?')).toBeTruthy()
  })

  it('shows the generic checkpoint fallback for unknown OpenCode payloads', () => {
    setActiveSession(createAgentSession({
      provider: 'opencode',
      status: 'paused',
      checkpoint_data: '{"unknown":"data"}',
    }))

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        runningText: 'Agent running...',
        logPrefix: 'AgentPanel:OpenCode',
        sessionIdKey: 'opencode_session_id',
        stageLabels,
      },
    })

    expect(screen.getByText('Agent is waiting for input')).toBeTruthy()
  })

  it.each([
    '{"pty_instance_id":42}',
    '{"ptyInstanceId":42}',
  ])('does not show a checkpoint banner for OpenCode PTY metadata payload %s', (checkpointData) => {
    setActiveSession(createAgentSession({
      provider: 'opencode',
      status: 'paused',
      checkpoint_data: checkpointData,
    }))

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        runningText: 'Agent running...',
        logPrefix: 'AgentPanel:OpenCode',
        sessionIdKey: 'opencode_session_id',
        stageLabels,
      },
    })

    expect(screen.queryByText('Agent is waiting for input')).toBeNull()
  })

  it('does not show a checkpoint banner for OpenCode sessions unless they are paused', () => {
    setActiveSession(createAgentSession({
      provider: 'opencode',
      status: 'running',
      checkpoint_data: '{"unknown":"data"}',
    }))

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        runningText: 'Agent running...',
        logPrefix: 'AgentPanel:OpenCode',
        sessionIdKey: 'opencode_session_id',
        stageLabels,
      },
    })

    expect(screen.queryByText('Agent is waiting for input')).toBeNull()
  })

  it('refits the terminal when an OpenCode checkpoint banner is removed', async () => {
    setActiveSession(createAgentSession({
      provider: 'opencode',
      status: 'paused',
      checkpoint_data: null,
    }))

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        runningText: 'Agent running...',
        logPrefix: 'AgentPanel:OpenCode',
        sessionIdKey: 'opencode_session_id',
        stageLabels,
      },
    })

    setActiveSession(createAgentSession({
      provider: 'opencode',
      status: 'paused',
      checkpoint_data: '{"unknown":"data"}',
    }))

    expect(await screen.findByText('Agent is waiting for input')).toBeTruthy()
    await vi.waitFor(() => {
      expect(mockPoolEntry.fitAddon.fit).toHaveBeenCalled()
    })
    vi.mocked(mockPoolEntry.fitAddon.fit).mockClear()

    setActiveSession(createAgentSession({
      provider: 'opencode',
      status: 'paused',
      checkpoint_data: '{"ptyInstanceId":42}',
    }))

    await vi.waitFor(() => {
      expect(screen.queryByText('Agent is waiting for input')).toBeNull()
    })
    await vi.waitFor(() => {
      expect(mockPoolEntry.fitAddon.fit).toHaveBeenCalled()
    })
  })
})
