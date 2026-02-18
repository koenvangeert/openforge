import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import KanbanBoard from './KanbanBoard.svelte'
import type { Task, AgentSession, Action } from '../lib/types'
import { tasks, activeSessions, activeProjectId } from '../lib/stores'

// Mock IPC functions
vi.mock('../lib/ipc', () => ({
  getTasks: vi.fn(),
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
  getEnabledActions: vi.fn((actions: Action[]) => actions.filter(a => a.enabled)),
}))

const baseTask: Task = {
  id: 'T-1',
  title: 'Test task',
  description: 'Test description',
  status: 'todo',
  jira_key: null,
  jira_status: null,
  jira_assignee: null,
  acceptance_criteria: null,
  plan_text: null,
  project_id: 'proj-1',
  created_at: 1000,
  updated_at: 2000,
}

describe('KanbanBoard', () => {
  beforeEach(() => {
    tasks.set([baseTask])
    activeSessions.set(new Map())
    activeProjectId.set('proj-1')
  })

  it('renders kanban columns', () => {
    render(KanbanBoard)
    expect(screen.getByText('To Do')).toBeTruthy()
    expect(screen.getByText('In Progress')).toBeTruthy()
    expect(screen.getByText('In Review')).toBeTruthy()
    expect(screen.getByText('Testing')).toBeTruthy()
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
    if (!taskCard) throw new Error('Task card not found')
    
    // Trigger right-click
    await fireEvent.contextMenu(taskCard)
    
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
    if (!taskCard) throw new Error('Task card not found')
    await fireEvent.contextMenu(taskCard)
    
    // Wait for reactive statements
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // Check that action buttons are disabled
    const actionButtons = container.querySelectorAll('.context-item')
    const startImplButton = Array.from(actionButtons).find(btn => btn.textContent?.includes('Start Implementation')) as HTMLButtonElement
    const writeTestsButton = Array.from(actionButtons).find(btn => btn.textContent?.includes('Write Tests')) as HTMLButtonElement
    
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
    if (!taskCard) throw new Error('Task card not found')
    await fireEvent.contextMenu(taskCard)
    
    // Wait for reactive statements
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // Check that action buttons are disabled with correct message
    const actionButtons = container.querySelectorAll('.context-item')
    const startImplButton = Array.from(actionButtons).find(btn => btn.textContent?.includes('Start Implementation')) as HTMLButtonElement
    
    expect(startImplButton).toBeTruthy()
    expect(startImplButton.disabled).toBe(true)
    expect(startImplButton.title).toBe('Answer pending question first')
  })

  it('dispatches run-action event when action is clicked', async () => {
    const { component } = render(KanbanBoard)
    let dispatchedEvent: any = null
    
    component.$on('run-action', (e: CustomEvent) => {
      dispatchedEvent = e.detail
    })
    
    // Trigger context menu
    const taskCard = screen.getByText('Test task').closest('div')
    if (!taskCard) throw new Error('Task card not found')
    await fireEvent.contextMenu(taskCard)
    
    // Wait for reactive statements
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // Click on "Start Implementation" action
    const startImplButton = screen.getByText('Start Implementation')
    await fireEvent.click(startImplButton)
    
    expect(dispatchedEvent).toBeTruthy()
    expect(dispatchedEvent.taskId).toBe('T-1')
    expect(dispatchedEvent.actionPrompt).toBe('Implement this task')
    expect(dispatchedEvent.agent).toBeNull()
  })
})
