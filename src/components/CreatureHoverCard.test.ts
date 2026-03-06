import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import CreatureHoverCard from './CreatureHoverCard.svelte'
import type { Task, AgentSession } from '../lib/types'
import type { CreatureState, CreatureRoom } from '../lib/creatureState'
import { ticketPrs } from '../lib/stores'

const baseTask: Task = {
  id: 'T-99',
  title: 'Implement rate limiting middleware',
  status: 'doing',
  jira_key: null,
  jira_title: null,
  jira_status: null,
  jira_assignee: 'koen.vangeert',
  jira_description: 'Setting up request throttling with Redis backend.',
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

const oneHourAgo = Date.now() - 3600000

const baseSession: AgentSession = {
  id: 'ses-1',
  ticket_id: 'T-99',
  opencode_session_id: null,
  stage: 'implementation',
  status: 'running',
  checkpoint_data: null,
  error_message: null,
  created_at: oneHourAgo,
  updated_at: Date.now(),
  provider: 'opencode',
  claude_session_id: null,
}

function renderHoverCard(overrides: {
  task?: Partial<Task>
  session?: AgentSession | null
  state?: CreatureState
  room?: CreatureRoom
} = {}) {
  const onClose = vi.fn()
  const onCardEnter = vi.fn()
  const task = { ...baseTask, ...overrides.task }
  const result = render(CreatureHoverCard, {
    props: {
      task,
      session: overrides.session !== undefined ? overrides.session : baseSession,
      state: overrides.state ?? 'active',
      room: overrides.room ?? 'forge',
      position: { x: 100, y: 100 },
      onClose,
      onCardEnter,
    }
  })
  return { ...result, onClose, onCardEnter }
}

describe('CreatureHoverCard', () => {
  beforeEach(() => {
    ticketPrs.set(new Map())
  })

  it('renders task ID', () => {
    renderHoverCard()
    expect(screen.getByText('T-99')).toBeTruthy()
  })

  it('renders task title', () => {
    renderHoverCard()
    expect(screen.getByText('Implement rate limiting middleware')).toBeTruthy()
  })

  it('renders status badge with RUNNING label for active state', () => {
    renderHoverCard({ state: 'active' })
    expect(screen.getByText('RUNNING')).toBeTruthy()
  })

  it('renders status badge with BLOCKED label for needs-input state', () => {
    renderHoverCard({ state: 'needs-input' })
    expect(screen.getByText('BLOCKED')).toBeTruthy()
  })

  it('renders status badge with PAUSED label for resting state', () => {
    renderHoverCard({ state: 'resting' })
    expect(screen.getByText('PAUSED')).toBeTruthy()
  })

  it('renders status badge with FAILED label for sad state', () => {
    renderHoverCard({ state: 'sad' })
    expect(screen.getByText('FAILED')).toBeTruthy()
  })

  it('renders status badge with INTERRUPTED label for frozen state', () => {
    renderHoverCard({ state: 'frozen' })
    expect(screen.getByText('INTERRUPTED')).toBeTruthy()
  })

  it('renders status badge with DONE label for celebrating state', () => {
    renderHoverCard({ state: 'celebrating' })
    expect(screen.getByText('DONE')).toBeTruthy()
  })

  it('renders status badge with IDLE label for idle state', () => {
    renderHoverCard({ state: 'idle' })
    expect(screen.getByText('IDLE')).toBeTruthy()
  })

  it('renders assignee with @ prefix when jira_assignee is available', () => {
    renderHoverCard()
    expect(screen.getByText('@koen.vangeert')).toBeTruthy()
  })

  it('shows unassigned when jira_assignee is null', () => {
    renderHoverCard({ task: { jira_assignee: null } })
    expect(screen.getByText('unassigned')).toBeTruthy()
  })

  it('renders running time as "1h 0m" when session was created one hour ago', () => {
    renderHoverCard()
    expect(screen.getByText('1h 0m')).toBeTruthy()
  })

  it('shows idle when no session provided', () => {
    renderHoverCard({ session: null })
    expect(screen.getByText('idle')).toBeTruthy()
  })

  it('shows "no PR" when no PRs exist for the task', () => {
    renderHoverCard()
    expect(screen.getByText('no PR')).toBeTruthy()
  })

  it('shows PR info when PRs exist', () => {
    ticketPrs.set(new Map([
      ['T-99', [{
        id: 140,
        ticket_id: 'T-99',
        repo_owner: 'org',
        repo_name: 'repo',
        title: 'Add rate limiting',
        url: 'https://github.com/org/repo/pull/140',
        state: 'open',
        head_sha: 'abc123',
        ci_status: 'success',
        ci_check_runs: null,
        review_status: null,
        merged_at: null,
        created_at: 1000,
        updated_at: 2000,
        unaddressed_comment_count: 0,
      }]]
    ]))
    renderHoverCard()
    expect(screen.getByText('#140 open · CI: success')).toBeTruthy()
  })

  it('shows PR info without CI status when ci_status is null', () => {
    ticketPrs.set(new Map([
      ['T-99', [{
        id: 200,
        ticket_id: 'T-99',
        repo_owner: 'org',
        repo_name: 'repo',
        title: 'Fix bug',
        url: 'https://github.com/org/repo/pull/200',
        state: 'open',
        head_sha: 'def456',
        ci_status: null,
        ci_check_runs: null,
        review_status: null,
        merged_at: null,
        created_at: 1000,
        updated_at: 2000,
        unaddressed_comment_count: 0,
      }]]
    ]))
    renderHoverCard()
    expect(screen.getByText('#200 open')).toBeTruthy()
  })

  it('status badge uses success colors for forge room', () => {
    const { container } = renderHoverCard({ room: 'forge', state: 'active' })
    const badge = container.querySelector('.bg-success\\/20')
    expect(badge).toBeTruthy()
  })

  it('status badge uses warning colors for warRoom', () => {
    const { container } = renderHoverCard({ room: 'warRoom', state: 'needs-input' })
    const badge = container.querySelector('.bg-warning\\/20')
    expect(badge).toBeTruthy()
  })

  it('positions the card using provided x and y coordinates', () => {
    const { container } = render(CreatureHoverCard, {
      props: {
        task: baseTask,
        session: baseSession,
        state: 'active' as CreatureState,
        room: 'forge' as CreatureRoom,
        position: { x: 250, y: 400 },
        onClose: vi.fn(),
        onCardEnter: vi.fn(),
      }
    })
    const card = container.querySelector('[style*="left: 250px"]')
    expect(card).toBeTruthy()
  })

  it('calls onCardEnter on mouseenter', async () => {
    const { onCardEnter } = renderHoverCard()
    const card = screen.getByRole('tooltip')
    await fireEvent.mouseEnter(card)
    expect(onCardEnter).toHaveBeenCalled()
  })

  it('calls onClose on mouseleave', async () => {
    const { onClose } = renderHoverCard()
    const card = screen.getByRole('tooltip')
    await fireEvent.mouseLeave(card)
    expect(onClose).toHaveBeenCalled()
  })

  it('renders agent status text for running session', () => {
    renderHoverCard()
    expect(screen.getByText('agent implementing...')).toBeTruthy()
  })

  it('renders agent status as "no agent" when session is null', () => {
    renderHoverCard({ session: null })
    expect(screen.getByText('no agent')).toBeTruthy()
  })

  it('renders "click to view task details" hint', () => {
    renderHoverCard()
    expect(screen.getByText('click to view task details')).toBeTruthy()
  })

  it('uses room-colored border for forge', () => {
    const { container } = renderHoverCard({ room: 'forge' })
    const card = container.querySelector('.border-success')
    expect(card).toBeTruthy()
  })

  it('uses room-colored border for warRoom', () => {
    const { container } = renderHoverCard({ room: 'warRoom' })
    const card = container.querySelector('.border-warning')
    expect(card).toBeTruthy()
  })

  it('shows assignee with @ prefix', () => {
    renderHoverCard()
    expect(screen.getByText('@koen.vangeert')).toBeTruthy()
  })

  it('PR text uses success color when PRs exist', () => {
    ticketPrs.set(new Map([
      ['T-99', [{
        id: 140,
        ticket_id: 'T-99',
        repo_owner: 'org',
        repo_name: 'repo',
        title: 'Add rate limiting',
        url: 'https://github.com/org/repo/pull/140',
        state: 'open',
        head_sha: 'abc123',
        ci_status: 'success',
        ci_check_runs: null,
        review_status: null,
        merged_at: null,
        created_at: 1000,
        updated_at: 2000,
        unaddressed_comment_count: 0,
      }]]
    ]))
    const { container } = renderHoverCard()
    const prSpan = container.querySelector('.text-success')
    expect(prSpan).toBeTruthy()
  })
})
