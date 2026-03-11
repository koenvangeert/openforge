import { render, screen, fireEvent } from '@testing-library/svelte'
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
  initial_prompt: 'Implement auth middleware',
  status: 'backlog',
  jira_key: 'PROJ-123',
  jira_title: null,
  jira_status: 'To Do',
  jira_assignee: 'Alice',
  jira_description: null,
  prompt: 'Build the auth middleware implementation with JWT support',
  summary: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

describe('TaskInfoPanel', () => {
  it('renders Initial Prompt section with task prompt', () => {
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })
    expect(screen.getByText('// INITIAL_PROMPT')).toBeTruthy()
    expect(screen.getByText('Build the auth middleware implementation with JWT support')).toBeTruthy()
  })

  it('renders prompt as read-only text (no input elements in prompt section)', () => {
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })
    const promptSection = screen.getByLabelText('Initial Prompt').closest('section')
    expect(promptSection?.querySelector('input')).toBeNull()
    expect(promptSection?.querySelector('textarea')).toBeNull()
  })

  it('renders // SUMMARY label', () => {
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })
    expect(screen.getByText('// SUMMARY')).toBeTruthy()
  })

  it('renders "No summary yet" in muted text when summary is null', () => {
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })
    expect(screen.getByText('No summary yet')).toBeTruthy()
  })

  it('renders summary content when summary is present', () => {
    const taskWithSummary = { ...baseTask, summary: 'Implemented JWT auth with refresh token support.' }
    render(TaskInfoPanel, { props: { task: taskWithSummary, worktreePath: null, jiraBaseUrl: '' } })
    expect(screen.getByText('Implemented JWT auth with refresh token support.')).toBeTruthy()
    expect(screen.queryByText('No summary yet')).toBeNull()
  })

  it('renders literal \\n in summary as actual line breaks', () => {
    const taskWithNewlines = { ...baseTask, summary: 'Added feature.\\n\\nChanges:\\n- New file added' }
    render(TaskInfoPanel, { props: { task: taskWithNewlines, worktreePath: null, jiraBaseUrl: '' } })
    const summarySection = screen.getByLabelText('Summary').closest('section')!
    expect(summarySection.textContent).toContain('Added feature.')
    expect(summarySection.textContent).toContain('Changes:')
    expect(summarySection.textContent).toContain('New file added')
    expect(summarySection.textContent).not.toContain('\\n')
  })

  it('renders summary as read-only text (no input elements in summary section)', () => {
    const taskWithSummary = { ...baseTask, summary: 'Done.' }
    render(TaskInfoPanel, { props: { task: taskWithSummary, worktreePath: null, jiraBaseUrl: '' } })
    const summarySection = screen.getByLabelText('Summary').closest('section')
    expect(summarySection?.querySelector('input')).toBeNull()
    expect(summarySection?.querySelector('textarea')).toBeNull()
  })

  it('does not show Edit Task or Delete buttons', () => {
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })
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

    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText('// PIPELINE_STATUS')).toBeTruthy()
  })


  it('renders worktree path section when worktreePath is provided', () => {
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: '/home/user/worktrees/T-42', jiraBaseUrl: '' } })
    expect(screen.getByText('// WORKTREE')).toBeTruthy()
    expect(screen.getByText('/home/user/worktrees/T-42')).toBeTruthy()
  })

  it('does not render worktree section when worktreePath is null', () => {
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })
    expect(screen.queryByText('// WORKTREE')).toBeNull()
  })

  it('renders // JIRA section when task has jira_key and jiraBaseUrl', () => {
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: 'https://jira.example.com' } })
    expect(screen.getByText('// JIRA')).toBeTruthy()
  })

  it('does not render // JIRA section when jira_key is null', () => {
    const taskWithoutJira = { ...baseTask, jira_key: null }
    render(TaskInfoPanel, { props: { task: taskWithoutJira, worktreePath: null, jiraBaseUrl: 'https://jira.example.com' } })
    expect(screen.queryByText('// JIRA')).toBeNull()
  })

  it('renders jira_title in Jira section when available', () => {
    const taskWithJiraTitle = { ...baseTask, jira_title: 'Fix login bug' }
    render(TaskInfoPanel, { props: { task: taskWithJiraTitle, worktreePath: null, jiraBaseUrl: 'https://jira.example.com' } })
    expect(screen.getByText('Fix login bug')).toBeTruthy()
  })

  it('renders Open in Jira button when jiraBaseUrl provided', () => {
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: 'https://jira.example.com' } })
    expect(screen.getByText('Open in Jira ↗')).toBeTruthy()
  })

  it('does not render Open in Jira button when jiraBaseUrl is empty', () => {
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })
    expect(screen.queryByText('Open in Jira ↗')).toBeNull()
  })

  it('calls openUrl with correct Jira URL on click', async () => {
    const { openUrl } = await import('../lib/ipc')
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: 'https://jira.example.com' } })
    const button = screen.getByText('Open in Jira ↗')
    await fireEvent.click(button)
    expect(openUrl).toHaveBeenCalledWith('https://jira.example.com/browse/PROJ-123')
  })
})
