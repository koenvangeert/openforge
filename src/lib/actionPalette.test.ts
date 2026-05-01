import { describe, expect, it } from 'vitest'
import { filterActions, getAvailableActions, getGlobalActions, getTaskActions } from './actionPalette'
import { APP_SHORTCUT_DEFINITIONS } from './appShortcutDefinitions'
import type { Action, Task, PullRequestInfo } from './types'

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

function makePR(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 1,
    ticket_id: 'T-100',
    repo_owner: 'test',
    repo_name: 'test',
    title: 'Test PR',
    url: 'https://github.com/test/test/pull/1',
    state: 'open',
    head_sha: 'abc',
    ci_status: 'success',
    ci_check_runs: null,
    review_status: 'APPROVED',
    mergeable: true,
    mergeable_state: 'clean',
    merged_at: null,
    created_at: 0,
    updated_at: 0,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    ...overrides,
  }
}

describe('getTaskActions', () => {
  it('returns Start Task and Delete for backlog task', () => {
    const task = makeTask({ status: 'backlog' })
    const actions = getTaskActions(task, [], [])
    const ids = actions.map(a => a.id)
    expect(ids).toContain('start-task')
    expect(ids).not.toContain('move-to-done')
    expect(ids).toContain('delete-task')
  })

  it('returns Move to Done, Delete + custom actions for doing task', () => {
    const task = makeTask({ status: 'doing' })
    const custom = makeAction({ id: 'custom-1', name: 'Deploy' })
    const actions = getTaskActions(task, [custom], [])
    const ids = actions.map(a => a.id)
    expect(ids).not.toContain('start-task')
    expect(ids).toContain('move-to-done')
    expect(ids).toContain('delete-task')
    expect(ids).toContain('custom-action-custom-1')
  })

  it('returns Delete only for done task', () => {
    const task = makeTask({ status: 'done' })
    const actions = getTaskActions(task, [], [])
    const ids = actions.map(a => a.id)
    expect(ids).toContain('delete-task')
    expect(ids).not.toContain('move-to-done')
    expect(ids).not.toContain('start-task')
  })

  it('returns Merge Pull Request action when there is a ready-to-merge PR', () => {
    const task = makeTask({ status: 'doing' })
    const pr = makePR({ mergeable: true, mergeable_state: 'clean', state: 'open', draft: false, review_status: 'APPROVED', ci_status: 'success' })
    const actions = getTaskActions(task, [], [pr])
    const ids = actions.map(a => a.id)
    expect(ids).toContain('merge-pr')
  })

  it('does not return Merge Pull Request action when PR has merge conflicts', () => {
    const task = makeTask({ status: 'doing' })
    const pr = makePR({ mergeable: false, mergeable_state: 'dirty' })
    const actions = getTaskActions(task, [], [pr])
    const ids = actions.map(a => a.id)
    expect(ids).not.toContain('merge-pr')
  })

  it('does not return Merge Pull Request action when PR is already queued', () => {
    const task = makeTask({ status: 'doing' })
    const pr = makePR({ is_queued: true })
    const actions = getTaskActions(task, [], [pr])
    const ids = actions.map(a => a.id)
    expect(ids).not.toContain('merge-pr')
  })

  it('does not return Merge Pull Request action when multiple PRs are ready to merge', () => {
    const task = makeTask({ status: 'doing' })
    const firstPr = makePR({ id: 1, title: 'First ready PR' })
    const secondPr = makePR({ id: 2, title: 'Second ready PR', head_sha: 'def' })
    const actions = getTaskActions(task, [], [firstPr, secondPr])
    const ids = actions.map(a => a.id)
    expect(ids).not.toContain('merge-pr')
  })
})

describe('getGlobalActions', () => {
  it('returns global actions without Work Queue navigation', () => {
    const actions = getGlobalActions()
    expect(actions).toHaveLength(5)
    const ids = actions.map(a => a.id)
    expect(ids).toContain('go-back')
    expect(ids).toContain('search-tasks')
    expect(ids).toContain('new-task')
    expect(ids).toContain('switch-project')
    expect(ids).toContain('refresh-github')
    expect(ids).not.toContain('open-workqueue')
  })

  it('uses shared app shortcut definitions for global action labels and shortcuts', () => {
    const actions = getGlobalActions()
    const shortcutDefinitions = new Map(APP_SHORTCUT_DEFINITIONS.map(definition => [definition.id, definition]))

    for (const actionId of ['go-back', 'search-tasks', 'new-task', 'switch-project', 'refresh-github']) {
      const action = actions.find(candidate => candidate.id === actionId)
      const definition = shortcutDefinitions.get(actionId)
      const primaryShortcut = definition?.registrations[0]?.key ?? definition?.help?.keys[0]?.join('') ?? null

      expect(action, `missing global action ${actionId}`).toBeDefined()
      expect(definition, `missing shortcut definition ${actionId}`).toBeDefined()
      expect(action?.label).toBe(definition?.help?.label)
      expect(action?.shortcut).toBe(primaryShortcut)
    }
  })
})

describe('getAvailableActions', () => {
  it('returns task actions + global actions when task is provided', () => {
    const task = makeTask({ status: 'doing' })
    const actions = getAvailableActions(task, [], [])
    const ids = actions.map(a => a.id)
    expect(ids).toContain('move-to-done')
    expect(ids).toContain('delete-task')
    expect(ids).toContain('go-back')
    expect(ids).toContain('search-tasks')
  })

  it('returns global actions only when task is null', () => {
    const actions = getAvailableActions(null, [], [])
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
