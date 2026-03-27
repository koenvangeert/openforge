import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import type { Task, AgentSession, Project } from '../lib/types'
import { matchesSearch, sortTasks, filterActiveTasks, navigateToTask } from '../lib/commandPalette'
import { tasks, activeProjectId, currentView, selectedTaskId, pendingTask } from '../lib/stores'

function makeProject(overrides: Partial<Project> & { id: string; name: string }): Project {
  return {
    path: '/tmp/test',
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    initial_prompt: 'Test task',
    status: 'doing',
    jira_key: null,
    jira_title: null,
    jira_status: null,
    jira_assignee: null,
    jira_description: null,
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

function makeSession(taskId: string, status: string): AgentSession {
  return {
    id: `session-${taskId}`,
    ticket_id: taskId,
    opencode_session_id: null,
    stage: 'implementation',
    status,
    checkpoint_data: null,
    error_message: null,
    created_at: 1000,
    updated_at: 1000,
    provider: 'claude-code',
    claude_session_id: null,
  }
}

describe('CommandPalette sorting', () => {
  it('sorts attention tasks (paused) before active tasks', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'doing', updated_at: 100 }),
      makeTask({ id: 'T-2', status: 'doing', updated_at: 200 }),
    ]
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession('T-1', 'running')],
      ['T-2', makeSession('T-2', 'paused')],
    ])

    const sorted = sortTasks(tasks, sessions)
    expect(sorted.map(t => t.id)).toEqual(['T-2', 'T-1'])
  })

  it('sorts attention tasks (interrupted) before active tasks', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'doing', updated_at: 300 }),
      makeTask({ id: 'T-2', status: 'doing', updated_at: 100 }),
    ]
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession('T-1', 'completed')],
      ['T-2', makeSession('T-2', 'interrupted')],
    ])

    const sorted = sortTasks(tasks, sessions)
    expect(sorted.map(t => t.id)).toEqual(['T-2', 'T-1'])
  })

  it('sorts active (doing) before backlog before done', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done', updated_at: 300 }),
      makeTask({ id: 'T-2', status: 'backlog', updated_at: 200 }),
      makeTask({ id: 'T-3', status: 'doing', updated_at: 100 }),
    ]
    const sessions = new Map<string, AgentSession>()

    const sorted = sortTasks(tasks, sessions)
    expect(sorted.map(t => t.id)).toEqual(['T-3', 'T-2', 'T-1'])
  })

  it('sorts by updated_at DESC within same priority', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'doing', updated_at: 100 }),
      makeTask({ id: 'T-2', status: 'doing', updated_at: 300 }),
      makeTask({ id: 'T-3', status: 'doing', updated_at: 200 }),
    ]
    const sessions = new Map<string, AgentSession>()

    const sorted = sortTasks(tasks, sessions)
    expect(sorted.map(t => t.id)).toEqual(['T-2', 'T-3', 'T-1'])
  })

  it('handles full priority ordering: attention > doing > backlog > done', () => {
    const tasks = [
      makeTask({ id: 'T-done', status: 'done', updated_at: 500 }),
      makeTask({ id: 'T-backlog', status: 'backlog', updated_at: 400 }),
      makeTask({ id: 'T-doing', status: 'doing', updated_at: 300 }),
      makeTask({ id: 'T-paused', status: 'doing', updated_at: 200 }),
      makeTask({ id: 'T-interrupted', status: 'doing', updated_at: 100 }),
    ]
    const sessions = new Map<string, AgentSession>([
      ['T-paused', makeSession('T-paused', 'paused')],
      ['T-interrupted', makeSession('T-interrupted', 'interrupted')],
      ['T-doing', makeSession('T-doing', 'running')],
    ])

    const sorted = sortTasks(tasks, sessions)
    expect(sorted.map(t => t.id)).toEqual([
      'T-paused',       // attention (paused), updated_at 200
      'T-interrupted',  // attention (interrupted), updated_at 100
      'T-doing',        // doing (running session), updated_at 300
      'T-backlog',      // backlog, updated_at 400
      'T-done',         // done, updated_at 500
    ])
  })
})

describe('CommandPalette filterActiveTasks', () => {
  it('excludes tasks with status done', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'doing' }),
      makeTask({ id: 'T-2', status: 'done' }),
      makeTask({ id: 'T-3', status: 'backlog' }),
      makeTask({ id: 'T-4', status: 'done' }),
    ]
    const result = filterActiveTasks(tasks)
    expect(result.map(t => t.id)).toEqual(['T-1', 'T-3'])
  })

  it('returns all tasks when none are done', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'doing' }),
      makeTask({ id: 'T-2', status: 'backlog' }),
    ]
    const result = filterActiveTasks(tasks)
    expect(result.map(t => t.id)).toEqual(['T-1', 'T-2'])
  })

  it('returns empty array when all tasks are done', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done' }),
      makeTask({ id: 'T-2', status: 'done' }),
    ]
    const result = filterActiveTasks(tasks)
    expect(result).toEqual([])
  })
})

describe('CommandPalette search filtering', () => {
  it('matches by task ID', () => {
    const task = makeTask({ id: 'T-42', initial_prompt: 'Something' })
    expect(matchesSearch(task, 't-42')).toBe(true)
    expect(matchesSearch(task, 'T-99')).toBe(false)
  })

  it('matches by title', () => {
    const task = makeTask({ id: 'T-1', initial_prompt: 'Fix the login bug' })
    expect(matchesSearch(task, 'login')).toBe(true)
    expect(matchesSearch(task, 'signup')).toBe(false)
  })

  it('matches by jira key', () => {
    const task = makeTask({ id: 'T-1', jira_key: 'PROJ-123' })
    expect(matchesSearch(task, 'proj-123')).toBe(true)
  })

  it('matches by jira title', () => {
    const task = makeTask({ id: 'T-1', jira_title: 'Implement OAuth' })
    expect(matchesSearch(task, 'oauth')).toBe(true)
  })

  it('matches by jira assignee', () => {
    const task = makeTask({ id: 'T-1', jira_assignee: 'john.doe' })
    expect(matchesSearch(task, 'john')).toBe(true)
  })

  it('returns all tasks when query is empty', () => {
    const task = makeTask({ id: 'T-1' })
    expect(matchesSearch(task, '')).toBe(true)
  })

  it('matches by project name when projectMap is provided', () => {
    const task = makeTask({ id: 'T-1', project_id: 'P-1' })
    const projectMap = new Map([['P-1', makeProject({ id: 'P-1', name: 'My Frontend App' })]])
    expect(matchesSearch(task, 'frontend', projectMap)).toBe(true)
    expect(matchesSearch(task, 'backend', projectMap)).toBe(false)
  })

  it('still matches other fields when projectMap is provided', () => {
    const task = makeTask({ id: 'T-42', initial_prompt: 'Fix login', project_id: 'P-1' })
    const projectMap = new Map([['P-1', makeProject({ id: 'P-1', name: 'My App' })]])
    expect(matchesSearch(task, 't-42', projectMap)).toBe(true)
    expect(matchesSearch(task, 'login', projectMap)).toBe(true)
    expect(matchesSearch(task, 'my app', projectMap)).toBe(true)
  })

  it('handles task with no project_id gracefully', () => {
    const task = makeTask({ id: 'T-1', project_id: null })
    const projectMap = new Map([['P-1', makeProject({ id: 'P-1', name: 'My App' })]])
    expect(matchesSearch(task, 'my app', projectMap)).toBe(false)
    expect(matchesSearch(task, 'T-1', projectMap)).toBe(true)
  })
})

describe('navigateToTask', () => {
  beforeEach(() => {
    activeProjectId.set(null)
    currentView.set('board')
    selectedTaskId.set(null)
    pendingTask.set(null)
    tasks.set([])
  })

  it('sets pending task without mutating tasks when switching to a different project', () => {
    activeProjectId.set('P-1')
    const existing = [makeTask({ id: 'T-old', project_id: 'P-1' })]
    tasks.set(existing)

    const task = makeTask({ id: 'T-new', project_id: 'P-2' })
    navigateToTask(task)

    expect(get(activeProjectId)).toBe('P-2')
    expect(get(selectedTaskId)).toBe('T-new')
    expect(get(currentView)).toBe('board')
    expect(get(pendingTask)?.id).toBe('T-new')
    expect(get(tasks)).toEqual(existing)
  })

  it('does not set pending task or replace tasks when task is in same project', () => {
    activeProjectId.set('P-1')
    const existing = [makeTask({ id: 'T-1', project_id: 'P-1' }), makeTask({ id: 'T-2', project_id: 'P-1' })]
    tasks.set(existing)

    navigateToTask(existing[1])

    expect(get(activeProjectId)).toBe('P-1')
    expect(get(selectedTaskId)).toBe('T-2')
    expect(get(tasks)).toEqual(existing)
    expect(get(pendingTask)).toBeNull()
  })

  it('sets currentView to board', () => {
    activeProjectId.set('P-1')
    currentView.set('workqueue')

    navigateToTask(makeTask({ id: 'T-1', project_id: 'P-1' }))

    expect(get(currentView)).toBe('board')
  })

  it('handles task with null project_id without changing active project', () => {
    activeProjectId.set('P-1')

    navigateToTask(makeTask({ id: 'T-1', project_id: null }))

    expect(get(activeProjectId)).toBe('P-1')
    expect(get(selectedTaskId)).toBe('T-1')
    expect(get(pendingTask)).toBeNull()
  })
})
