import { describe, expect, it } from 'vitest'
import { filterActions, getAvailableActions, getGlobalActions, getTaskActions } from './actionPalette'
import type { Action, Task } from './types'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'T-100',
    initial_prompt: 'Test task',
    status: 'backlog',
    prompt: null,
    summary: null,
    agent: null,
    permission_mode: null,
    project_id: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }
}

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: 'custom-1',
    name: 'Custom Action',
    prompt: 'do something',
    builtin: false,
    enabled: true,
    ...overrides,
  }
}

describe('getTaskActions', () => {
  it('returns Start Task and Delete for backlog task', () => {
    const task = makeTask({ status: 'backlog' })
    const actions = getTaskActions(task, [])
    const ids = actions.map(a => a.id)
    expect(ids).toContain('start-task')
    expect(ids).not.toContain('move-to-done')
    expect(ids).toContain('delete-task')
  })

  it('returns Move to Done, Delete + custom actions for doing task', () => {
    const task = makeTask({ status: 'doing' })
    const custom = makeAction({ id: 'custom-1', name: 'Deploy' })
    const actions = getTaskActions(task, [custom])
    const ids = actions.map(a => a.id)
    expect(ids).not.toContain('start-task')
    expect(ids).toContain('move-to-done')
    expect(ids).toContain('delete-task')
    expect(ids).toContain('custom-action-custom-1')
  })

  it('returns Delete only for done task', () => {
    const task = makeTask({ status: 'done' })
    const actions = getTaskActions(task, [])
    const ids = actions.map(a => a.id)
    expect(ids).toContain('delete-task')
    expect(ids).not.toContain('move-to-done')
    expect(ids).not.toContain('start-task')
  })
})

describe('getGlobalActions', () => {
  it('returns 6 global actions', () => {
    const actions = getGlobalActions()
    expect(actions).toHaveLength(6)
    const ids = actions.map(a => a.id)
    expect(ids).toContain('go-back')
    expect(ids).toContain('search-tasks')
    expect(ids).toContain('new-task')
    expect(ids).toContain('switch-project')
    expect(ids).toContain('open-workqueue')
    expect(ids).toContain('refresh-github')
  })

  it('uses CMD+SHIFT+F for Search Tasks', () => {
    const actions = getGlobalActions()
    const searchTasks = actions.find(action => action.id === 'search-tasks')

    expect(searchTasks?.shortcut).toBe('⌘⇧F')
  })

  it('uses CMD+N for New Task', () => {
    const actions = getGlobalActions()
    const newTask = actions.find(action => action.id === 'new-task')

    expect(newTask?.shortcut).toBe('⌘N')
  })
})

describe('getAvailableActions', () => {
  it('returns task actions + global actions when task is provided', () => {
    const task = makeTask({ status: 'doing' })
    const actions = getAvailableActions(task, [])
    const ids = actions.map(a => a.id)
    expect(ids).toContain('move-to-done')
    expect(ids).toContain('delete-task')
    expect(ids).toContain('go-back')
    expect(ids).toContain('search-tasks')
  })

  it('returns global actions only when task is null', () => {
    const actions = getAvailableActions(null, [])
    const ids = actions.map(a => a.id)
    expect(ids).not.toContain('move-to-done')
    expect(ids).not.toContain('delete-task')
    expect(ids).toContain('go-back')
    expect(ids).toContain('search-tasks')
  })
})

describe('filterActions', () => {
  it('returns all actions for empty query', () => {
    const actions = getGlobalActions()
    expect(filterActions(actions, '')).toEqual(actions)
  })

  it('matches label substring case-insensitively', () => {
    const actions = getGlobalActions()
    const result = filterActions(actions, 'search')
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.some(a => a.id === 'search-tasks')).toBe(true)
  })

  it('matches keywords', () => {
    const actions = getGlobalActions()
    const result = filterActions(actions, 'find')
    expect(result.some(a => a.id === 'search-tasks')).toBe(true)
  })

  it('returns empty for no match', () => {
    const actions = getGlobalActions()
    expect(filterActions(actions, 'zzzzzznotexist')).toEqual([])
  })
})
