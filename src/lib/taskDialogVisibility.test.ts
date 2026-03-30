import { describe, expect, it } from 'vitest'

import { shouldLoadTaskDialogAgents, shouldShowTaskDialogAgentSelector } from './taskDialogVisibility'

describe('taskDialogVisibility', () => {
  it('does not show the agent selector for claude code even when agents exist', () => {
    expect(
      shouldShowTaskDialogAgentSelector({
        isEditing: false,
        aiProvider: 'claude-code',
        availableAgents: ['alpha'],
      }),
    ).toBe(false)
  })

  it('shows the agent selector for non-claude providers with available agents', () => {
    expect(
      shouldShowTaskDialogAgentSelector({
        isEditing: false,
        aiProvider: 'opencode',
        availableAgents: ['alpha'],
      }),
    ).toBe(true)
  })

  it('does not load agent options for claude code', () => {
    expect(shouldLoadTaskDialogAgents('claude-code')).toBe(false)
  })

  it('loads agent options for opencode', () => {
    expect(shouldLoadTaskDialogAgents('opencode')).toBe(true)
  })
})
