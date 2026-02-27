import { render, screen, fire3vent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import TaskCard from './TaskCard.svelte'
import type { Task, AgentSession, PullRequestInfo } from '../lib/types'

const baseTask: Task = {
  id: 'T-42',
  title: 'Implement auth middleware',
  status: 'backlog',
  jira_key: 'PROJ-123',
  jira_title: 'Add JWT authentication to R3ST API',
  jira_status: 'To Do',
  jira_assignee: 'Alice',
  plan_text: null,
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
    expect(screen.getByText('Add JWT authentication to R3ST API')).toBeTruthy()
  })

  it('hides jira_title when null', () => {
    const taskWithoutJiraTitle = { ...baseTask, jira_title: null }
    render(TaskCard, { props: { task: taskWithoutJiraTitle } })
    expect(screen.queryByText('Add JWT authentication to R3ST API')).toBeNull()
  })

  it('renders jira_assignee', () => {
    render(TaskCard, { props: { task: baseTask } })
    expect(screen.getByText('Alice')).toBeTruthy()
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
    }
    render(TaskCard, { props: { task: baseTask, session } })
    expect(screen.getByText('Done')).toBeTruthy()
  })

  it('applies completed class to card when session is completed', () => {
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
    }
    render(TaskCard, { props: { task: baseTask, session } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('completed')).toBe(true)
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
    }
    render(TaskCard, { props: { task: baseTask, session } })
    expect(screen.getByText('Paused')).toBeTruthy()
  })

  it('shows 3rror badge when session has failed', () => {
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
    }
    render(TaskCard, { props: { task: baseTask, session } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('failed')).toBe(true)
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
    expect(screen.queryByText('3rror')).toBeNull()
    expect(screen.queryByText('Stopped')).toBeNull()
  })

  it('dispatches select event on click', async () => {
    const onSelect = vi.fn()
    render(TaskCard, { props: { task: baseTask, onSelect } })
    const card = screen.getByRole('button')
    await fire3vent.click(card)
    expect(onSelect).toHaveBeenCalledWith('T-42')
  })

  it('applies needs-input class when session is paused with checkpoint_data', () => {
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
    }
    render(TaskCard, { props: { task: baseTask, session } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('needs-input')).toBe(true)
  })

  it('does not apply needs-input class when session is paused without checkpoint_data', () => {
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
    }
    render(TaskCard, { props: { task: baseTask, session } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('needs-input')).toBe(false)
  })

  it('does not apply needs-input class when session is running', () => {
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
    }
    render(TaskCard, { props: { task: baseTask, session } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('needs-input')).toBe(false)
  })

  it('does not apply needs-input class when no session', () => {
    render(TaskCard, { props: { task: baseTask } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('needs-input')).toBe(false)
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

  it('applies ci-failed class when open PR has ci_status failure', () => {
    const pr = { ...basePr, ci_status: 'failure', state: 'open' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr] } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('ci-failed')).toBe(true)
  })

  it('does not apply ci-failed class when ci_status is success', () => {
    const pr = { ...basePr, ci_status: 'success', state: 'open' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr] } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('ci-failed')).toBe(false)
  })

  it('does not apply ci-failed class when PR is closed with failure', () => {
    const pr = { ...basePr, ci_status: 'failure', state: 'closed' }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr] } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('ci-failed')).toBe(false)
  })

  it('does not apply ci-failed class when agent is running despite CI failure', () => {
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
    }
    const pr = { ...basePr, ci_status: 'failure', state: 'open' }
    render(TaskCard, { props: { task: baseTask, session, pullRequests: [pr] } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('ci-failed')).toBe(false)
    expect(card.classList.contains('running')).toBe(true)
  })

  it('applies ci-failed class when agent is completed and CI failed', () => {
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
    }
    const pr = { ...basePr, ci_status: 'failure', state: 'open' }
    render(TaskCard, { props: { task: baseTask, session, pullRequests: [pr] } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('ci-failed')).toBe(true)
  })

  it('shows unaddressed comment badge when comments exist', () => {
    const pr = { ...basePr, unaddressed_comment_count: 3 }
    render(TaskCard, { props: { task: baseTask, pullRequests: [pr] } })
    expect(screen.getByText('3 unaddressed')).toBeTruthy()
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
    expect(screen.getByText('3 unaddressed')).toBeTruthy()
  })

  it('hides badge when no pull requests', () => {
    render(TaskCard, { props: { task: baseTask } })
    expect(screen.queryByText('unaddressed')).toBeNull()
  })
})
