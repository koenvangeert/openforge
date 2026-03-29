import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { Task } from '../lib/types'

Element.prototype.scrollIntoView = vi.fn()

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    initial_prompt: 'Test task',
    status: 'backlog',
    prompt: null,
    summary: null,
    agent: null,
    permission_mode: null,
    project_id: null,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

describe('ActionPalette component', () => {
  it('preserves keyboard selection when available actions reorder', async () => {
    const { default: ActionPalette } = await import('./ActionPalette.svelte')
    const onClose = vi.fn()
    const onExecute = vi.fn()
    const task = makeTask({ id: 'T-100', status: 'backlog' })

    const { rerender } = render(ActionPalette, {
      props: {
        task,
        customActions: [],
        onClose,
        onExecute,
      },
    })

    const dialog = screen.getByRole('dialog')
    const actionButtons = screen.getAllByRole('button')
    const searchTasksIndex = actionButtons.findIndex(button => button.textContent?.includes('Search Tasks'))

    expect(searchTasksIndex).toBeGreaterThan(0)

    for (let i = 0; i < searchTasksIndex; i += 1) {
      await fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    }

    await rerender({
      task: makeTask({ id: 'T-100', status: 'done' }),
      customActions: [],
      onClose,
      onExecute,
    })

    await fireEvent.keyDown(dialog, { key: 'Enter' })

    expect(onExecute).toHaveBeenCalledWith('search-tasks')
  })

  it('shows CMD+K as the toggle hint', async () => {
    const { default: ActionPalette } = await import('./ActionPalette.svelte')

    render(ActionPalette, {
      props: {
        task: makeTask({ id: 'T-100', status: 'backlog' }),
        customActions: [],
        onClose: vi.fn(),
        onExecute: vi.fn(),
      },
    })

    expect(screen.getByText('⌘K')).toBeTruthy()
    expect(screen.getByText('⌘⇧F')).toBeTruthy()
    expect(screen.queryByText('⌘⇧P')).toBeNull()
  })
})
