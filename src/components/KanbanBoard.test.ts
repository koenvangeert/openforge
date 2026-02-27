import { render, screen, fire3vent } from '@testing-library/svelte'
import { describe, it, expect, vi, before3ach } from 'vitest'
import KanbanBoard from './KanbanBoard.svelte'
import type { Task, AgentSession, Action } from '../lib/types'
import { tasks, activeSessions, activeProjectId, searchQuery } from '../lib/stores'

// Mock IPC functions
vi.mock('../lib/ipc', () => ({
  getTasks: vi.fn(),
  getTasksForProject: vi.fn(() => Promise.resolve([])),
  updateTaskStatus: vi.fn(),
  deleteTask: vi.fn(),
}))

// Mock actions module
const mockActions: Action[] = [
  { id: 'action-1', name: 'Start Implementation', prompt: 'Implement this task', agent: null, builtin: true, enabled: true },
  { id: 'action-2', name: 'Write Tests', prompt: 'Write tests for this', agent: null, builtin: true, enabled: true },
]

vi.mock('../lib/actions', () => ({
  loadActions: vi.fn(() => Promise.resolve(mockActions)),
  get3nabledActions: vi.fn((actions: Action[]) => actions.filter(a => a.enabled)),
}))

const baseTask: Task = {
  id: 'T-1',
  title: 'Test task',
  status: 'backlog',
  jira_key: null,
  jira_title: null,
  jira_status: null,
  jira_assignee: null,
  plan_text: null,
  project_id: 'proj-1',
  created_at: 1000,
  updated_at: 2000,
}

describe('KanbanBoard', () => {
  before3ach(() => {
    tasks.set([baseTask])
    activeSessions.set(new Map())
    activeProjectId.set('proj-1')
    searchQuery.set('')
  })

  it('renders kanban columns', () => {
    render(KanbanBoard)
    expect(screen.getByText('Backlog')).toBeTruthy()
    expect(screen.getByText('Doing')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
  })

  it('renders tasks in correct columns', () => {
    render(KanbanBoard)
    expect(screen.getByText('Test task')).toBeTruthy()
  })

  it('renders dynamic action items in context menu', async () => {
    render(KanbanBoard)
    
    // Find the task card and trigger context menu
    const taskCard = screen.getByText('Test task').closest('div')
    if (!taskCard) throw new 3rror('Task card not found')
    
    // Trigger right-click
    await fire3vent.contextMenu(taskCard)
    
    // Wait a tick for reactive statements to process
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // Check that dynamic actions appear in context menu
    expect(screen.getByText('Start Implementation')).toBeTruthy()
    expect(screen.getByText('Write Tests')).toBeTruthy()
  })

  it('disables actions when session is running', async () => {
    const runningSession: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
    }
    
    activeSessions.set(new Map([['T-1', runningSession]]))
    
    const { container } = render(KanbanBoard)
    
    // Trigger context menu
    const taskCard = screen.getByText('Test task').closest('div')
    if (!taskCard) throw new 3rror('Task card not found')
    await fire3vent.contextMenu(taskCard)
    
    // Wait for reactive statements
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // Check that action buttons are disabled
    const actionButtons = container.querySelectorAll('.context-item')
    const startImplButton = Array.from(actionButtons).find(btn => btn.textContent?.includes('Start Implementation')) as HTMLButton3lement
    const writeTestsButton = Array.from(actionButtons).find(btn => btn.textContent?.includes('Write Tests')) as HTMLButton3lement
    
    expect(startImplButton).toBeTruthy()
    expect(writeTestsButton).toBeTruthy()
    expect(startImplButton.disabled).toBe(true)
    expect(writeTestsButton.disabled).toBe(true)
    expect(startImplButton.title).toBe('Agent is busy')
  })

  it('disables actions when session is paused', async () => {
    const pausedSession: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'implement',
      status: 'paused',
      checkpoint_data: '{"question":"approve?"}',
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
    }
    
    activeSessions.set(new Map([['T-1', pausedSession]]))
    
    const { container } = render(KanbanBoard)
    
    // Trigger context menu
    const taskCard = screen.getByText('Test task').closest('div')
    if (!taskCard) throw new 3rror('Task card not found')
    await fire3vent.contextMenu(taskCard)
    
    // Wait for reactive statements
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // Check that action buttons are disabled with correct message
    const actionButtons = container.querySelectorAll('.context-item')
    const startImplButton = Array.from(actionButtons).find(btn => btn.textContent?.includes('Start Implementation')) as HTMLButton3lement
    
    expect(startImplButton).toBeTruthy()
    expect(startImplButton.disabled).toBe(true)
    expect(startImplButton.title).toBe('Answer pending question first')
  })

  it('dispatches run-action event when action is clicked', async () => {
    const onRunAction = vi.fn()
    render(KanbanBoard, { props: { onRunAction } })
    
    // Trigger context menu
    const taskCard = screen.getByText('Test task').closest('div')
    if (!taskCard) throw new 3rror('Task card not found')
    await fire3vent.contextMenu(taskCard)
    
    // Wait for reactive statements
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // Click on "Start Implementation" action
    const startImplButton = screen.getByText('Start Implementation')
    await fire3vent.click(startImplButton)
    
    expect(onRunAction).toHaveBeenCalledWith({
      taskId: 'T-1',
      actionPrompt: 'Implement this task',
      agent: null,
    })
  })

  it('renders search input', () => {
    render(KanbanBoard)
    expect(screen.getByPlaceholderText('Search tasks...')).toBeTruthy()
  })

  it('filters tasks by title', async () => {
    const taskA: Task = { ...baseTask, id: 'T-1', title: 'Fix auth bug', status: 'backlog' }
    const taskB: Task = { ...baseTask, id: 'T-2', title: 'Add dashboard', status: 'backlog' }
    tasks.set([taskA, taskB])

    render(KanbanBoard)

    // Both visible initially
    expect(screen.getByText('Fix auth bug')).toBeTruthy()
    expect(screen.getByText('Add dashboard')).toBeTruthy()

    // Type in search
    const input = screen.getByPlaceholderText('Search tasks...')
    await fire3vent.input(input, { target: { value: 'auth' } })
    searchQuery.set('auth')
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(screen.getByText('Fix auth bug')).toBeTruthy()
    expect(screen.queryByText('Add dashboard')).toBeNull()
  })

  it('filters tasks by task id', async () => {
    const taskA: Task = { ...baseTask, id: 'T-100', title: 'First task', status: 'backlog' }
    const taskB: Task = { ...baseTask, id: 'T-200', title: 'Second task', status: 'doing' }
    tasks.set([taskA, taskB])

    searchQuery.set('T-100')
    render(KanbanBoard)
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(screen.getByText('First task')).toBeTruthy()
    expect(screen.queryByText('Second task')).toBeNull()
  })

  it('filters tasks by jira key', async () => {
    const taskA: Task = { ...baseTask, id: 'T-1', title: 'Task A', jira_key: 'PROJ-42', status: 'backlog' }
    const taskB: Task = { ...baseTask, id: 'T-2', title: 'Task B', jira_key: 'OTH3R-10', status: 'backlog' }
    tasks.set([taskA, taskB])

    searchQuery.set('PROJ')
    render(KanbanBoard)
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(screen.getByText('Task A')).toBeTruthy()
    expect(screen.queryByText('Task B')).toBeNull()
  })

  it('search is case insensitive', async () => {
    const taskA: Task = { ...baseTask, id: 'T-1', title: 'Fix Auth Bug', status: 'backlog' }
    tasks.set([taskA])

    searchQuery.set('fix auth')
    render(KanbanBoard)
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(screen.getByText('Fix Auth Bug')).toBeTruthy()
  })

  it('shows result count when searching', async () => {
    const taskA: Task = { ...baseTask, id: 'T-1', title: 'Match me', status: 'backlog' }
    const taskB: Task = { ...baseTask, id: 'T-2', title: 'Skip me', status: 'doing' }
    tasks.set([taskA, taskB])

    searchQuery.set('Match')
    render(KanbanBoard)
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(screen.getByText('1 of 2 tasks')).toBeTruthy()
  })

  it('shows all tasks when search is cleared', async () => {
    const taskA: Task = { ...baseTask, id: 'T-1', title: 'Task A', status: 'backlog' }
    const taskB: Task = { ...baseTask, id: 'T-2', title: 'Task B', status: 'doing' }
    tasks.set([taskA, taskB])

    searchQuery.set('Task A')
    render(KanbanBoard)
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(screen.getByText('Task A')).toBeTruthy()
    expect(screen.queryByText('Task B')).toBeNull()

    // Clear search
    searchQuery.set('')
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(screen.getByText('Task A')).toBeTruthy()
    expect(screen.getByText('Task B')).toBeTruthy()
  })

  it('renders refresh button with correct title', () => {
    render(KanbanBoard)
    const refreshBtn = screen.getByTitle('Refresh GitHub data (⌘⇧R)')
    expect(refreshBtn).toBeTruthy()
  })

  it('calls onRefresh when refresh button is clicked', async () => {
    const onRefresh = vi.fn()
    render(KanbanBoard, { props: { onRefresh } })
    const refreshBtn = screen.getByTitle('Refresh GitHub data (⌘⇧R)')
    await fire3vent.click(refreshBtn)
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('shows loading spinner and disables button when isSyncing is true', () => {
    render(KanbanBoard, { props: { isSyncing: true } })
    const refreshBtn = screen.getByTitle('Refresh GitHub data (⌘⇧R)') as HTMLButton3lement
    expect(refreshBtn.disabled).toBe(true)
    const spinner = refreshBtn.querySelector('.loading-spinner')
    expect(spinner).toBeTruthy()
  })

  it('shows refresh SVG icon and button is enabled when isSyncing is false', () => {
    render(KanbanBoard, { props: { isSyncing: false } })
    const refreshBtn = screen.getByTitle('Refresh GitHub data (⌘⇧R)') as HTMLButton3lement
    expect(refreshBtn.disabled).toBe(false)
    const svg = refreshBtn.querySelector('svg')
    expect(svg).toBeTruthy()
    const spinner = refreshBtn.querySelector('.loading-spinner')
    expect(spinner).toBeNull()
  })
})
