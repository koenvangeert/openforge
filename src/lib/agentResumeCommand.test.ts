import { describe, expect, it } from 'vitest'
import { getAgentResumeCommand } from './agentResumeCommand'

describe('getAgentResumeCommand', () => {
  it('builds copy-pasteable resume commands for each terminal agent provider', () => {
    expect(getAgentResumeCommand('opencode', 'oc-sess-1')).toBe('opencode --session oc-sess-1')
    expect(getAgentResumeCommand('claude-code', 'claude-sess-1')).toBe('claude --resume claude-sess-1')
    expect(getAgentResumeCommand('pi', 'pi-sess-1')).toBe('pi --session pi-sess-1')
  })

  it('returns null when no provider session id is available', () => {
    expect(getAgentResumeCommand('opencode', null)).toBeNull()
    expect(getAgentResumeCommand('claude-code', '')).toBeNull()
  })
})
