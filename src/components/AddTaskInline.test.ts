import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddTaskInline from './AddTaskInline.svelte'
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
    project_id: null,
    created_at: 1000,
    updated_at: 1000,
  } as Task),
}))

import { createTask } from '../lib/ipc'

describe('AddTaskInline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders + button in collapsed state', () => {
    render(AddTaskInline, { props: { column: 'todo' } })
    const button = screen.getByRole('button')
    expect(button).toBeTruthy()
    expect(button.getAttribute('title')).toBe('Add task')
  })

  it('shows input when + button is clicked', async () => {
    render(AddTaskInline, { props: { column: 'todo' } })
    const button = screen.getByRole('button')
    await fireEvent.click(button)
    
    await new Promise((r) => setTimeout(r, 10))
    const input = screen.getByPlaceholderText('Task title...')
    expect(input).toBeTruthy()
  })

  it('calls createTask when Enter is pressed with text', async () => {
    render(AddTaskInline, { props: { column: 'todo' } })
    const button = screen.getByRole('button')
    await fireEvent.click(button)
    
    await new Promise((r) => setTimeout(r, 10))
    const input = screen.getByPlaceholderText('Task title...')
    expect(input).toBeTruthy()
  })

  it('calls createTask when Enter is pressed with text', async () => {
    render(AddTaskInline, { props: { column: 'todo' } })
    const button = screen.getByRole('button')
    await fireEvent.click(button)
    
    await new Promise((r) => setTimeout(r, 10))
    const input = screen.getByPlaceholderText('Task title...') as HTMLInputElement
    
    await fireEvent.input(input, { target: { value: 'New task title' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    
    await new Promise((r) => setTimeout(r, 10))
    expect(createTask).toHaveBeenCalledWith('New task title', 'todo', null, null)
  })

  it('collapses without creating when Escape is pressed', async () => {
    render(AddTaskInline, { props: { column: 'in_progress' } })
    const button = screen.getByRole('button')
    await fireEvent.click(button)
    
    await new Promise((r) => setTimeout(r, 10))
    const input = screen.getByPlaceholderText('Task title...')
    
    await fireEvent.input(input, { target: { value: 'Some text' } })
    await fireEvent.keyDown(input, { key: 'Escape' })
    
    await new Promise((r) => setTimeout(r, 10))
    expect(createTask).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('Task title...')).toBeNull()
  })

  it('collapses without creating when input is blurred with no text', async () => {
    render(AddTaskInline, { props: { column: 'todo' } })
    const button = screen.getByRole('button')
    await fireEvent.click(button)
    
    await new Promise((r) => setTimeout(r, 10))
    const input = screen.getByPlaceholderText('Task title...')
    
    await fireEvent.blur(input)
    
    await new Promise((r) => setTimeout(r, 10))
    expect(createTask).not.toHaveBeenCalled()
  })
})
