import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import TaskMergeStatus from './TaskMergeStatus.svelte'
import type { Task, PullRequestInfo } from '../../lib/types'

vi.mock('../../lib/stores', () => ({
  ticketPrs: writable(new Map()),
  mergingTaskIds: writable(new Set()),
  setTaskMerging: vi.fn(),
}))

const baseTask: Task = {
  id: 'T-42',
  initial_prompt: 'Implement auth middleware',
  status: 'backlog',
  prompt: 'Build the auth middleware implementation with JWT support',
  summary: 'Implemented JWT auth',
  agent: null,
  permission_mode: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

function createPullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 42,
    ticket_id: 'T-42',
    repo_owner: 'owner',
    repo_name: 'repo',
    title: 'Test PR',
    url: 'https://github.com/owner/repo/pull/42',
    state: 'open',
    head_sha: 'abc123',
    ci_status: null,
    ci_check_runs: null,
    review_status: null,
    mergeable: null,
    mergeable_state: null,
    merged_at: null,
    created_at: 1000,
    updated_at: 2000,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    ...overrides,
  }
}

describe('TaskMergeStatus', () => {
  it('renders ready to merge', () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })
    render(TaskMergeStatus, { props: { task: baseTask, taskPrs: [readyPr] } })
    expect(screen.getByText(/Ready to Merge/)).toBeTruthy()
  })
})
