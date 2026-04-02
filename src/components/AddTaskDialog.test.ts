import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddTaskDialog from './AddTaskDialog.svelte'
import type { Action, Task } from '../lib/types'
import { createTask, updateTask, getProjectConfig, listOpenCodeAgents } from '../lib/ipc'
import { loadActions } from '../lib/actions'

vi.mock('../lib/ipc', () => ({
  createTask: vi.fn().mockResolvedValue({
    id: 'T-1',
    initial_prompt: 'New Task',
    status: 'backlog',
    prompt: null,
    summary: null,
    agent: null,
    permission_mode: null,
    project_id: null,
    created_at: 1000,
    updated_at: 1000,
  }),
  updateTask: vi.fn().mockResolvedValue(undefined),
  getProjectConfig: vi.fn().mockResolvedValue('claude-code'),
  listOpenCodeAgents: vi.fn().mockResolvedValue([
    { name: 'agent-1', hidden: false, mode: null },
    { name: 'agent-2', hidden: false, mode: null },
  ]),
  }))

vi.mock('../lib/actions', () => ({
  loadActions: vi.fn().mockResolvedValue([
    { id: 'act-1', name: 'Test Action', prompt: 'Do test', builtin: false, enabled: true },
  ]),
  getEnabledActions: vi.fn((actions: Action[]) => actions.filter((action: Action) => action.enabled)),
}))

vi.mock('../lib/stores', () => {
  const { writable } = require('svelte/store')
  return {
    activeProjectId: writable('test-project-id'),
  }
})

const mockTask = {
  id: 'T-42',
  initial_prompt: 'Existing Task',
  status: 'doing',
  prompt: null,
  summary: null,
  agent: null,
  permission_mode: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
} as Task

describe('AddTaskDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getProjectConfig).mockImplementation(async () => 'claude-code')
    vi.mocked(listOpenCodeAgents).mockResolvedValue([
      { name: 'agent-1', hidden: false, mode: null },
      { name: 'agent-2', hidden: false, mode: null },
    ])
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'act-1', name: 'Test Action', prompt: 'Do test', builtin: false, enabled: true },
    ])
  })

  it('renders in create mode with empty fields via PromptInput', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })
    expect(screen.getByRole('heading', { name: 'Create Task' })).toBeTruthy()
    // Wait for PromptInput to be ready
    await waitFor(() => {
      const textbox = screen.getByRole('textbox') as HTMLTextAreaElement
      expect(textbox.value).toBe('')
    })
  })

  it('closes before awaiting the async start flow', async () => {
    let resolveRunAction = () => {}
    const onClose = vi.fn()
    const onRunAction = vi.fn(() => new Promise<void>((resolve) => {
      resolveRunAction = resolve
    }))

    render(AddTaskDialog, { props: { mode: 'create', onClose, onRunAction } })

    const textbox = await screen.findByRole('textbox')
    await fireEvent.input(textbox, { target: { value: 'Start me' } })
    await fireEvent.click(await screen.findByRole('button', { name: /Start Task/ }))

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Start me', 'backlog', 'test-project-id', null, 'default')
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onRunAction).toHaveBeenCalledWith('T-1', '', null)
    })

    resolveRunAction()
  })

  it('calls createTask with correct arguments on submit via PromptInput', async () => {
    const onTaskSaved = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onTaskSaved } })
    
    const textbox = await screen.findByRole('textbox')
    // Svelte bind:value needs the value to be updated, or we fire `input` event
    await fireEvent.input(textbox, { target: { value: 'My new task' } })
    
    // The "Add to Backlog" button calls onSubmit
    const submitBtn = await screen.findByRole('button', { name: /Add to Backlog/ })
    await fireEvent.click(submitBtn)
    
    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('My new task', 'backlog', 'test-project-id', null, 'default')
      expect(onTaskSaved).toHaveBeenCalled()
    })
  })

  it('pre-fills fields in edit mode', async () => {
    render(AddTaskDialog, { props: { mode: 'edit', task: mockTask } })
    expect(screen.getByRole('heading', { name: 'Edit Task' })).toBeTruthy()
    
    const textbox = await screen.findByRole('textbox') as HTMLTextAreaElement
    expect(textbox.value).toBe('Existing Task')
  })

  it('calls updateTask when submitted in edit mode', async () => {
    const onTaskSaved = vi.fn()
    render(AddTaskDialog, { props: { mode: 'edit', task: mockTask, onTaskSaved } })
    
    const submitBtn = await screen.findByRole('button', { name: /Submit/ })
    await fireEvent.click(submitBtn)
    
    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith('T-42', 'Existing Task')
      expect(onTaskSaved).toHaveBeenCalled()
    })
  })

  it('shows permission mode dropdown when ai_provider is claude-code', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy() // Mode select
    })
  })

  it('uses the selected opencode agent when starting a task', async () => {
    const onRunAction = vi.fn()
    vi.mocked(getProjectConfig).mockResolvedValue('opencode')
    render(AddTaskDialog, { props: { mode: 'create', onRunAction } })

    const agentSelector = await screen.findByRole('combobox')
    await fireEvent.click(agentSelector)
    await fireEvent.click(await screen.findByRole('option', { name: 'agent-1' }))

    const textbox = await screen.findByRole('textbox')
    await fireEvent.input(textbox, { target: { value: 'Task for agent' } })
    await fireEvent.click(await screen.findByRole('button', { name: /Start Task/ }))

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Task for agent', 'backlog', 'test-project-id', 'agent-1', 'default')
      expect(onRunAction).toHaveBeenCalledWith('T-1', '', 'agent-1')
    })
  })

  it('runs the selected custom action through the shared dialog flow', async () => {
    const onRunAction = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onRunAction } })

    const textbox = await screen.findByRole('textbox')
    await fireEvent.input(textbox, { target: { value: 'Task with action' } })

    const actionButton = await screen.findByRole('button', { name: 'Test Action' })
    await fireEvent.click(actionButton)

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Task with action', 'backlog', 'test-project-id', null, 'default')
      expect(onRunAction).toHaveBeenCalledWith('T-1', 'Do test', null)
    })
  })

  it('calls onRunAction when PromptInput triggers start task', async () => {
    const onRunAction = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onRunAction } })
    
    const textbox = await screen.findByRole('textbox')
    await fireEvent.input(textbox, { target: { value: 'Task to start' } })
    
    const startBtn = await screen.findByRole('button', { name: /Start Task/ })
    await fireEvent.click(startBtn)
    
    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Task to start', 'backlog', 'test-project-id', null, 'default')
      expect(onRunAction).toHaveBeenCalledWith('T-1', '', null)
    })
  })
})
