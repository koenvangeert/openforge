import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { Task } from '../lib/types'

Element.prototype.scrollIntoView = vi.fn()

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    initial_prompt: 'Test task',
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

    for (let i = 0; i < 6; i += 1) {
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
})
