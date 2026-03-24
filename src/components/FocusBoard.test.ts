import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import FocusBoard from './FocusBoard.svelte'
import type { Task, AgentSession, PullRequestInfo } from '../lib/types'

vi.mock('../lib/ipc', () => ({
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  setProjectConfig: vi.fn().mockResolvedValue(undefined),
}))

const makeTask = (id: string, status: string, prompt: string): Task => ({
  id,
  initial_prompt: prompt,
  status,
  jira_key: null,
  jira_title: null,
  jira_status: null,
  jira_assignee: null,
  jira_description: null,
  prompt: null,
  summary: null,
  agent: null,
  permission_mode: null,
  project_id: 'proj-1',
  created_at: 1000,
  updated_at: 2000,
})

const makeSession = (taskId: string, status: string, checkpoint_data: string | null): AgentSession => ({
  id: `session-${taskId}`,
  ticket_id: taskId,
  opencode_session_id: null,
  stage: 'implement',
  status,
  checkpoint_data,
  error_message: null,
  created_at: 1000,
  updated_at: 3000,
  provider: 'opencode',
  claude_session_id: null,
})

const makePr = (taskId: string, unaddressed: number): PullRequestInfo => ({
  id: Number(taskId.replace(/\D/g, '')) || 1,
  ticket_id: taskId,
  repo_owner: 'owner',
  repo_name: 'repo',
  title: `PR for ${taskId}`,
  url: `https://example.com/${taskId}`,
  state: 'open',
  head_sha: 'abc',
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
  unaddressed_comment_count: unaddressed,
})

const taskFocus = makeTask('T-1', 'doing', 'Focus task')
const taskDoing = makeTask('T-2', 'doing', 'Doing task')
const taskDone = makeTask('T-3', 'done', 'Done task')
const taskBacklog = makeTask('T-4', 'backlog', 'Backlog task')

const onOpenTask = vi.fn()
const onRunAction = vi.fn()

function renderBoard(overrides?: {
  tasks?: Task[]
  sessions?: Map<string, AgentSession>
  prs?: Map<string, PullRequestInfo[]>
}) {
  const tasks = overrides?.tasks ?? [taskFocus, taskDoing, taskDone, taskBacklog]
  const sessions = overrides?.sessions ?? new Map([
    [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
  ])
  const prs = overrides?.prs ?? new Map<string, PullRequestInfo[]>()

  return render(FocusBoard, {
    props: {
      tasks,
      activeSessions: sessions,
      ticketPrs: prs,
      onOpenTask,
      onRunAction,
    },
  })
}

describe('FocusBoard', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    vi.clearAllMocks()
  })

  it('has Focus now chip active by default', async () => {
    renderBoard()
    const chip = await screen.findByRole('button', { name: /Focus now 1/i })
    expect(chip).toBeTruthy()
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('changes list when In progress chip is clicked', async () => {
    renderBoard()

    await fireEvent.click(await screen.findByRole('button', { name: /In progress 3/i }))

    expect(screen.getByText('Focus task')).toBeTruthy()
    expect(screen.getByText('Doing task')).toBeTruthy()
    expect(screen.getByText('Backlog task')).toBeTruthy()
    expect(screen.queryByText('Done task')).toBeNull()
  })

  it('shows only done tasks when Done chip is clicked', async () => {
    renderBoard()

    await fireEvent.click(await screen.findByRole('button', { name: /Done 1/i }))

    expect(screen.getByText('Done task')).toBeTruthy()
    expect(screen.queryByText('Focus task')).toBeNull()
    expect(screen.queryByText('Doing task')).toBeNull()
  })

  it('shows task detail pane after selecting task', async () => {
    renderBoard()

    expect(screen.getByText('Select a task to see details')).toBeTruthy()
    await fireEvent.click(await screen.findByText('Focus task'))

    expect(screen.queryByText('Select a task to see details')).toBeNull()
    expect(screen.getByText('// INITIAL_PROMPT')).toBeTruthy()
  })

  it('moves vim focus down on j key', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing, taskDone],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(document.querySelectorAll('.vim-focus').length).toBeGreaterThan(0)
    })

    await fireEvent.keyDown(window, { key: 'j' })

    const focused = document.querySelector('.vim-focus') as HTMLElement | null
    expect(focused).toBeTruthy()
    expect(within(focused as HTMLElement).getByText('Doing task')).toBeTruthy()
  })

  it('moves vim focus up on k key', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing, taskDone],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await fireEvent.keyDown(window, { key: 'j' })
    await fireEvent.keyDown(window, { key: 'k' })

    const focused = document.querySelector('.vim-focus') as HTMLElement | null
    expect(focused).toBeTruthy()
    expect(within(focused as HTMLElement).getByText('Focus task')).toBeTruthy()
  })

  it('selects focused task on Enter', async () => {
    renderBoard()

    await fireEvent.keyDown(window, { key: 'Enter' })

    expect(screen.queryByText('Select a task to see details')).toBeNull()
    expect(screen.getByText('// INITIAL_PROMPT')).toBeTruthy()
  })

  it('calls onOpenTask when Enter is pressed on already-selected task', async () => {
    renderBoard()

    await fireEvent.keyDown(window, { key: 'Enter' })
    await fireEvent.keyDown(window, { key: 'Enter' })

    expect(onOpenTask).toHaveBeenCalledWith('T-1')
  })

  it('closes detail pane on Escape', async () => {
    renderBoard()

    await fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.queryByText('Select a task to see details')).toBeNull()

    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('Select a task to see details')).toBeTruthy()
  })

  it('renders Needs attention header when focus filter is active', async () => {
    renderBoard()
    expect(await screen.findByText('Needs attention')).toBeTruthy()
  })

  it('shows empty state when no tasks match active filter', async () => {
    renderBoard({
      tasks: [taskDoing, taskDone],
      sessions: new Map(),
      prs: new Map(),
    })

    expect(await screen.findByText('No tasks match this filter.')).toBeTruthy()
  })

  it('opens task context menu on right click', async () => {
    renderBoard()

    await fireEvent.click(await screen.findByRole('button', { name: /In progress 3/i }))
    await fireEvent.contextMenu(screen.getByText('Backlog task'))

    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByText('Delete')).toBeTruthy()
  })

  it('clears selected task when filter changes and selected task is excluded', async () => {
    renderBoard()

    await fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.queryByText('Select a task to see details')).toBeNull()

    await fireEvent.click(await screen.findByRole('button', { name: /Done 1/i }))

    expect(screen.getByText('Select a task to see details')).toBeTruthy()
  })

  it('computes focus count with unaddressed PR comments', async () => {
    renderBoard({
      tasks: [taskBacklog],
      sessions: new Map(),
      prs: new Map([[taskBacklog.id, [makePr(taskBacklog.id, 2)]]]),
    })

    expect(await screen.findByRole('button', { name: /Focus now 1/i })).toBeTruthy()
    expect(screen.getByText('Backlog task')).toBeTruthy()
  })
})
