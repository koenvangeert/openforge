import { describe, it, expect } from 'vitest'
import { computeCreatureState, computeCreatureRoom } from './creatureState'
import type { Task, AgentSession, PullRequestInfo } from './types'

const makeTask = (id: string, status: string): Task => ({
  id,
  initial_prompt: `Task ${id}`,
  status,
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

const makePr = (overrides: Partial<PullRequestInfo> = {}): PullRequestInfo => ({
  id: 1,
  ticket_id: 'T-1',
  repo_owner: 'acme',
  repo_name: 'repo',
  title: 'Fix bug',
  url: 'https://github.com/acme/repo/pull/1',
  state: 'open',
  head_sha: 'abc123',
  ci_status: null,
  ci_check_runs: null,
  review_status: null,
  merged_at: null,
  created_at: 1000,
  updated_at: 2000,
  draft: false,
  unaddressed_comment_count: 0,
  ...overrides,
})

describe('computeCreatureState', () => {
  it('returns egg when task status is backlog (no session)', () => {
    const task = makeTask('T-1', 'backlog')
    const result = computeCreatureState(task, null, [])
    expect(result).toBe('egg')
  })

  it('returns egg when task status is backlog (with session)', () => {
    const task = makeTask('T-1', 'backlog')
    const session = makeSession('T-1', 'running')
    const result = computeCreatureState(task, session, [])
    expect(result).toBe('egg')
  })

  it('returns idle when task status is doing and session is null', () => {
    const task = makeTask('T-1', 'doing')
    const result = computeCreatureState(task, null, [])
    expect(result).toBe('idle')
  })

  it('returns active when task status is doing and session status is running', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'running')
    const result = computeCreatureState(task, session, [])
    expect(result).toBe('active')
  })

  it('returns needs-input when task status is doing and session is paused with checkpoint data', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'paused', '{"question":"approve?"}')
    const result = computeCreatureState(task, session, [])
    expect(result).toBe('needs-input')
  })

  it('returns resting when task status is doing and session is paused without checkpoint data', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'paused', null)
    const result = computeCreatureState(task, session, [])
    expect(result).toBe('resting')
  })

  it('returns celebrating when session completed and no PR', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'completed')
    const result = computeCreatureState(task, session, [])
    expect(result).toBe('celebrating')
  })

  it('returns sad when task status is doing and session status is failed', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'failed')
    const result = computeCreatureState(task, session, [])
    expect(result).toBe('sad')
  })

  it('returns frozen when task status is doing and session status is interrupted', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'interrupted')
    const result = computeCreatureState(task, session, [])
    expect(result).toBe('frozen')
  })

  it('returns done when task status is done', () => {
    const task = makeTask('T-1', 'done')
    const result = computeCreatureState(task, null, [])
    expect(result).toBe('done')
  })

  it('returns done when task status is done with session', () => {
    const task = makeTask('T-1', 'done')
    const session = makeSession('T-1', 'running')
    const result = computeCreatureState(task, session, [])
    expect(result).toBe('done')
  })

  it('returns done when task status is done with PRs', () => {
    const task = makeTask('T-1', 'done')
    const prs = [makePr({ ci_status: 'failure' })]
    const result = computeCreatureState(task, null, prs)
    expect(result).toBe('done')
  })

  it('returns idle as fallback for unknown session status', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'unknown-status')
    const result = computeCreatureState(task, session, [])
    expect(result).toBe('idle')
  })

  // --- PR-based state tests ---

  it('returns ci-failed when session completed and PR has ci_status=failure', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'completed')
    const prs = [makePr({ ci_status: 'failure' })]
    expect(computeCreatureState(task, session, prs)).toBe('ci-failed')
  })

  it('returns ci-failed when no session and PR has ci_status=failure', () => {
    const task = makeTask('T-1', 'doing')
    const prs = [makePr({ ci_status: 'failure' })]
    expect(computeCreatureState(task, null, prs)).toBe('ci-failed')
  })

  it('returns changes-requested when PR has review_status=changes_requested', () => {
    const task = makeTask('T-1', 'doing')
    const prs = [makePr({ review_status: 'changes_requested' })]
    expect(computeCreatureState(task, null, prs)).toBe('changes-requested')
  })

  it('returns ready-to-merge when PR has ci_status=success and review_status=approved', () => {
    const task = makeTask('T-1', 'doing')
    const prs = [makePr({ ci_status: 'success', review_status: 'approved' })]
    expect(computeCreatureState(task, null, prs)).toBe('ready-to-merge')
  })

  it('returns pr-draft when PR is draft', () => {
    const task = makeTask('T-1', 'doing')
    const prs = [makePr({ draft: true })]
    expect(computeCreatureState(task, null, prs)).toBe('pr-draft')
  })

  it('returns pr-open when PR is open and not draft and CI not failed', () => {
    const task = makeTask('T-1', 'doing')
    const prs = [makePr()]
    expect(computeCreatureState(task, null, prs)).toBe('pr-open')
  })

  it('returns pr-merged when PR state is merged', () => {
    const task = makeTask('T-1', 'doing')
    const prs = [makePr({ state: 'merged', merged_at: 3000 })]
    expect(computeCreatureState(task, null, prs)).toBe('pr-merged')
  })

  // --- Priority tests ---

  it('active agent wins over ci-failed PR', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'running')
    const prs = [makePr({ ci_status: 'failure' })]
    expect(computeCreatureState(task, session, prs)).toBe('active')
  })

  it('ci-failed beats pr-open', () => {
    const task = makeTask('T-1', 'doing')
    const prs = [makePr({ ci_status: 'failure' })]
    expect(computeCreatureState(task, null, prs)).toBe('ci-failed')
  })

  it('changes-requested beats pr-open', () => {
    const task = makeTask('T-1', 'doing')
    const prs = [makePr({ review_status: 'changes_requested' })]
    expect(computeCreatureState(task, null, prs)).toBe('changes-requested')
  })

  it('ci-failed beats changes-requested', () => {
    const task = makeTask('T-1', 'doing')
    const prs = [makePr({ ci_status: 'failure', review_status: 'changes_requested' })]
    expect(computeCreatureState(task, null, prs)).toBe('ci-failed')
  })

  it('session failed wins over PR states', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'failed')
    const prs = [makePr({ ci_status: 'failure' })]
    expect(computeCreatureState(task, session, prs)).toBe('sad')
  })

  it('session paused wins over PR states', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'paused')
    const prs = [makePr({ ci_status: 'failure' })]
    expect(computeCreatureState(task, session, prs)).toBe('resting')
  })

  it('pr-merged shown when session completed and PR merged', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'completed')
    const prs = [makePr({ state: 'merged', merged_at: 3000 })]
    expect(computeCreatureState(task, session, prs)).toBe('pr-merged')
  })

  it('uses most relevant open PR when multiple PRs exist', () => {
    const task = makeTask('T-1', 'doing')
    const prs = [
      makePr({ id: 1, state: 'closed' }),
      makePr({ id: 2, state: 'open', ci_status: 'failure' }),
    ]
    expect(computeCreatureState(task, null, prs)).toBe('ci-failed')
  })
})

describe('computeCreatureRoom', () => {
  it('returns nursery when task status is backlog (no session)', () => {
    const task = makeTask('T-1', 'backlog')
    const result = computeCreatureRoom(task, null, [])
    expect(result).toBe('nursery')
  })

  it('returns nursery when task status is backlog (with session)', () => {
    const task = makeTask('T-1', 'backlog')
    const session = makeSession('T-1', 'running')
    const result = computeCreatureRoom(task, session, [])
    expect(result).toBe('nursery')
  })

  it('returns forge when task status is doing and session is null (idle)', () => {
    const task = makeTask('T-1', 'doing')
    const result = computeCreatureRoom(task, null, [])
    expect(result).toBe('forge')
  })

  it('returns forge when task status is doing and session status is running', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'running')
    const result = computeCreatureRoom(task, session, [])
    expect(result).toBe('forge')
  })

  it('returns forge when task status is doing and session status is completed', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'completed')
    const result = computeCreatureRoom(task, session, [])
    expect(result).toBe('forge')
  })

  it('returns warRoom when task status is doing and session is paused with checkpoint', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'paused', '{"question":"approve?"}')
    const result = computeCreatureRoom(task, session, [])
    expect(result).toBe('warRoom')
  })

  it('returns warRoom when task status is doing and session is paused without checkpoint', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'paused', null)
    const result = computeCreatureRoom(task, session, [])
    expect(result).toBe('warRoom')
  })

  it('returns warRoom when task status is doing and session status is failed', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'failed')
    const result = computeCreatureRoom(task, session, [])
    expect(result).toBe('warRoom')
  })

  it('returns warRoom when task status is doing and session status is interrupted', () => {
    const task = makeTask('T-1', 'doing')
    const session = makeSession('T-1', 'interrupted')
    const result = computeCreatureRoom(task, session, [])
    expect(result).toBe('warRoom')
  })

  it('returns forge as fallback for unknown task status', () => {
    const task = makeTask('T-1', 'done')
    const result = computeCreatureRoom(task, null, [])
    expect(result).toBe('forge')
  })

  // --- PR-based room tests ---

  it('returns warRoom for ci-failed state', () => {
    const task = makeTask('T-1', 'doing')
    const prs = [makePr({ ci_status: 'failure' })]
    expect(computeCreatureRoom(task, null, prs)).toBe('warRoom')
  })

  it('returns warRoom for changes-requested state', () => {
    const task = makeTask('T-1', 'doing')
    const prs = [makePr({ review_status: 'changes_requested' })]
    expect(computeCreatureRoom(task, null, prs)).toBe('warRoom')
  })

  it('returns forge for pr-open state', () => {
    const task = makeTask('T-1', 'doing')
    const prs = [makePr()]
    expect(computeCreatureRoom(task, null, prs)).toBe('forge')
  })

  it('returns forge for pr-draft state', () => {
    const task = makeTask('T-1', 'doing')
    const prs = [makePr({ draft: true })]
    expect(computeCreatureRoom(task, null, prs)).toBe('forge')
  })

  it('returns forge for ready-to-merge state', () => {
    const task = makeTask('T-1', 'doing')
    const prs = [makePr({ ci_status: 'success', review_status: 'approved' })]
    expect(computeCreatureRoom(task, null, prs)).toBe('forge')
  })

  it('returns forge for pr-merged state', () => {
    const task = makeTask('T-1', 'doing')
    const prs = [makePr({ state: 'merged', merged_at: 3000 })]
    expect(computeCreatureRoom(task, null, prs)).toBe('forge')
  })
})
