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
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  getWorktreeForTask: vi.fn().mockResolvedValue(null),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

const baseTask: Task = {
  id: 'T-42',
  title: 'Implement auth middleware',
  status: 'backlog',
  jira_key: 'PROJ-123',
  jira_status: 'To Do',
  jira_assignee: 'Alice',
  plan_text: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

describe('TaskInfoPanel', () => {
  it('renders "Task Info" section title', () => {
    render(TaskInfoPanel, { props: { task: baseTask } })
    expect(screen.getByText('Task Info')).toBeTruthy()
  })

  it('renders task status label from COLUMN_LABELS', () => {
    render(TaskInfoPanel, { props: { task: baseTask } })
    const matches = screen.getAllByText('Backlog')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('renders JIRA key when present', () => {
    render(TaskInfoPanel, { props: { task: baseTask } })
    expect(screen.getByText('PROJ-123')).toBeTruthy()
  })

  it('renders JIRA status when present', () => {
    render(TaskInfoPanel, { props: { task: baseTask } })
    expect(screen.getByText('JIRA Status')).toBeTruthy()
  })

  it('renders JIRA assignee when present', () => {
    render(TaskInfoPanel, { props: { task: baseTask } })
    expect(screen.getByText('Alice')).toBeTruthy()
  })

  it('hides JIRA fields when jira_key is null', () => {
    const taskWithoutJira = { ...baseTask, jira_key: null, jira_status: null, jira_assignee: null }
    render(TaskInfoPanel, { props: { task: taskWithoutJira } })
    expect(screen.queryByText('JIRA')).toBeNull()
    expect(screen.queryByText('JIRA Status')).toBeNull()
    expect(screen.queryByText('JIRA Assignee')).toBeNull()
  })

  it('shows Move to Done button when task is not done', () => {
    render(TaskInfoPanel, { props: { task: baseTask } })
    expect(screen.getByText('Move to Done')).toBeTruthy()
  })

  it('hides Move to Done button when task is already done', () => {
    const doneTask = { ...baseTask, status: 'done' }
    render(TaskInfoPanel, { props: { task: doneTask } })
    expect(screen.queryByText('Move to Done')).toBeNull()
  })

  it('does not show Edit Task or Delete buttons', () => {
    render(TaskInfoPanel, { props: { task: baseTask } })
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
      created_at: 1000,
      updated_at: 2000,
    }

    ticketPrs.set(new Map([['T-42', [prWithCi]]]))

    render(TaskInfoPanel, { props: { task: baseTask, onEdit: vi.fn() } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText('Pipeline Status')).toBeTruthy()
  })

})
