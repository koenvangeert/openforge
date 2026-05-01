import { describe, expect, it } from 'vitest'
import { getTaskPromptText } from './taskPrompt'
import type { Task } from './types'

describe('getTaskPromptText', () => {
  const baseTask = {
    id: 'T-123',
    status: 'backlog' as const,
    agent: null,
    summary: null,
    permission_mode: null,
    project_id: null,
    created_at: 0,
    updated_at: 0,
  }

  it('returns mutable prompt when present', () => {
    const task: Task = { ...baseTask, initial_prompt: 'Initial prompt', prompt: 'Edited prompt' }
    expect(getTaskPromptText(task)).toBe('Edited prompt')
  })

  it('falls back to immutable initial_prompt when prompt is empty', () => {
    const task: Task = { ...baseTask, initial_prompt: 'Initial prompt', prompt: '' }
    expect(getTaskPromptText(task)).toBe('Initial prompt')
  })

  it('falls back to empty string when both values are missing', () => {
    const task: Task = { ...baseTask, initial_prompt: '', prompt: null }
    expect(getTaskPromptText(task)).toBe('')
  })
})
