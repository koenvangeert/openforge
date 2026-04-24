import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import TaskCard from './TaskCard.svelte'
import type { Task, AgentSession, PullRequestInfo } from '../../lib/types'

const baseTask: Task = {
  id: 'T-42',
  initial_prompt: 'Implement auth middleware',
  status: 'backlog',
  prompt: null,
  summary: null,
  agent: null,
  permission_mode: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

const basePr: PullRequestInfo = {
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

describe('TaskCard', () => {
  it('renders task id and title', () => {
    render(TaskCard, { props: { task: baseTask } })
    expect(screen.getByText('T-42')).toBeTruthy()
    expect(screen.getByText('Implement auth middleware')).toBeTruthy()
  })

  it('shows running status when session is running', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-42',
      opencode_session_id: null,
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    pi_session_id: null,
    }
    render(TaskCard, { props: { task: baseTask, session } })
    expect(screen.getByText('Running')).toBeTruthy()
  })

  it('shows status badge with Done label when session is completed', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-42',
      opencode_session_id: null,
      stage: 'implement',
      status: 'completed',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    pi_session_id: null,
    }
    render(TaskCard, { props: { task: baseTask, session } })
    expect(screen.getByText('Done')).toBeTruthy()
  })

  it('shows paused status for checkpoint', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-42',
      opencode_session_id: null,
      stage: 'read_ticket',
      status: 'paused',
      checkpoint_data: '{}',
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    pi_session_id: null,
    }
    render(TaskCard, { props: { task: baseTask, session } })
    expect(screen.getByText('Paused')).toBeTruthy()
  })

  it('shows Error badge when session has failed', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-42',
      opencode_session_id: null,
      stage: 'implement',
      status: 'failed',
      checkpoint_data: null,
      error_message: 'Build failed',
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    pi_session_id: null,
    }
    render(TaskCard, { props: { task: baseTask, session } })
    expect(screen.getByText('Error')).toBeTruthy()
  })

  it('shows Stopped badge when session is interrupted', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-42',
      opencode_session_id: null,
      stage: 'implement',
      status: 'interrupted',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    pi_session_id: null,
    }
    render(TaskCard, { props: { task: baseTask, session } })
    expect(screen.getByText('Stopped')).toBeTruthy()
  })

  it('shows needs-input badge when session is paused with checkpoint data', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-42',
      opencode_session_id: null,
      stage: 'implement',
      status: 'paused',
      checkpoint_data: '{"question":"approve?"}',
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    pi_session_id: null,
    }
    render(TaskCard, { props: { task: baseTask, session } })
    expect(screen.getByText('Needs Input')).toBeTruthy()
  })

  it('hides needs-input badge when session is running', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-42',
      opencode_session_id: null,
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    pi_session_id: null,
    }
    render(TaskCard, { props: { task: baseTask, session } })
    expect(screen.queryByText('Needs Input')).toBeNull()
  })

  it('hides needs-input badge when paused without checkpoint data', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-42',
      opencode_session_id: null,
      stage: 'implement',
      status: 'paused',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    pi_session_id: null,
    }
    render(TaskCard, { props: { task: baseTask, session } })
    expect(screen.queryByText('Needs Input')).toBeNull()
  })

  it('hides needs-input badge when no session', () => {
    render(TaskCard, { props: { task: baseTask } })
    expect(screen.queryByText('Needs Input')).toBeNull()
  })

  it('does not show status badge when no session', () => {
    render(TaskCard, { props: { task: baseTask } })
    expect(screen.queryByText('Running')).toBeNull()
    expect(screen.queryByText('Done')).toBeNull()
    expect(screen.queryByText('Paused')).toBeNull()
    expect(screen.queryByText('Error')).toBeNull()
    expect(screen.queryByText('Stopped')).toBeNull()
  })

  it('dispatches select event on click', async () => {
    const onSelect = vi.fn()
    render(TaskCard, { props: { task: baseTask, onSelect } })
    const card = screen.getByRole('button')
    await fireEvent.click(card)
    expect(onSelect).toHaveBeenCalledWith('T-42')
  })

  it('shows summary subtitle when task has summary', () => {
    const taskWithSummary = { ...baseTask, summary: 'Fixed auth bug, needs review' }
    render(TaskCard, { props: { task: taskWithSummary } })
    expect(screen.getByText('Fixed auth bug, needs review')).toBeTruthy()
  })

  it('hides subtitle when summary is null', () => {
    const taskWithoutSummary = { ...baseTask, summary: null }
    render(TaskCard, { props: { task: taskWithoutSummary } })
    expect(screen.queryByText('Fixed auth bug, needs review')).toBeNull()
  })

  it('shows shared task state reason when summary is null', () => {
    const taskWithoutSummary = { ...baseTask, summary: null, status: 'backlog' as const }
    render(TaskCard, { props: { task: taskWithoutSummary } })
    expect(screen.getByText('In backlog — not started yet.')).toBeTruthy()
  })

  it('shows prompt first line as fallback title when title is empty', () => {
    const taskWithPrompt = { ...baseTask, initial_prompt: '', prompt: 'Fix the login bug\nMore details here' }
    render(TaskCard, { props: { task: taskWithPrompt } })
    expect(screen.getByText('Fix the login bug')).toBeTruthy()
  })

  it('shows Starting badge when isStarting is true', () => {
    render(TaskCard, { props: { task: baseTask, isStarting: true } })
    expect(screen.getByText('Starting')).toBeTruthy()
  })

  it('hides Starting badge when isStarting is false', () => {
    render(TaskCard, { props: { task: baseTask, isStarting: false } })
    expect(screen.queryByText('Starting')).toBeNull()
  })

  it('hides Starting badge by default', () => {
    render(TaskCard, { props: { task: baseTask } })
    expect(screen.queryByText('Starting')).toBeNull()
  })

  it('shows Starting badge instead of session status when isStarting is true', () => {
    render(TaskCard, { props: { task: baseTask, isStarting: true, session: null } })
    expect(screen.getByText('Starting')).toBeTruthy()
    expect(screen.queryByText('Running')).toBeNull()
  })

  it('shows last status change time from updated_at', () => {
    const fiveMinutesAgoSeconds = Math.floor(Date.now() / 1000) - 300
    const recentTask = { ...baseTask, updated_at: fiveMinutesAgoSeconds }
    render(TaskCard, { props: { task: recentTask } })
    expect(screen.getByText('5m ago')).toBeTruthy()
  })

  it('shows "just now" for very recent updated_at', () => {
    const justNowSeconds = Math.floor(Date.now() / 1000) - 10
    const recentTask = { ...baseTask, updated_at: justNowSeconds }
    render(TaskCard, { props: { task: recentTask } })
    expect(screen.getByText('just now')).toBeTruthy()
  })

  it('shows CI status chip when isFeatured and PR has CI status', () => {
    const pr = { ...basePr, ci_status: 'success' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: true } })
    expect(screen.getByText('CI Passed')).toBeTruthy()
  })

  it('hides CI status chip when not featured even with PR data', () => {
    const pr = { ...basePr, ci_status: 'success' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: false } })
    expect(screen.queryByText('CI Passed')).toBeNull()
  })

  it('hides CI status chip by default (not featured)', () => {
    const pr = { ...basePr, ci_status: 'success' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr] } })
    expect(screen.queryByText('CI Passed')).toBeNull()
  })

  it('shows CI failure chip when featured', () => {
    const pr = { ...basePr, ci_status: 'failure' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: true } })
    expect(screen.getByText('CI Failed')).toBeTruthy()
  })

  it('shows CI pending chip when featured', () => {
    const pr = { ...basePr, ci_status: 'pending' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: true } })
    expect(screen.getByText('CI Pending')).toBeTruthy()
  })

  it('no CI text when ci_status is null even when featured', () => {
    render(TaskCard, { props: { task: baseTask, pullRequests: [basePr], isFeatured: true } })
    expect(screen.queryByText('CI Passed')).toBeNull()
    expect(screen.queryByText('CI Failed')).toBeNull()
    expect(screen.queryByText('CI Pending')).toBeNull()
  })

  it('shows review status chip when featured', () => {
    const pr = { ...basePr, review_status: 'approved' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: true } })
    expect(screen.getByText('Approved')).toBeTruthy()
  })

  it('hides review status chip when not featured', () => {
    const pr = { ...basePr, review_status: 'approved' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: false } })
    expect(screen.queryByText('Approved')).toBeNull()
  })

  it('shows changes requested chip when featured', () => {
    const pr = { ...basePr, review_status: 'changes_requested' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: true } })
    expect(screen.getByText('Changes Req.')).toBeTruthy()
  })

  it('shows needs review chip when featured', () => {
    const pr = { ...basePr, review_status: 'review_required' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: true } })
    expect(screen.getByText('Needs Review')).toBeTruthy()
  })

  it('no review chip when review_status is null even when featured', () => {
    render(TaskCard, { props: { task: baseTask, pullRequests: [basePr], isFeatured: true } })
    expect(screen.queryByText('Approved')).toBeNull()
    expect(screen.queryByText('Changes Req.')).toBeNull()
    expect(screen.queryByText('Needs Review')).toBeNull()
  })

  it('no review chip when PR is closed even when featured', () => {
    const pr = { ...basePr, review_status: 'approved', state: 'closed' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: true } })
    expect(screen.queryByText('Approved')).toBeNull()
  })

  it('shows unaddressed comment chip when featured and comments exist', () => {
    const pr = { ...basePr, unaddressed_comment_count: 3 }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: true } })
    expect(screen.getByText('3 unaddressed')).toBeTruthy()
  })

  it('hides unaddressed comment chip when not featured', () => {
    const pr = { ...basePr, unaddressed_comment_count: 3 }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: false } })
    expect(screen.queryByText('3 unaddressed')).toBeNull()
  })

  it('hides unaddressed comment chip when featured but count is 0', () => {
    const pr = { ...basePr, unaddressed_comment_count: 0 }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: true } })
    expect(screen.queryByText('unaddressed')).toBeNull()
  })

  it('sums unaddressed counts across multiple PRs when featured', () => {
    const pr1 = { ...basePr, id: 1, unaddressed_comment_count: 2 }
    const pr2 = { ...basePr, id: 2, unaddressed_comment_count: 1 }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr1, pr2], isFeatured: true } })
    expect(screen.getByText('3 unaddressed')).toBeTruthy()
  })

  it('hides unaddressed chip when no pull requests even when featured', () => {
    render(TaskCard, { props: { task: baseTask, isFeatured: true } })
    expect(screen.queryByText('unaddressed')).toBeNull()
  })

  it('shows Draft label when featured and PR is draft', () => {
    const pr = { ...basePr, draft: true }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: true } })
    expect(screen.getByText('Draft')).toBeTruthy()
  })

  it('hides Draft label when not featured', () => {
    const pr = { ...basePr, draft: true }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: false } })
    expect(screen.queryByText('Draft')).toBeNull()
  })

  it('shows Merge Conflict when featured and PR has merge conflicts', () => {
    const pr = { ...basePr, mergeable: false, mergeable_state: 'dirty' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: true } })
    expect(screen.getByText('Merge Conflict')).toBeTruthy()
  })

  it('hides Merge Conflict when not featured', () => {
    const pr = { ...basePr, mergeable: false, mergeable_state: 'dirty' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: false } })
    expect(screen.queryByText('Merge Conflict')).toBeNull()
  })

  it('hides Draft label when featured but PR is not draft', () => {
    render(TaskCard, { props: { task: baseTask, pullRequests: [basePr], isFeatured: true } })
    expect(screen.queryByText('Draft')).toBeNull()
  })

  it('shows PR number as soft chip when featured', () => {
    render(TaskCard, { props: { task: baseTask, pullRequests: [basePr], isFeatured: true } })
    expect(screen.getByText('PR #42')).toBeTruthy()
  })

  it('hides PR number when not featured', () => {
    render(TaskCard, { props: { task: baseTask, pullRequests: [basePr], isFeatured: false } })
    expect(screen.queryByText('PR #42')).toBeNull()
    expect(screen.queryByText('#42')).toBeNull()
  })

  it('expands PR chips on mouse enter and hides on mouse leave', async () => {
    const pr = { ...basePr, review_status: 'approved' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: false } })
    
    expect(screen.queryByText('Approved')).toBeNull()
    expect(screen.queryByText('PR #42')).toBeNull()

    const card = screen.getByRole('button')
    await fireEvent.mouseEnter(card)
    
    expect(screen.getByText('Approved')).toBeTruthy()
    expect(screen.getByText('PR #42')).toBeTruthy()

    await fireEvent.mouseLeave(card)
    
    expect(screen.queryByText('Approved')).toBeNull()
    expect(screen.queryByText('PR #42')).toBeNull()
  })

  it('shows "Queued" chip when PR is queued and mergeable is null', () => {
    const pr: PullRequestInfo = { ...basePr, state: 'open', ci_status: 'success', review_status: 'approved', is_queued: true, mergeable: null, mergeable_state: null }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr], isFeatured: true } })
    expect(screen.getByText('Queued')).toBeTruthy()
  })

  it('shows prompt first line as fallback title when initial_prompt is only whitespace', () => {
    const taskWithPrompt = { ...baseTask, initial_prompt: '   \n   ', prompt: 'Fallback title from prompt' }
    render(TaskCard, { props: { task: taskWithPrompt } })
    expect(screen.getByText('Fallback title from prompt')).toBeTruthy()
  })
})
