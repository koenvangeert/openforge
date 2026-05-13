import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createAgentSession,
  describeProviderPanelBehavior,
  resetAgentTerminalTestState,
  setActiveSession,
} from './agentTerminalShell.testUtils'
import PiAgentPanel from './PiAgentPanel.svelte'

const baseSession = createAgentSession({ provider: 'pi-code' })

describe('PiAgentPanel', () => {
  beforeEach(() => {
    resetAgentTerminalTestState()
  })

  describeProviderPanelBehavior({
    name: 'PiAgentPanel',
    component: PiAgentPanel,
    baseSession,
  })

  it('shows pi resume command when a session id is available', () => {
    setActiveSession(baseSession)

    render(PiAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('pi --session pi-sess-abc123')).toBeTruthy()
  })
})
