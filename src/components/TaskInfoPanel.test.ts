import { render, screen, fireEvent } from '@testing-library/svelte'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import TaskInfoPanel from './TaskInfoPanel.svelte'
import type { Task, PullRequestInfo } from '../lib/types'
import { ticketPrs } from '../lib/stores'
import { getPullRequests, mergePullRequest, openUrl } from '../lib/ipc'

vi.mock('../lib/stores', () => ({
  ticketPrs: writable(new Map()),
}))

vi.mock('../lib/ipc', () => ({
  forceGithubSync: vi.fn().mockResolvedValue({
    new_comments: 0,
    ci_changes: 0,
    review_changes: 0,
    pr_changes: 0,
    errors: 0,
    rate_limited: false,
    rate_limit_reset_at: null,
  }),
  getPullRequests: vi.fn().mockResolvedValue([]),
  mergePullRequest: vi.fn().mockResolvedValue(undefined),
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
  agent: null,
  permission_mode: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

describe('TaskInfoPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ticketPrs.set(new Map())
    vi.mocked(getPullRequests).mockResolvedValue([])
  })

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
    const summarySection = screen.getByLabelText('Summary').closest('section')
    expect(summarySection).not.toBeNull()
    if (!summarySection) {
      throw new Error('Expected Summary section to exist')
    }
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
        mergeable: null,
        mergeable_state: null,
        merged_at: null,
       created_at: 1000,
       updated_at: 2000,
       draft: false,
       is_queued: false,
       unaddressed_comment_count: 0,
     }

    ticketPrs.set(new Map([['T-42', [prWithCi]]]))

    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText('// PIPELINE_STATUS')).toBeTruthy()
  })


   it('renders Draft badge when PR is draft', async () => {
     const draftPr: PullRequestInfo = {
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
       draft: true,
       is_queued: false,
       unaddressed_comment_count: 0,
     }

    ticketPrs.set(new Map([['T-42', [draftPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText('Draft')).toBeTruthy()
  })

   it('hides Draft badge when PR is not draft', async () => {
     const openPr: PullRequestInfo = {
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
     }

    ticketPrs.set(new Map([['T-42', [openPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByText('Draft')).toBeNull()
  })

  it('renders workspace path section when worktreePath is provided', () => {
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: '/home/user/worktrees/T-42', jiraBaseUrl: '' } })
    expect(screen.getByText('// WORKSPACE')).toBeTruthy()
    expect(screen.getByText('/home/user/worktrees/T-42')).toBeTruthy()
  })

  it('does not render workspace section when worktreePath is null', () => {
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })
    expect(screen.queryByText('// WORKSPACE')).toBeNull()
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
    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: 'https://jira.example.com' } })
    const button = screen.getByText('Open in Jira ↗')
    await fireEvent.click(button)
    expect(openUrl).toHaveBeenCalledWith('https://jira.example.com/browse/PROJ-123')
  })

  it('renders Merge button when PR is ready to merge', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })

    await screen.findByRole('button', { name: 'Merge' })
    expect(screen.getByText(/Ready to Merge/)).toBeTruthy()
  })

  it('renders Merge button when PR requires no review and is mergeable', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'none',
      mergeable: true,
      mergeable_state: 'clean',
    })

    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })

    await screen.findByRole('button', { name: 'Merge' })
    expect(screen.getByText(/Ready to Merge/)).toBeTruthy()
  })

  it('renders Merge button when GitHub reports the PR as mergeable even if review is still required', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'review_required',
      mergeable: true,
      mergeable_state: 'clean',
    })

    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })

    await screen.findByRole('button', { name: 'Merge' })
    expect(screen.getByText(/Ready to Merge/)).toBeTruthy()
  })

  it('does not render Merge button when PR is queued for merge', async () => {
    const queuedPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
      is_queued: true,
    })

    ticketPrs.set(new Map([['T-42', [queuedPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    expect(screen.getByText(/In Merge Queue/)).toBeTruthy()
  })

  it('shows "In Merge Queue" badge when PR is queued with mergeable null (not hidden)', async () => {
    const queuedPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: null,
      mergeable_state: null,
      is_queued: true,
    })

    ticketPrs.set(new Map([['T-42', [queuedPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText(/In Merge Queue/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
  })

  it('renders Merge Conflict indicator when PR has conflicts', async () => {
    const conflictedPr = createPullRequest({
      mergeable: false,
      mergeable_state: 'dirty',
    })

    ticketPrs.set(new Map([['T-42', [conflictedPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText('Merge Conflict')).toBeTruthy()
  })

  it('calls mergePullRequest with repo coordinates when Merge is clicked', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    ticketPrs.set(new Map([['T-42', [readyPr]]]))
    vi.mocked(getPullRequests).mockResolvedValue([readyPr])

    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })

    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    expect(mergePullRequest).toHaveBeenCalledWith('owner', 'repo', 42)
  })

  it('shows loading state while merging', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    let resolveMerge: (() => void) | undefined
    vi.mocked(mergePullRequest).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveMerge = resolve
    }))
    ticketPrs.set(new Map([['T-42', [readyPr]]]))
    vi.mocked(getPullRequests).mockResolvedValue([readyPr])

    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })

    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    const mergeButton = await screen.findByRole('button', { name: 'Merging...' })
    expect((mergeButton as HTMLButtonElement).disabled).toBe(true)
    resolveMerge?.()
  })

  it('shows an inline error when merge fails', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    vi.mocked(mergePullRequest).mockRejectedValueOnce(new Error('merge blocked by branch protection'))
    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })

    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    expect(await screen.findByText('merge blocked by branch protection')).toBeTruthy()
  })

  it('refreshes task pull requests after a successful merge', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })
    const mergedPr = { ...readyPr, state: 'merged', merged_at: 3000 }

    ticketPrs.set(new Map([['T-42', [readyPr]]]))
    vi.mocked(getPullRequests).mockResolvedValue([mergedPr])

    render(TaskInfoPanel, { props: { task: baseTask, worktreePath: null, jiraBaseUrl: '' } })

    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    expect(getPullRequests).toHaveBeenCalled()
    expect(await screen.findByText(/Merged on/)).toBeTruthy()
  })
})
