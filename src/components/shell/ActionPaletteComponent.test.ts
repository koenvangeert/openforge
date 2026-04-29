import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { PullRequestInfo, Task } from '../../lib/types'

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

function makePullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 42,
    ticket_id: 'T-100',
    repo_owner: 'owner',
    repo_name: 'repo',
    title: 'Ready PR',
    url: 'https://github.com/owner/repo/pull/42',
    state: 'open',
    head_sha: 'abc123',
    ci_status: 'success',
    ci_check_runs: null,
    review_status: 'approved',
    mergeable: true,
    mergeable_state: 'clean',
    merged_at: null,
    created_at: 1000,
    updated_at: 1000,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
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
        taskPrs: [],
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
      taskPrs: [],
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
        taskPrs: [],
        onClose: vi.fn(),
        onExecute: vi.fn(),
      },
    })

    expect(screen.getByText('⌘K')).toBeTruthy()
    expect(screen.getByText('⌘⇧F')).toBeTruthy()
    expect(screen.getByText('⌘⇧P')).toBeTruthy()
  })

  it('shows Merge Pull Request when the selected task has a merge-ready PR', async () => {
    const { default: ActionPalette } = await import('./ActionPalette.svelte')

    render(ActionPalette, {
      props: {
        task: makeTask({ id: 'T-100', status: 'doing' }),
        customActions: [],
        taskPrs: [makePullRequest()],
        onClose: vi.fn(),
        onExecute: vi.fn(),
      },
    })

    expect(screen.getByText('Merge Pull Request')).toBeTruthy()
  })
})
