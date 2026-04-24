import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import FocusBoard from './FocusBoard.svelte'
import type { Task, AgentSession, PullRequestInfo, BoardStatus } from '../../lib/types'
import { focusBoardFilters } from '../../lib/stores'

vi.mock('../../lib/ipc', () => ({
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  setProjectConfig: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/boardFilters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/boardFilters')>()
  return {
    ...actual,
    loadFocusFilterStates: vi.fn().mockResolvedValue(['idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted', 'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments', 'ready-to-merge', 'pr-merged', 'merge-conflict']),
  }
})

const makeTask = (id: string, status: BoardStatus, prompt: string): Task => ({
  id,
  initial_prompt: prompt,
  status,
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
    pi_session_id: null,
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
  projectId?: string | null
  tasks?: Task[]
  sessions?: Map<string, AgentSession>
  prs?: Map<string, PullRequestInfo[]>
}) {
  const projectId = overrides?.projectId ?? 'proj-1'
  const tasks = overrides?.tasks ?? [taskFocus, taskDoing, taskDone, taskBacklog]
  const sessions = overrides?.sessions ?? new Map([
    [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
    [taskDoing.id, makeSession(taskDoing.id, 'running', null)],
  ])
  const prs = overrides?.prs ?? new Map<string, PullRequestInfo[]>()

  return render(FocusBoard, {
    props: {
      projectId,
      projectName: 'Test Project',
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
    focusBoardFilters.set(new Map())
  })

  it('renders the project name as the board heading', async () => {
    renderBoard()
    expect(await screen.findByRole('heading', { name: 'Test Project' })).toBeTruthy()
  })

  it('has Focus now chip active by default', async () => {
    renderBoard()
    const chip = await screen.findByRole('button', { name: /Focus now 1/i })
    expect(chip).toBeTruthy()
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('changes list when In progress chip is clicked', async () => {
    renderBoard()

    await fireEvent.click(await screen.findByRole('button', { name: /In progress 1/i }))

    expect(screen.getAllByText('Doing task').length).toBeGreaterThan(0)
    expect(screen.queryByText('Focus task')).toBeNull()
    expect(screen.queryByText('Backlog task')).toBeNull()
    expect(screen.queryByText('Done task')).toBeNull()
  })

  it('shows only backlog tasks when Backlog chip is clicked', async () => {
    renderBoard()

    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 1/i }))

    expect(screen.getAllByText('Backlog task').length).toBeGreaterThan(0)
    expect(screen.queryByText('Focus task')).toBeNull()
    expect(screen.queryByText('Doing task')).toBeNull()
    expect(screen.queryByText('Done task')).toBeNull()
  })

  it('auto-selects the focused task in detail pane on mount', async () => {
    renderBoard()

    await waitFor(() => {
      expect(screen.queryByText('Select a task to see details')).toBeNull()
    })
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

    const focused = requireElement(document.querySelector('.vim-focus'), HTMLElement)
    expect(focused).toBeTruthy()
    expect(within(focused).getByText('Doing task')).toBeTruthy()
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

    const focused = requireElement(document.querySelector('.vim-focus'), HTMLElement)
    expect(focused).toBeTruthy()
    expect(within(focused).getByText('Focus task')).toBeTruthy()
  })

  it('opens focused task on Enter', async () => {
    renderBoard()

    await fireEvent.keyDown(window, { key: 'Enter' })

    expect(onOpenTask).toHaveBeenCalledWith('T-1')
  })

  it('calls onOpenTask when Enter is pressed on already-selected task', async () => {
    renderBoard()

    await fireEvent.keyDown(window, { key: 'Enter' })
    await fireEvent.keyDown(window, { key: 'Enter' })

    expect(onOpenTask).toHaveBeenCalledWith('T-1')
  })

  it('closes detail pane on Escape', async () => {
    renderBoard()

    await waitFor(() => {
      expect(screen.queryByText('Select a task to see details')).toBeNull()
    })

    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('Select a task to see details')).toBeTruthy()
  })

  it('auto-selects task in detail pane when vim j is pressed', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing, taskDone],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
      prs: new Map(),
    })

    await waitFor(() => {
      expect(screen.queryByText('Select a task to see details')).toBeNull()
    })

    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('Select a task to see details')).toBeTruthy()

    await fireEvent.keyDown(window, { key: 'j' })
    await waitFor(() => {
      expect(screen.queryByText('Select a task to see details')).toBeNull()
    })
  })

  it('renders Needs attention header when focus filter is active', async () => {
    renderBoard()
    expect(await screen.findByText('Needs attention')).toBeTruthy()
  })

  it('shows empty state when no tasks match active filter', async () => {
    renderBoard({
      tasks: [taskDoing, taskDone],
      sessions: new Map([[taskDoing.id, makeSession(taskDoing.id, 'running', null)]]),
      prs: new Map(),
    })

    expect(await screen.findByText('All clear')).toBeTruthy()
  })

  it('opens task context menu on right click', async () => {
    renderBoard()

    await fireEvent.click(await screen.findByRole('button', { name: /In progress 1/i }))
    const doingTaskElements = screen.getAllByText('Doing task')
    await fireEvent.contextMenu(doingTaskElements[0])

    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByText('Delete')).toBeTruthy()
  })

  it('shows backlog task in detail pane when switching to Backlog filter', async () => {
    renderBoard()

    await waitFor(() => {
      expect(screen.queryByText('Select a task to see details')).toBeNull()
    })

    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 1/i }))

    expect(screen.getAllByText('Backlog task').length).toBeGreaterThan(0)
    expect(screen.queryByText('Focus task')).toBeNull()
  })

  it('computes focus count with unaddressed PR comments', async () => {
    renderBoard({
      tasks: [taskDoing],
      sessions: new Map(),
      prs: new Map([[taskDoing.id, [makePr(taskDoing.id, 2)]]]),
    })

    expect(await screen.findByRole('button', { name: /Focus now 1/i })).toBeTruthy()
    expect(screen.getAllByText('Doing task').length).toBeGreaterThan(0)
  })

  it('surfaces merge conflicts in Needs attention cards', async () => {
    renderBoard({
      tasks: [taskDoing],
      sessions: new Map(),
      prs: new Map([[
        taskDoing.id,
        [{
          ...makePr(taskDoing.id, 0),
          mergeable_state: 'dirty',
        }],
      ]]),
    })

    expect(await screen.findByRole('button', { name: /Focus now 1/i })).toBeTruthy()
    const boardCard = requireElement(document.querySelector('[data-vim-item]'), HTMLElement)
    expect(boardCard).toBeTruthy()
    expect(within(boardCard).getByText('Doing task')).toBeTruthy()
    expect(within(boardCard).getByText('Merge Conflict')).toBeTruthy()
    expect(within(boardCard).getByText('Pull request has merge conflicts that must be resolved.')).toBeTruthy()
  })

  it('CMD+1 activates Focus now filter', async () => {
    renderBoard()
    // First switch away from focus
    await fireEvent.click(await screen.findByRole('button', { name: /In progress/i }))
    // Now CMD+1 should switch back
    await fireEvent.keyDown(window, { key: '1', metaKey: true })
    const focusChip = screen.getByRole('button', { name: /Focus now/i })
    expect(focusChip.getAttribute('aria-pressed')).toBe('true')
  })

  it('CMD+2 activates In progress filter', async () => {
    renderBoard()
    await fireEvent.keyDown(window, { key: '2', metaKey: true })
    const chip = screen.getByRole('button', { name: /In progress/i })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('CMD+3 activates Backlog filter', async () => {
    renderBoard()
    await fireEvent.keyDown(window, { key: '3', metaKey: true })
    const chip = screen.getByRole('button', { name: /Backlog 1/i })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('restores the previously selected filter when remounted for the same project', async () => {
    const firstRender = renderBoard()

    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 1/i }))

    expect(screen.getByRole('button', { name: /Backlog 1/i }).getAttribute('aria-pressed')).toBe('true')

    firstRender.unmount()
    renderBoard({ tasks: [taskFocus, taskDoing, taskDone, taskBacklog] })

    expect((await screen.findByRole('button', { name: /Backlog 1/i })).getAttribute('aria-pressed')).toBe('true')
  })

  it('does not carry the selected filter over to a different project board', async () => {
    const firstRender = renderBoard({ projectId: 'proj-1' })

    await fireEvent.click(await screen.findByRole('button', { name: /In progress 1/i }))
    expect(screen.getByRole('button', { name: /In progress 1/i }).getAttribute('aria-pressed')).toBe('true')

    firstRender.unmount()

    const secondRender = renderBoard({ projectId: 'proj-2' })
    expect((await screen.findByRole('button', { name: /Focus now 1/i })).getAttribute('aria-pressed')).toBe('true')
    secondRender.unmount()
  })

  it('clicking an unselected task selects it without navigating', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vim-item]').length).toBe(2)
    })

    const items = document.querySelectorAll('[data-vim-item]')
    await fireEvent.click(items[1])

    expect(onOpenTask).not.toHaveBeenCalled()

    await waitFor(() => {
      const updatedItems = document.querySelectorAll('[data-vim-item]')
      expect(updatedItems[1].getAttribute('data-selected')).toBe('true')
    })
  })

  it('clicking an already-selected task navigates to it', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vim-item]').length).toBe(2)
    })

    const items = document.querySelectorAll('[data-vim-item]')

    await fireEvent.click(items[1])
    expect(onOpenTask).not.toHaveBeenCalled()

    await fireEvent.click(items[1])
    expect(onOpenTask).toHaveBeenCalledWith(taskDoing.id)
  })
})
