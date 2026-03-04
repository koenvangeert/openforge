import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import TaskInfoPanel from './TaskInfoPanel.svelte'
import type { Task, PullRequestInfo } from '../lib/types'
import { ticketPrs } from '../lib/stores'

vi.mock('../lib/stores', () => ({
  ticketPrs: writable(new Map()),
}))

vi.mock('../lib/ipc', () => ({
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

const baseTask: Task = {
  id: 'T-42',
  title: 'Implement auth middleware',
  status: 'backlog',
  jira_key: 'PROJ-123',
  jira_title: null,
  jira_status: 'To Do',
  jira_assignee: 'Alice',
  jira_description: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

describe('TaskInfoPanel', () => {
  it('renders Initial Prompt section with task title', () => {
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null } })
    expect(screen.getByText('// INITIAL_PROMPT')).toBeTruthy()
    expect(screen.getByText('Implement auth middleware')).toBeTruthy()
  })

  it('does not show Edit Task or Delete buttons', () => {
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null } })
    expect(screen.queryByText('Edit Task')).toBeNull()
    expect(screen.queryByText('Delete')).toBeNull()
  })

  it('renders pipeline status section when PRs have CI data', async () => {
    const prWithCi: PullRequestInfo = {
      id: 42,
      ticket_id: 'T-42',
      repo_owner: 'owner',
      repo_name: 'repo',
      title: 'Test PR',
      url: 'https://github.com/owner/repo/pull/42',
      state: 'open',
      head_sha: 'abc123',
      ci_status: 'failure',
      ci_check_runs: JSON.stringify([
        { id: 1, name: 'build', status: 'completed', conclusion: 'failure', html_url: 'https://example.com' },
        { id: 2, name: 'lint', status: 'completed', conclusion: 'success', html_url: 'https://example.com' }
      ]),
      review_status: null,
      merged_at: null,
      created_at: 1000,
      updated_at: 2000,
      unaddressed_comment_count: 0,
    }

    ticketPrs.set(new Map([['T-42', [prWithCi]]]))

    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText('// PIPELINE_STATUS')).toBeTruthy()
  })


  it('renders worktree path section when worktreePath is provided', () => {
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: '/home/user/worktrees/T-42' } })
    expect(screen.getByText('// WORKTREE')).toBeTruthy()
    expect(screen.getByText('/home/user/worktrees/T-42')).toBeTruthy()
  })

  it('does not render worktree section when worktreePath is null', () => {
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null } })
    expect(screen.queryByText('// WORKTREE')).toBeNull()
  })
})
