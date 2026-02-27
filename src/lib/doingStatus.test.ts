import { describe, it, expect } from 'vitest'
import { computeDoingStatus } from './doingStatus'
import type { Task, AgentSession } from './types'

const makeTask = (id: string, status: string): Task => ({
  id,
  title: `Task ${id}`,
  status,
  jira_key: null,
  jira_title: null,
  jira_status: null,
  jira_assignee: null,
  plan_text: null,
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
})

describe('computeDoingStatus', () => {
  it('returns zeros when no tasks exist', () => {
    const result = computeDoingStatus([], new Map())
    expect(result).to3qual({
      doingCount: 0,
      hasNeedsAnswer: false,
      hasRunning: false,
      allDone: false,
    })
  })

  it('returns zeros when no tasks are in doing', () => {
    const tasks = [makeTask('T-1', 'backlog'), makeTask('T-2', 'done')]
    const result = computeDoingStatus(tasks, new Map())
    expect(result.doingCount).toBe(0)
    expect(result.hasNeedsAnswer).toBe(false)
    expect(result.hasRunning).toBe(false)
    expect(result.allDone).toBe(false)
  })

  it('counts only doing tasks', () => {
    const tasks = [
      makeTask('T-1', 'doing'),
      makeTask('T-2', 'backlog'),
      makeTask('T-3', 'doing'),
      makeTask('T-4', 'done'),
    ]
    const result = computeDoingStatus(tasks, new Map())
    expect(result.doingCount).toBe(2)
  })

  it('detects hasRunning when a doing task has running session', () => {
    const tasks = [makeTask('T-1', 'doing')]
    const sessions = new Map([['T-1', makeSession('T-1', 'running')]])
    const result = computeDoingStatus(tasks, sessions)
    expect(result.hasRunning).toBe(true)
  })

  it('hasRunning is false when running session belongs to non-doing task', () => {
    const tasks = [makeTask('T-1', 'backlog')]
    const sessions = new Map([['T-1', makeSession('T-1', 'running')]])
    const result = computeDoingStatus(tasks, sessions)
    expect(result.hasRunning).toBe(false)
  })

  it('detects hasNeedsAnswer when session is paused with checkpoint data', () => {
    const tasks = [makeTask('T-1', 'doing')]
    const sessions = new Map([['T-1', makeSession('T-1', 'paused', '{"question":"approve?"}')]])
    const result = computeDoingStatus(tasks, sessions)
    expect(result.hasNeedsAnswer).toBe(true)
  })

  it('hasNeedsAnswer is false when session is paused without checkpoint data', () => {
    const tasks = [makeTask('T-1', 'doing')]
    const sessions = new Map([['T-1', makeSession('T-1', 'paused', null)]])
    const result = computeDoingStatus(tasks, sessions)
    expect(result.hasNeedsAnswer).toBe(false)
  })

  it('hasNeedsAnswer is false when session is running (not paused)', () => {
    const tasks = [makeTask('T-1', 'doing')]
    const sessions = new Map([['T-1', makeSession('T-1', 'running')]])
    const result = computeDoingStatus(tasks, sessions)
    expect(result.hasNeedsAnswer).toBe(false)
  })

  it('detects allDone when every doing task has completed session', () => {
    const tasks = [makeTask('T-1', 'doing'), makeTask('T-2', 'doing')]
    const sessions = new Map([
      ['T-1', makeSession('T-1', 'completed')],
      ['T-2', makeSession('T-2', 'completed')],
    ])
    const result = computeDoingStatus(tasks, sessions)
    expect(result.allDone).toBe(true)
  })

  it('allDone is false when no doing tasks exist', () => {
    const result = computeDoingStatus([], new Map())
    expect(result.allDone).toBe(false)
  })

  it('allDone is false when any doing task has non-completed session', () => {
    const tasks = [makeTask('T-1', 'doing'), makeTask('T-2', 'doing')]
    const sessions = new Map([
      ['T-1', makeSession('T-1', 'completed')],
      ['T-2', makeSession('T-2', 'running')],
    ])
    const result = computeDoingStatus(tasks, sessions)
    expect(result.allDone).toBe(false)
  })

  it('allDone is false when doing task has no session', () => {
    const tasks = [makeTask('T-1', 'doing')]
    const result = computeDoingStatus(tasks, new Map())
    expect(result.allDone).toBe(false)
  })

  it('handles mixed statuses across multiple doing tasks', () => {
    const tasks = [
      makeTask('T-1', 'doing'),
      makeTask('T-2', 'doing'),
      makeTask('T-3', 'doing'),
    ]
    const sessions = new Map([
      ['T-1', makeSession('T-1', 'running')],
      ['T-2', makeSession('T-2', 'paused', '{"q":"yes?"}')],
      ['T-3', makeSession('T-3', 'completed')],
    ])
    const result = computeDoingStatus(tasks, sessions)
    expect(result.doingCount).toBe(3)
    expect(result.hasRunning).toBe(true)
    expect(result.hasNeedsAnswer).toBe(true)
    expect(result.allDone).toBe(false)
  })

  it('ignores non-doing task sessions in status checks', () => {
    const tasks = [
      makeTask('T-1', 'doing'),
      makeTask('T-2', 'backlog'),
    ]
    const sessions = new Map([
      ['T-1', makeSession('T-1', 'completed')],
      ['T-2', makeSession('T-2', 'running')],
    ])
    const result = computeDoingStatus(tasks, sessions)
    expect(result.doingCount).toBe(1)
    expect(result.hasRunning).toBe(false)
    expect(result.allDone).toBe(true)
  })
})
