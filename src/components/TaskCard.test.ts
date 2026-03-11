import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import TaskCard from './TaskCard.svelte'
import type { Task, AgentSession, PullRequestInfo } from '../lib/types'

const baseTask: Task = {
  id: 'T-42',
  initial_prompt: 'Implement auth middleware',
  status: 'backlog',
  jira_key: 'PROJ-123',
  jira_title: 'Add JWT authentication to REST API',
  jira_status: 'To Do',
  jira_assignee: 'Alice',
  jira_description: null,
  prompt: null,
  summary: null,
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
  merged_at: null,
  created_at: 1000,
  updated_at: 2000,
  draft: false,
  unaddressed_comment_count: 0,
}

describe('TaskCard', () => {
  it('renders task id and title', () => {
    render(TaskCard, { props: { task: baseTask } })
    expect(screen.getByText('T-42')).toBeTruthy()
    expect(screen.getByText('Implement auth middleware')).toBeTruthy()
  })

  it('renders JIRA badge when jira_key is present', () => {
    render(TaskCard, { props: { task: baseTask } })
    expect(screen.getByText('PROJ-123')).toBeTruthy()
  })

  it('hides JIRA badge when jira_key is null', () => {
    const taskWithoutJira = { ...baseTask, jira_key: null }
    render(TaskCard, { props: { task: taskWithoutJira } })
    expect(screen.queryByText('PROJ-123')).toBeNull()
  })

  it('renders jira_title when present', () => {
    render(TaskCard, { props: { task: baseTask } })
    expect(screen.getByText('// Add JWT authentication to REST API')).toBeTruthy()
  })

  it('hides jira_title when null', () => {
    const taskWithoutJiraTitle = { ...baseTask, jira_title: null }
    render(TaskCard, { props: { task: taskWithoutJiraTitle } })
    expect(screen.queryByText('// Add JWT authentication to REST API')).toBeNull()
  })

  it('renders jira_assignee', () => {
    render(TaskCard, { props: { task: baseTask } })
    expect(screen.getByText('@Alice')).toBeTruthy()
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

  it('renders CI status text for success', () => {
    const pr = { ...basePr, ci_status: 'success' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr] } })
    expect(screen.getByText('Passed')).toBeTruthy()
  })

  it('no CI text when ci_status is null', () => {
    render(TaskCard, { props: { task: baseTask, pullRequests: [basePr] } })
    expect(screen.queryByText('Passed')).toBeNull()
    expect(screen.queryByText('Failed')).toBeNull()
    expect(screen.queryByText('Pending')).toBeNull()
  })

  it('renders CI status text for failure', () => {
    const pr = { ...basePr, ci_status: 'failure' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr] } })
    expect(screen.getByText('Failed')).toBeTruthy()
  })

  it('renders CI status text for pending', () => {
    const pr = { ...basePr, ci_status: 'pending' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr] } })
    expect(screen.getByText('Pending')).toBeTruthy()
  })

  it('renders review status text for approved', () => {
    const pr = { ...basePr, review_status: 'approved' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr] } })
    expect(screen.getByText('Approved')).toBeTruthy()
  })

  it('renders review status text for changes requested', () => {
    const pr = { ...basePr, review_status: 'changes_requested' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr] } })
    expect(screen.getByText('Changes req.')).toBeTruthy()
  })

  it('renders review status text for review required', () => {
    const pr = { ...basePr, review_status: 'review_required' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr] } })
    expect(screen.getByText('Needs review')).toBeTruthy()
  })

  it('no review text when review_status is null', () => {
    render(TaskCard, { props: { task: baseTask, pullRequests: [basePr] } })
    expect(screen.queryByText('Approved')).toBeNull()
    expect(screen.queryByText('Changes req.')).toBeNull()
    expect(screen.queryByText('Needs review')).toBeNull()
  })

  it('no review text when PR is closed', () => {
    const pr = { ...basePr, review_status: 'approved', state: 'closed' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr] } })
    expect(screen.queryByText('Approved')).toBeNull()
  })

  it('shows unaddressed comment badge when comments exist', () => {
    const pr = { ...basePr, unaddressed_comment_count: 3 }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr] } })
    expect(screen.getByText('! 3 unaddressed')).toBeTruthy()
  })

  it('hides unaddressed comment badge when count is 0', () => {
    const pr = { ...basePr, unaddressed_comment_count: 0 }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr] } })
    expect(screen.queryByText('unaddressed')).toBeNull()
  })

  it('sums unaddressed counts across multiple PRs', () => {
    const pr1 = { ...basePr, id: 1, unaddressed_comment_count: 2 }
    const pr2 = { ...basePr, id: 2, unaddressed_comment_count: 1 }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr1, pr2] } })
    expect(screen.getByText('! 3 unaddressed')).toBeTruthy()
  })

  it('hides badge when no pull requests', () => {
    render(TaskCard, { props: { task: baseTask } })
    expect(screen.queryByText('unaddressed')).toBeNull()
  })

  it('shows Draft label when PR is draft', () => {
    const pr = { ...basePr, draft: true }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr] } })
    expect(screen.getByText('Draft')).toBeTruthy()
  })

  it('hides Draft label when PR is not draft', () => {
    render(TaskCard, { props: { task: baseTask, pullRequests: [basePr] } })
    expect(screen.queryByText('Draft')).toBeNull()
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
})
