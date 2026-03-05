import { describe, it, expect } from 'vitest'
import { computeCreatureState } from './creatureState'
import type { Task, AgentSession } from './types'

const makeTask = (id: string, status: string): Task => ({
  id,
  title: `Task ${id}`,
  status,
  jira_key: null,
  jira_title: null,
  jira_status: null,
  jira_assignee: null,
  jira_description: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
})

const makeSession = (ticketId: string, status: string, checkpointData: string | null = null): AgentSession => ({
  id: `ses-${ticketId}`,
  ticket_id: ticketId,
  opencode_session_id: null,
  stage: 'implement',
  status,
  checkpoint_data: checkpointData,
  error_message: null,
  created_at: 1000,
  updated_at: 2000,
  provider: 'opencode',
  claude_session_id: null,
})

describe('computeCreatureState', () => {
  it('returns egg when task status is backlog (no session)', () => {
    const task = makeTask('T-1', 'backlog')
    const result = computeCreatureState(task, null)
    expect(result).toBe('egg')
  })

  it('returns egg when task status is backlog (with session)', () => {
    const task = makeTask('T-1', 'backlog')
    const session = makeSession('T-1', 'running')
    const result = computeCreatureState(task, session)
    expect(result).toBe('egg')
  })

  it('returns idle when task status is doing and session is null', () => {
    const task = makeTask('T-1', 'doing')
    const result = computeCreatureState(task, null)
    expect(result).toBe('idle')
  })

  it('returns active when task status is doing and session status is running', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'running')
    const result = computeCreatureState(task, session)
    expect(result).toBe('active')
  })

  it('returns needs-input when task status is doing and session is paused with checkpoint data', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'paused', '{"question":"approve?"}')
    const result = computeCreatureState(task, session)
    expect(result).toBe('needs-input')
  })

  it('returns resting when task status is doing and session is paused without checkpoint data', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'paused', null)
    const result = computeCreatureState(task, session)
    expect(result).toBe('resting')
  })

  it('returns celebrating when task status is doing and session status is completed', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'completed')
    const result = computeCreatureState(task, session)
    expect(result).toBe('celebrating')
  })

  it('returns sad when task status is doing and session status is failed', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'failed')
    const result = computeCreatureState(task, session)
    expect(result).toBe('sad')
  })

  it('returns frozen when task status is doing and session status is interrupted', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'interrupted')
    const result = computeCreatureState(task, session)
    expect(result).toBe('frozen')
  })

  it('returns idle as fallback for unknown task status', () => {
    const task = makeTask('T-1', 'done')
    const result = computeCreatureState(task, null)
    expect(result).toBe('idle')
  })

  it('returns idle as fallback for unknown session status', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'unknown-status')
    const result = computeCreatureState(task, session)
    expect(result).toBe('idle')
  })
})
