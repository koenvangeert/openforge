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

  it('shows pi session id when available', () => {
    setActiveSession(baseSession)

    render(PiAgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('pi-sess-abc123')).toBeTruthy()
  })
})
