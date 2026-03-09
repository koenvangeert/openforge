import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddTaskDialog from './AddTaskDialog.svelte'
import type { Task } from '../lib/types'

vi.mock('../lib/ipc', () => ({
  createTask: vi.fn().mockResolvedValue({
    id: 'T-1',
    title: 'New Task',
    status: 'backlog',
    jira_key: null,
    jira_title: null,
    jira_status: null,
    jira_assignee: null,
    jira_description: null,
    prompt: null,
    summary: null,
    agent: null,
    permission_mode: null,
    project_id: null,
    created_at: 1000,
    updated_at: 1000,
  } as Task),
  updateTask: vi.fn().mockResolvedValue(undefined),
  getProjectConfig: vi.fn().mockResolvedValue('claude-code'),
  getAgents: vi.fn().mockResolvedValue([{ name: 'agent-1' }, { name: 'agent-2' }]),
}))

vi.mock('../lib/stores', () => {
  const { writable } = require('svelte/store')
  return {
    activeProjectId: writable('test-project-id'),
  }
})

import { createTask, updateTask, getProjectConfig, getAgents } from '../lib/ipc'

const mockTask: Task = {
  id: 'T-42',
  title: 'Existing Task',
  status: 'doing',
  jira_key: 'PROJ-123',
  jira_title: null,
  jira_status: 'In Progress',
  jira_assignee: 'Alice',
  jira_description: null,
  prompt: null,
  summary: null,
  agent: null,
  permission_mode: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

describe('AddTaskDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getProjectConfig).mockResolvedValue('claude-code')
    vi.mocked(getAgents).mockResolvedValue([{ name: 'agent-1' }, { name: 'agent-2' }])
  })

  it('renders in create mode with empty fields', () => {
    render(AddTaskDialog, { props: { mode: 'create' } })
    expect(screen.getByRole('heading', { name: 'Create Task' })).toBeTruthy()
    
    const promptInput = screen.getByPlaceholderText('Describe what you want the agent to do') as HTMLInputElement
    expect(promptInput.value).toBe('')
  })

  it('disables submit button when title is empty', () => {
    render(AddTaskDialog, { props: { mode: 'create' } })
    const submitBtn = screen.getByRole('button', { name: 'Create Task' })
    expect(submitBtn.hasAttribute('disabled')).toBe(true)
  })

  it('enables submit button when title has text', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })
    const promptInput = screen.getByPlaceholderText('Describe what you want the agent to do')
    
    await fireEvent.input(promptInput, { target: { value: 'New task' } })
    
    const submitBtn = screen.getByRole('button', { name: 'Create Task' })
    expect(submitBtn.hasAttribute('disabled')).toBe(false)
  })

  it('calls createTask with correct arguments on submit', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })
    
    const promptInput = screen.getByPlaceholderText('Describe what you want the agent to do')
    const jiraInput = screen.getByPlaceholderText('e.g. PROJ-123')
    
    await fireEvent.input(promptInput, { target: { value: 'My new task' } })
    await fireEvent.input(jiraInput, { target: { value: 'PROJ-456' } })
    
    const submitBtn = screen.getByRole('button', { name: 'Create Task' })
    await fireEvent.click(submitBtn)
    
    await new Promise((r) => setTimeout(r, 10))
    expect(createTask).toHaveBeenCalledWith('My new task', 'backlog', 'PROJ-456', 'test-project-id', null, 'default')
  })

  it('pre-fills fields in edit mode', () => {
    render(AddTaskDialog, { props: { mode: 'edit', task: mockTask } })
    expect(screen.getByText('Edit Task')).toBeTruthy()
    
    const promptInput = screen.getByPlaceholderText('Describe what you want the agent to do') as HTMLInputElement
    expect(promptInput.value).toBe('Existing Task')
    
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

  it('shows Prompt label in create mode', () => {
    render(AddTaskDialog, { props: { mode: 'create' } })
    expect(screen.getByText('Prompt', { exact: false })).toBeTruthy()
  })

  it('shows permission mode dropdown when ai_provider is claude-code', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue('claude-code')
    render(AddTaskDialog, { props: { mode: 'create' } })

    await waitFor(() => {
      expect(screen.queryByLabelText('Permission Mode')).toBeTruthy()
    })
  })

  it('hides agent dropdown when ai_provider is claude-code', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue('claude-code')
    render(AddTaskDialog, { props: { mode: 'create' } })

    await waitFor(() => {
      expect(screen.queryByLabelText('Agent')).toBeNull()
    })
  })

  it('shows agent dropdown when ai_provider is opencode', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue('opencode')
    render(AddTaskDialog, { props: { mode: 'create' } })

    await waitFor(() => {
      expect(screen.queryByLabelText('Agent')).toBeTruthy()
    })
  })

  it('hides permission mode dropdown when ai_provider is opencode', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue('opencode')
    render(AddTaskDialog, { props: { mode: 'create' } })

    await waitFor(() => {
      expect(screen.queryByLabelText('Permission Mode')).toBeNull()
    })
  })
})
