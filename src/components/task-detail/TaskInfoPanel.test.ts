import { render, screen, fireEvent } from '@testing-library/svelte'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import { requireElement } from '../../test-utils/dom'
import TaskInfoPanel from './TaskInfoPanel.svelte'
import type { Task, PullRequestInfo } from '../../lib/types'
import { ticketPrs } from '../../lib/stores'
import { forceGithubSync, getPullRequests, mergePullRequest } from '../../lib/ipc'

vi.mock('../../lib/stores', () => ({
  ticketPrs: writable(new Map()),
}))

vi.mock('../../lib/ipc', () => ({
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

  it('renders Initial Prompt section with task initial_prompt', () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    expect(screen.getByText('// INITIAL_PROMPT')).toBeTruthy()
    expect(screen.getByText('Implement auth middleware')).toBeTruthy()
    expect(screen.queryByText('Build the auth middleware implementation with JWT support')).toBeNull()
  })

  it('renders prompt as read-only text (no input elements in prompt section)', () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    const promptSection = screen.getByLabelText('Initial Prompt').closest('section')
    expect(promptSection?.querySelector('input')).toBeNull()
    expect(promptSection?.querySelector('textarea')).toBeNull()
  })

  it('renders // SUMMARY label', () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    expect(screen.getByText('// SUMMARY')).toBeTruthy()
  })

  it('renders "No summary yet" in muted text when summary is null', () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    expect(screen.getByText('No summary yet')).toBeTruthy()
  })

  it('renders summary content when summary is present', () => {
    const taskWithSummary = { ...baseTask, summary: 'Implemented JWT auth with refresh token support.' }
    render(TaskInfoPanel, { props: { task: taskWithSummary, workspacePath: null } })
    expect(screen.getByText('Implemented JWT auth with refresh token support.')).toBeTruthy()
    expect(screen.queryByText('No summary yet')).toBeNull()
  })

  it('renders literal \\n in summary as actual line breaks', () => {
    const taskWithNewlines = { ...baseTask, summary: 'Added feature.\\n\\nChanges:\\n- New file added' }
    render(TaskInfoPanel, { props: { task: taskWithNewlines, workspacePath: null } })
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
    render(TaskInfoPanel, { props: { task: taskWithSummary, workspacePath: null } })
    const summarySection = screen.getByLabelText('Summary').closest('section')
    expect(summarySection?.querySelector('input')).toBeNull()
    expect(summarySection?.querySelector('textarea')).toBeNull()
  })

  it('does not show Edit Task or Delete buttons', () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
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

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

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

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

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

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByText('Draft')).toBeNull()
  })

  it('renders workspace path section when workspacePath is provided', () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: '/home/user/worktrees/T-42' } })
    expect(screen.getByText('// WORKSPACE')).toBeTruthy()
    expect(screen.getByText('/home/user/worktrees/T-42')).toBeTruthy()
  })

  it('does not render workspace section when workspacePath is null', () => {
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    expect(screen.queryByText('// WORKSPACE')).toBeNull()
  })

  it('renders Merge button when PR is ready to merge', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

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

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

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

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

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

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

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

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

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

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

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

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

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

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    const mergeButton = requireElement(await screen.findByRole('button', { name: 'Merging...' }), HTMLButtonElement)
    expect(mergeButton.disabled).toBe(true)
    resolveMerge?.()
  })

  it('disables other merge buttons while a merge is in progress for the same task', async () => {
    const firstReadyPr = createPullRequest({
      id: 42,
      title: 'First PR',
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })
    const secondReadyPr = createPullRequest({
      id: 99,
      title: 'Second PR',
      url: 'https://github.com/owner/repo/pull/99',
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    let resolveMerge: (() => void) | undefined
    vi.mocked(mergePullRequest).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveMerge = resolve
    }))
    ticketPrs.set(new Map([['T-42', [firstReadyPr, secondReadyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    const [firstMergeButton] = await screen.findAllByRole('button', { name: 'Merge' })
    await fireEvent.click(firstMergeButton)

    const mergingButton = requireElement(await screen.findByRole('button', { name: 'Merging...' }), HTMLButtonElement)
    const remainingMergeButton = requireElement(screen.getByRole('button', { name: 'Merge' }), HTMLButtonElement)

    expect(mergingButton.disabled).toBe(true)
    expect(remainingMergeButton.disabled).toBe(true)
    expect(mergePullRequest).toHaveBeenCalledTimes(1)

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

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

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

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    expect(getPullRequests).toHaveBeenCalled()
    expect(await screen.findByText(/Merged on/)).toBeTruthy()
  })

  it('does not overwrite Task B PR data when task prop changes during merge async chain', async () => {
    const taskA = baseTask
    const taskB: Task = { ...baseTask, id: 'T-99' }

    const prA = createPullRequest({
      id: 42,
      ticket_id: 'T-42',
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })
    const prB = createPullRequest({
      id: 99,
      ticket_id: 'T-99',
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    ticketPrs.set(new Map([['T-42', [prA]], ['T-99', [prB]]]))

    const mergedPrA = { ...prA, state: 'merged' as const, merged_at: 3000 }
    const prBWithNullMergeability = { ...prB, mergeable_state: null, mergeable: null }
    vi.mocked(getPullRequests).mockResolvedValue([mergedPrA, prBWithNullMergeability])

    let resolveMerge!: () => void
    vi.mocked(mergePullRequest).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveMerge = resolve })
    )

    const { rerender } = render(TaskInfoPanel, { props: { task: taskA, workspacePath: null } })

    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    await rerender({ task: taskB, workspacePath: null })

    resolveMerge()
    await new Promise((r) => setTimeout(r, 50))

    let taskBPrs: PullRequestInfo[] = []
    ticketPrs.subscribe((map) => { taskBPrs = map.get('T-99') ?? [] })()
    expect(taskBPrs).toHaveLength(1)
    expect(taskBPrs[0].id).toBe(99)
    expect(taskBPrs[0].mergeable_state).toBe('clean')
  })

  it('preserves same-task PR updates that arrive while another merge is in flight', async () => {
    const mergingPr = createPullRequest({
      id: 42,
      title: 'First PR',
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })
    const siblingPr = createPullRequest({
      id: 99,
      title: 'Second PR',
      url: 'https://github.com/owner/repo/pull/99',
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })
    const siblingPrUpdatedDuringMerge = {
      ...siblingPr,
      mergeable: false,
      mergeable_state: 'dirty' as const,
    }

    ticketPrs.set(new Map([['T-42', [mergingPr, siblingPr]]]))

    let resolveMerge!: () => void
    vi.mocked(mergePullRequest).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveMerge = resolve })
    )
    vi.mocked(forceGithubSync).mockResolvedValueOnce({
      new_comments: 0,
      ci_changes: 0,
      review_changes: 0,
      pr_changes: 0,
      errors: 1,
      rate_limited: false,
      rate_limit_reset_at: null,
    })

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    const [firstMergeButton] = await screen.findAllByRole('button', { name: 'Merge' })
    await fireEvent.click(firstMergeButton)

    ticketPrs.set(new Map([['T-42', [mergingPr, siblingPrUpdatedDuringMerge]]]))

    resolveMerge()
    await screen.findByText(/GitHub sync reported errors after merge/)

    let taskPrsForTask: PullRequestInfo[] = []
    ticketPrs.subscribe((map) => { taskPrsForTask = map.get('T-42') ?? [] })()
    expect(taskPrsForTask).toHaveLength(2)
    expect(taskPrsForTask[0].id).toBe(42)
    expect(taskPrsForTask[0].state).toBe('merged')
    expect(taskPrsForTask[1].id).toBe(99)
    expect(taskPrsForTask[1].mergeable_state).toBe('dirty')
    expect(taskPrsForTask[1].mergeable).toBe(false)
  })

  it('shows warning when forceGithubSync reports errors after merge', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    vi.mocked(forceGithubSync).mockResolvedValueOnce({
      new_comments: 0,
      ci_changes: 0,
      review_changes: 0,
      pr_changes: 0,
      errors: 1,
      rate_limited: false,
      rate_limit_reset_at: null,
    })
    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    expect(await screen.findByText(/GitHub sync reported errors after merge/)).toBeTruthy()
    expect(getPullRequests).not.toHaveBeenCalled()
  })

  it('shows rate-limit warning when forceGithubSync is rate limited after merge', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    vi.mocked(forceGithubSync).mockResolvedValueOnce({
      new_comments: 0,
      ci_changes: 0,
      review_changes: 0,
      pr_changes: 0,
      errors: 0,
      rate_limited: true,
      rate_limit_reset_at: 9999999,
    })
    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    expect(await screen.findByText(/GitHub sync was rate limited after merge/)).toBeTruthy()
    expect(getPullRequests).not.toHaveBeenCalled()
  })

  it('shows warning when forceGithubSync throws after merge', async () => {
    const readyPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: true,
      mergeable_state: 'clean',
    })

    vi.mocked(forceGithubSync).mockRejectedValueOnce(new Error('network timeout'))
    ticketPrs.set(new Map([['T-42', [readyPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))

    expect(await screen.findByText(/Pull request merged, but refresh failed: network timeout/)).toBeTruthy()
    expect(getPullRequests).not.toHaveBeenCalled()
  })

  it('does not show Merge button when PR has transient null mergeable_state', async () => {
    const transientPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: null,
      mergeable_state: null,
    })

    ticketPrs.set(new Map([['T-42', [transientPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    expect(screen.queryByText(/Ready to Merge/)).toBeNull()
  })

  it('does not show Merge button when PR has unknown mergeable_state', async () => {
    const unknownPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: null,
      mergeable_state: 'unknown',
    })

    ticketPrs.set(new Map([['T-42', [unknownPr]]]))

    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    expect(screen.queryByText(/Ready to Merge/)).toBeNull()
  })

  it('shows Merge button again once GitHub resolves transient null to clean', async () => {
    const transientPr = createPullRequest({
      ci_status: 'success',
      review_status: 'approved',
      mergeable: null,
      mergeable_state: null,
    })
    const resolvedPr = { ...transientPr, mergeable: true, mergeable_state: 'clean' }

    ticketPrs.set(new Map([['T-42', [transientPr]]]))

    const { unmount } = render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    unmount()

    ticketPrs.set(new Map([['T-42', [resolvedPr]]]))
    render(TaskInfoPanel, { props: { task: baseTask, workspacePath: null } })
    await screen.findByRole('button', { name: 'Merge' })
  })
})
