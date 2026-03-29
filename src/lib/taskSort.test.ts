import { describe, it, expect } from 'vitest'
import type { Task, AgentSession } from './types'
import { sortBySessionActivity, sortForSearch } from './taskSort'

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    initial_prompt: overrides.id,
    status: 'doing',
    prompt: null,
    summary: null,
    agent: null,
    permission_mode: null,
    project_id: null,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

function makeSession(overrides: Partial<AgentSession> & { id: string }): AgentSession {
  return {
    ticket_id: 'T-1',
    opencode_session_id: null,
    stage: 'implement',
    status: 'running',
    checkpoint_data: null,
    error_message: null,
    created_at: 1000,
    updated_at: 1000,
    provider: 'claude-code',
    claude_session_id: null,
    ...overrides,
  }
}

describe('sortBySessionActivity', () => {
  it('sorts tasks by session updated_at descending', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', updated_at: 1000 })],
      ['T-2', makeSession({ id: 's-2', ticket_id: 'T-2', updated_at: 3000 })],
      ['T-3', makeSession({ id: 's-3', ticket_id: 'T-3', updated_at: 2000 })],
    ])

    const tasks = [
      makeTask({ id: 'T-1' }),
      makeTask({ id: 'T-2' }),
      makeTask({ id: 'T-3' }),
    ]

    const sorted = sortBySessionActivity(tasks, sessions)
    expect(sorted.map(t => t.id)).toEqual(['T-2', 'T-3', 'T-1'])
  })

  it('falls back to task updated_at when no session exists', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', updated_at: 2000 })],
    ])

    const tasks = [
      makeTask({ id: 'T-1', updated_at: 1000 }),
      makeTask({ id: 'T-2', updated_at: 3000 }),
    ]

    const sorted = sortBySessionActivity(tasks, sessions)
    expect(sorted.map(t => t.id)).toEqual(['T-2', 'T-1'])
  })

  it('returns empty array for empty input', () => {
    expect(sortBySessionActivity([], new Map())).toEqual([])
  })

  it('does not mutate original array', () => {
    const tasks = [makeTask({ id: 'T-1' }), makeTask({ id: 'T-2' })]
    const sorted = sortBySessionActivity(tasks, new Map())
    expect(sorted).not.toBe(tasks)
  })
})

describe('sortForSearch', () => {
  it('puts blocked/needs-input tasks first', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', status: 'running', updated_at: 5000 })],
      ['T-2', makeSession({ id: 's-2', ticket_id: 'T-2', status: 'paused', checkpoint_data: '{"question":"help?"}', updated_at: 1000 })],
    ])

    const tasks = [
      makeTask({ id: 'T-1' }),
      makeTask({ id: 'T-2' }),
    ]

    const sorted = sortForSearch(tasks, sessions)
    expect(sorted[0].id).toBe('T-2')
  })

  it('puts failed/interrupted tasks in blocked group', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', status: 'running', updated_at: 5000 })],
      ['T-2', makeSession({ id: 's-2', ticket_id: 'T-2', status: 'failed', updated_at: 1000 })],
      ['T-3', makeSession({ id: 's-3', ticket_id: 'T-3', status: 'interrupted', updated_at: 1000 })],
    ])

    const tasks = [
      makeTask({ id: 'T-1' }),
      makeTask({ id: 'T-2' }),
      makeTask({ id: 'T-3' }),
    ]

    const sorted = sortForSearch(tasks, sessions)
    expect(sorted[0].id).toBe('T-2')
    expect(sorted[1].id).toBe('T-3')
    expect(sorted[2].id).toBe('T-1')
  })

  it('sorts done before running', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', status: 'running', updated_at: 5000 })],
      ['T-2', makeSession({ id: 's-2', ticket_id: 'T-2', status: 'completed', updated_at: 1000 })],
    ])

    const tasks = [
      makeTask({ id: 'T-1' }),
      makeTask({ id: 'T-2' }),
    ]

    const sorted = sortForSearch(tasks, sessions)
    expect(sorted[0].id).toBe('T-2')
    expect(sorted[1].id).toBe('T-1')
  })

  it('sorts done tasks (by task status) before running', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', status: 'running', updated_at: 5000 })],
    ])

    const tasks = [
      makeTask({ id: 'T-1' }),
      makeTask({ id: 'T-2', status: 'done' }),
    ]

    const sorted = sortForSearch(tasks, sessions)
    expect(sorted[0].id).toBe('T-2')
    expect(sorted[1].id).toBe('T-1')
  })

  it('sorts by session activity within the same priority group', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', status: 'running', updated_at: 1000 })],
      ['T-2', makeSession({ id: 's-2', ticket_id: 'T-2', status: 'running', updated_at: 3000 })],
      ['T-3', makeSession({ id: 's-3', ticket_id: 'T-3', status: 'running', updated_at: 2000 })],
    ])

    const tasks = [
      makeTask({ id: 'T-1' }),
      makeTask({ id: 'T-2' }),
      makeTask({ id: 'T-3' }),
    ]

    const sorted = sortForSearch(tasks, sessions)
    expect(sorted.map(t => t.id)).toEqual(['T-2', 'T-3', 'T-1'])
  })

  it('applies full priority: blocked > done > running > other', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', status: 'running', updated_at: 5000 })],
      ['T-2', makeSession({ id: 's-2', ticket_id: 'T-2', status: 'paused', checkpoint_data: '{}', updated_at: 1000 })],
      ['T-3', makeSession({ id: 's-3', ticket_id: 'T-3', status: 'completed', updated_at: 2000 })],
    ])

    const tasks = [
      makeTask({ id: 'T-1' }),
      makeTask({ id: 'T-2' }),
      makeTask({ id: 'T-3' }),
      makeTask({ id: 'T-4', status: 'backlog' }),
    ]

    const sorted = sortForSearch(tasks, sessions)
    expect(sorted.map(t => t.id)).toEqual(['T-2', 'T-3', 'T-1', 'T-4'])
  })
})
