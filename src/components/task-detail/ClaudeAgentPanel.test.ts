import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createAgentSession,
  describeProviderPanelBehavior,
  resetAgentTerminalTestState,
  setActiveSession,
} from './agentTerminalShell.testUtils'
import ClaudeAgentPanel from './ClaudeAgentPanel.svelte'

const baseSession = createAgentSession({ provider: 'claude-code' })

describe('ClaudeAgentPanel', () => {
  beforeEach(() => {
    resetAgentTerminalTestState()
  })

  describeProviderPanelBehavior({
    name: 'ClaudeAgentPanel',
    component: ClaudeAgentPanel,
    baseSession,
  })

  it('shows claude resume command when a session id is available', () => {
    setActiveSession(baseSession)

    render(ClaudeAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('claude --resume claude-sess-abc123')).toBeTruthy()
  })
})
