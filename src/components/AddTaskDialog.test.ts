import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddTaskDialog from './AddTaskDialog.svelte'
import type { Task } from '../lib/types'

vi.mock('../lib/ipc', () => ({
  createTask: vi.fn().mockResolvedValue({
    id: 'T-1',
    title: 'New Task',
    status: 'todo',
    jira_key: null,
    jira_status: null,
    jira_assignee: null,
    plan_text: null,
    created_at: 1000,
    updated_at: 1000,
  } as Task),
  updateTask: vi.fn().mockResolvedValue(undefined),
}))

import { createTask, updateTask } from '../lib/ipc'

const mockTask: Task = {
  id: 'T-42',
  title: 'Existing Task',
  status: 'in_progress',
  jira_key: 'PROJ-123',
  jira_status: 'In Progress',
  jira_assignee: 'Alice',
  plan_text: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

describe('AddTaskDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders in create mode with empty fields', () => {
    render(AddTaskDialog, { props: { mode: 'create' } })
    expect(screen.getByRole('heading', { name: 'Create Task' })).toBeTruthy()
    
    const titleInput = screen.getByPlaceholderText('Enter task title') as HTMLInputElement
    expect(titleInput.value).toBe('')
  })

  it('disables submit button when title is empty', () => {
    render(AddTaskDialog, { props: { mode: 'create' } })
    const submitBtn = screen.getByRole('button', { name: 'Create Task' })
    expect(submitBtn.hasAttribute('disabled')).toBe(true)
  })

  it('enables submit button when title has text', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })
    const titleInput = screen.getByPlaceholderText('Enter task title')
    
    await fireEvent.input(titleInput, { target: { value: 'New task' } })
    
    const submitBtn = screen.getByRole('button', { name: 'Create Task' })
    expect(submitBtn.hasAttribute('disabled')).toBe(false)
  })

  it('calls createTask with correct arguments on submit', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })
    
    const titleInput = screen.getByPlaceholderText('Enter task title')
    const jiraInput = screen.getByPlaceholderText('e.g. PROJ-123')
    
    await fireEvent.input(titleInput, { target: { value: 'My new task' } })
    await fireEvent.input(jiraInput, { target: { value: 'PROJ-456' } })
    
    const submitBtn = screen.getByRole('button', { name: 'Create Task' })
    await fireEvent.click(submitBtn)
    
    await new Promise((r) => setTimeout(r, 10))
    expect(createTask).toHaveBeenCalledWith('My new task', 'todo', 'PROJ-456', null)
  })

  it('pre-fills fields in edit mode', () => {
    render(AddTaskDialog, { props: { mode: 'edit', task: mockTask } })
    expect(screen.getByText('Edit Task')).toBeTruthy()
    
    const titleInput = screen.getByPlaceholderText('Enter task title') as HTMLInputElement
    expect(titleInput.value).toBe('Existing Task')
    
    const jiraInput = screen.getByPlaceholderText('e.g. PROJ-123') as HTMLInputElement
    expect(jiraInput.value).toBe('PROJ-123')
  })

  it('calls updateTask when submitted in edit mode', async () => {
    render(AddTaskDialog, { props: { mode: 'edit', task: mockTask } })
    
    const submitBtn = screen.getByRole('button', { name: 'Save Changes' })
    await fireEvent.click(submitBtn)
    
    await new Promise((r) => setTimeout(r, 10))
    expect(updateTask).toHaveBeenCalledWith('T-42', 'Existing Task', 'PROJ-123')
  })

  it('does not show status dropdown in edit mode', () => {
    render(AddTaskDialog, { props: { mode: 'edit', task: mockTask } })
    expect(screen.queryByText('Status')).toBeNull()
  })

  it('shows status dropdown in create mode', () => {
    render(AddTaskDialog, { props: { mode: 'create' } })
    expect(screen.getByText('Status')).toBeTruthy()
  })
})
