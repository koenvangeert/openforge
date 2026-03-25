import { vi } from 'vitest'

vi.mock('./ipc', () => ({ getProjectConfig: vi.fn(), setProjectConfig: vi.fn() }))

import { describe, it, expect } from 'vitest'
import type { Task, AgentSession, PullRequestInfo } from './types'
import { isFocusTask, filterTasks, getFilterCounts, DEFAULT_FOCUS_STATES, loadFocusFilterStates, saveFocusFilterStates } from './boardFilters'
import { getProjectConfig, setProjectConfig } from './ipc'

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    initial_prompt: overrides.id,
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

function makePr(overrides: Partial<PullRequestInfo> & { id: number }): PullRequestInfo {
  return {
    ticket_id: 'T-1',
    repo_owner: 'test',
    repo_name: 'repo',
    title: 'Test PR',
    url: 'https://github.com/test/repo/pull/1',
    state: 'open',
    head_sha: 'abc123',
    ci_status: 'success',
    ci_check_runs: null,
    review_status: null,
    mergeable: true,
    mergeable_state: 'clean',
    merged_at: null,
    created_at: 1000,
    updated_at: 1000,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    ...overrides,
  }
}

describe('isFocusTask', () => {
  it('returns true for needs-input state', () => {
    const task = makeTask({ id: 'T-1' })
    const result = isFocusTask(task, 'needs-input', [])
    expect(result).toBe(true)
  })

  it('returns true for ci-failed state', () => {
    const task = makeTask({ id: 'T-1' })
    const result = isFocusTask(task, 'ci-failed', [])
    expect(result).toBe(true)
  })

  it('returns true for changes-requested state', () => {
    const task = makeTask({ id: 'T-1' })
    const result = isFocusTask(task, 'changes-requested', [])
    expect(result).toBe(true)
  })

  it('returns true for unaddressed-comments state', () => {
    const task = makeTask({ id: 'T-1' })
    const result = isFocusTask(task, 'unaddressed-comments' as any, [])
    expect(result).toBe(true)
  })

  it('returns true for failed state', () => {
    const task = makeTask({ id: 'T-1' })
    const result = isFocusTask(task, 'failed', [])
    expect(result).toBe(true)
  })

  it('returns true for idle state (included in defaults)', () => {
    const task = makeTask({ id: 'T-1' })
    const pr = makePr({ id: 1, ticket_id: 'T-1', unaddressed_comment_count: 0 })
    const result = isFocusTask(task, 'idle', [pr])
    expect(result).toBe(true)
  })

  it('returns true when PR has unaddressed comments', () => {
    const task = makeTask({ id: 'T-1' })
    const pr = makePr({ id: 1, ticket_id: 'T-1', unaddressed_comment_count: 2 })
    const result = isFocusTask(task, 'idle', [pr])
    expect(result).toBe(true)
  })

  it('returns true when any PR has unaddressed comments (multiple PRs)', () => {
    const task = makeTask({ id: 'T-1' })
    const pr1 = makePr({ id: 1, ticket_id: 'T-1', unaddressed_comment_count: 0 })
    const pr2 = makePr({ id: 2, ticket_id: 'T-1', unaddressed_comment_count: 1 })
    const result = isFocusTask(task, 'idle', [pr1, pr2])
    expect(result).toBe(true)
  })

  it('returns false for done state even with unaddressed comments', () => {
    const task = makeTask({ id: 'T-1' })
    const pr = makePr({ id: 1, ticket_id: 'T-1', unaddressed_comment_count: 1 })
    const result = isFocusTask(task, 'done', [pr])
    expect(result).toBe(false)
  })

  it('returns false for active state with no unaddressed comments', () => {
    const task = makeTask({ id: 'T-1' })
    const result = isFocusTask(task, 'active', [])
    expect(result).toBe(false)
  })

  it('respects custom focusStates parameter', () => {
    const task = makeTask({ id: 'T-1' })
    expect(isFocusTask(task, 'idle', [], ['idle'])).toBe(true)
    expect(isFocusTask(task, 'idle', [], ['active'])).toBe(false)
  })
})

describe('filterTasks', () => {
  it('filters focus tasks correctly', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', status: 'paused', checkpoint_data: '{}' })],
      ['T-2', makeSession({ id: 's-2', ticket_id: 'T-2', status: 'running' })],
    ])
    const prs = new Map<string, PullRequestInfo[]>()

    const tasks = [
      makeTask({ id: 'T-1' }),
      makeTask({ id: 'T-2' }),
    ]

    const filtered = filterTasks(tasks, 'focus', sessions, prs)
    expect(filtered.map((t: Task) => t.id)).toEqual(['T-1'])
  })

  it('filters in-progress tasks (excludes backlog and focus tasks)', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', status: 'running' })],
      ['T-2', makeSession({ id: 's-2', ticket_id: 'T-2', status: 'paused', checkpoint_data: '{}' })],
    ])
    const prs = new Map<string, PullRequestInfo[]>()

    const tasks = [
      makeTask({ id: 'T-1', status: 'doing' }),
      makeTask({ id: 'T-2', status: 'doing' }),
      makeTask({ id: 'T-3', status: 'done' }),
      makeTask({ id: 'T-4', status: 'backlog' }),
    ]

    const filtered = filterTasks(tasks, 'in-progress', sessions, prs)
    expect(filtered.map((t: Task) => t.id)).toEqual(['T-1'])
  })

  it('filters backlog tasks (status === backlog)', () => {
    const sessions = new Map<string, AgentSession>()
    const prs = new Map<string, PullRequestInfo[]>()

    const tasks = [
      makeTask({ id: 'T-1', status: 'doing' }),
      makeTask({ id: 'T-2', status: 'backlog' }),
      makeTask({ id: 'T-3', status: 'backlog' }),
    ]

    const filtered = filterTasks(tasks, 'backlog', sessions, prs)
    expect(filtered.map((t: Task) => t.id)).toEqual(['T-2', 'T-3'])
  })

  it('returns empty array for empty task list', () => {
    const sessions = new Map<string, AgentSession>()
    const prs = new Map<string, PullRequestInfo[]>()

    const filtered = filterTasks([], 'focus', sessions, prs)
    expect(filtered).toEqual([])
  })

  it('focus filter includes tasks with unaddressed PR comments', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', status: 'running' })],
    ])
    const prs = new Map<string, PullRequestInfo[]>([
      ['T-1', [makePr({ id: 1, ticket_id: 'T-1', unaddressed_comment_count: 1 })]],
    ])

    const tasks = [makeTask({ id: 'T-1' })]

    const filtered = filterTasks(tasks, 'focus', sessions, prs)
    expect(filtered.map((t: Task) => t.id)).toEqual(['T-1'])
  })

  it('does not mutate original array', () => {
    const sessions = new Map<string, AgentSession>()
    const prs = new Map<string, PullRequestInfo[]>()
    const tasks = [makeTask({ id: 'T-1' })]

    const filtered = filterTasks(tasks, 'focus', sessions, prs)
    expect(filtered).not.toBe(tasks as Task[])
  })
})

describe('getFilterCounts', () => {
  it('returns correct counts for all filters', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', status: 'paused', checkpoint_data: '{}' })],
      ['T-2', makeSession({ id: 's-2', ticket_id: 'T-2', status: 'running' })],
    ])
    const prs = new Map<string, PullRequestInfo[]>()

    const tasks = [
      makeTask({ id: 'T-1' }),
      makeTask({ id: 'T-2' }),
      makeTask({ id: 'T-3', status: 'backlog' }),
    ]

    const counts = getFilterCounts(tasks, sessions, prs)
    expect(counts).toEqual({
      focus: 1,
      'in-progress': 1,
      backlog: 1,
    })
  })

  it('returns zero counts for empty task list', () => {
    const sessions = new Map<string, AgentSession>()
    const prs = new Map<string, PullRequestInfo[]>()

    const counts = getFilterCounts([], sessions, prs)
    expect(counts).toEqual({
      focus: 0,
      'in-progress': 0,
      backlog: 0,
    })
  })

  it('counts backlog tasks correctly', () => {
    const sessions = new Map<string, AgentSession>()
    const prs = new Map<string, PullRequestInfo[]>()

    const tasks = [
      makeTask({ id: 'T-1', status: 'backlog' }),
      makeTask({ id: 'T-2', status: 'backlog' }),
    ]

    const counts = getFilterCounts(tasks, sessions, prs)
    expect(counts).toEqual({
      focus: 0,
      'in-progress': 0,
      backlog: 2,
    })
  })

  it('counts tasks with unaddressed PR comments as focus', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', status: 'running' })],
    ])
    const prs = new Map<string, PullRequestInfo[]>([
      ['T-1', [makePr({ id: 1, ticket_id: 'T-1', unaddressed_comment_count: 2 })]],
    ])

    const tasks = [makeTask({ id: 'T-1' })]

    const counts = getFilterCounts(tasks, sessions, prs)
    expect(counts.focus).toBe(1)
  })

  it('handles tasks with no sessions', () => {
    const sessions = new Map<string, AgentSession>()
    const prs = new Map<string, PullRequestInfo[]>()

    const tasks = [
      makeTask({ id: 'T-1', status: 'doing' }),
      makeTask({ id: 'T-2', status: 'backlog' }),
    ]

    const counts = getFilterCounts(tasks, sessions, prs)
    expect(counts).toEqual({
      focus: 1,
      'in-progress': 0,
      backlog: 1,
    })
  })
})

describe('loadFocusFilterStates', () => {
  it('returns DEFAULT_FOCUS_STATES when no config stored', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    const result = await loadFocusFilterStates('proj-1')
    expect(result).toEqual(DEFAULT_FOCUS_STATES)
  })

  it('returns parsed states when valid config stored', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify(['idle', 'active']))
    const result = await loadFocusFilterStates('proj-1')
    expect(result).toEqual(['idle', 'active'])
  })

  it('returns defaults when invalid JSON stored', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue('not-json')
    const result = await loadFocusFilterStates('proj-1')
    expect(result).toEqual(DEFAULT_FOCUS_STATES)
  })
})

describe('saveFocusFilterStates', () => {
  it('calls setProjectConfig with serialized states', async () => {
    vi.mocked(setProjectConfig).mockResolvedValue(undefined)
    await saveFocusFilterStates('proj-1', ['idle', 'active'])
    expect(setProjectConfig).toHaveBeenCalledWith('proj-1', 'focus_filter_states', JSON.stringify(['idle', 'active']))
  })
})

describe('DEFAULT_FOCUS_STATES', () => {
  it('includes unaddressed-comments', () => {
    expect(DEFAULT_FOCUS_STATES).toContain('unaddressed-comments')
  })
})
