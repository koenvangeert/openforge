import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect } from 'vitest'
import TaskCard from './TaskCard.svelte'
import type { Task, AgentSession } from '../lib/types'

const baseTask: Task = {
  id: 'T-42',
  title: 'Implement auth middleware',
  status: 'todo',
  jira_key: 'PROJ-123',
  jira_status: 'To Do',
  jira_assignee: 'Alice',
  plan_text: null,
  project_id: null,
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
    expect(screen.getByText('Implementing...')).toBeTruthy()
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
    expect(screen.getByText('Completed')).toBeTruthy()
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
    expect(screen.getByText('Awaiting approval')).toBeTruthy()
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
    }
    render(TaskCard, { props: { task: baseTask, session } })
    expect(screen.getByText('Build failed')).toBeTruthy()
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
    expect(screen.getByText('Interrupted')).toBeTruthy()
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
    expect(screen.queryByText('Error')).toBeNull()
    expect(screen.queryByText('Stopped')).toBeNull()
  })

  it('dispatches select event on click', async () => {
    const { component } = render(TaskCard, { props: { task: baseTask } })
    let selectedId = ''
    component.$on('select', (e: CustomEvent<string>) => {
      selectedId = e.detail
    })
    const card = screen.getByRole('button')
    await fireEvent.click(card)
    expect(selectedId).toBe('T-42')
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
})
