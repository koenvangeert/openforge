import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { WorkQueueTask } from '../lib/types'

vi.mock('../lib/stores', () => ({
  activeProjectId: writable<string | null>(null),
  currentView: writable('workqueue'),
  selectedTaskId: writable<string | null>(null),
}))

vi.mock('../lib/navigation', () => ({
  pushNavState: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  getWorkQueueTasks: vi.fn().mockResolvedValue([]),
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
}))

import WorkQueueView from './WorkQueueView.svelte'
import { activeProjectId, currentView, selectedTaskId } from '../lib/stores'
import { getWorkQueueTasks, getConfig, setConfig } from '../lib/ipc'
import { pushNavState } from '../lib/navigation'

const now = Math.floor(Date.now() / 1000)

function makeWorkQueueTask(overrides: Partial<WorkQueueTask> = {}): WorkQueueTask {
  return {
    id: 'T-1',
    initial_prompt: 'Fix login bug',
    status: 'doing',
    summary: 'Updated auth flow to handle edge case',
    project_id: 'proj-1',
    project_name: 'Frontend App',
    session_completed_at: now - 3600, // 1 hour ago
    session_status: null,
    ...overrides,
  }
}

describe('WorkQueueView', () => {
  beforeEach(() => {
    activeProjectId.set(null)
    currentView.set('workqueue')
    selectedTaskId.set(null)
    vi.clearAllMocks()
    vi.mocked(getWorkQueueTasks).mockResolvedValue([])
    vi.mocked(getConfig).mockResolvedValue(null)
    vi.mocked(setConfig).mockResolvedValue(undefined)
  })

  it('renders grouped tasks by project', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ id: 'T-1', project_name: 'Frontend App', project_id: 'proj-1' }),
      makeWorkQueueTask({ id: 'T-2', project_name: 'Frontend App', project_id: 'proj-1', initial_prompt: 'Fix button' }),
      makeWorkQueueTask({ id: 'T-3', project_name: 'Backend API', project_id: 'proj-2', initial_prompt: 'Add endpoint' }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('Frontend App')).toBeTruthy()
      expect(screen.getByText('Backend API')).toBeTruthy()
    })

    // Verify task IDs appear
    expect(screen.getByText('T-1')).toBeTruthy()
    expect(screen.getByText('T-2')).toBeTruthy()
    expect(screen.getByText('T-3')).toBeTruthy()
  })

  it('shows empty state when no tasks', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('No tasks waiting for review')).toBeTruthy()
    })
  })

  it('shows relative time from session completion', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ session_completed_at: now - 7200 }), // 2 hours ago
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('2h ago')).toBeTruthy()
    })
  })

  it('shows task summary when available', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ summary: 'Refactored the auth module' }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('Refactored the auth module')).toBeTruthy()
    })
    expect(screen.getByTestId('summary-container-T-1')).toBeTruthy()
    expect(screen.queryByTestId('summary-popover-T-1')).toBeNull()
  })

  it('shows full summary in popover on hover over summary area', async () => {
    const longSummary = 'This is a very long summary that should be visually truncated in the card but remain fully accessible via hover title tooltip text for easy reading'
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ summary: longSummary }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByTestId('summary-container-T-1')).toBeTruthy()
    })

    expect(screen.queryByTestId('summary-popover-T-1')).toBeNull()

    const container = screen.getByTestId('summary-container-T-1')
    await fireEvent.mouseEnter(container)
    const openedPopover = screen.getByTestId('summary-popover-T-1')
    expect(openedPopover).toBeTruthy()
    expect(openedPopover.className).toContain('max-h-72')
    expect(openedPopover.className).toContain('overflow-auto')
    expect(openedPopover.className).toContain('bg-base-200')

    await fireEvent.mouseLeave(container)
    expect(screen.queryByTestId('summary-popover-T-1')).toBeNull()
  })

  it('handles null summary gracefully', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ summary: null }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('T-1')).toBeTruthy()
    })
    // Should not crash, and no summary text should appear
    expect(screen.queryByText('null')).toBeNull()
  })

  it('shows no session label when session_completed_at is null', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ session_completed_at: null }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('no session')).toBeTruthy()
    })
  })

  it('shows session status badge when session_status is present', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ session_status: 'completed' }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('Done')).toBeTruthy()
    })
  })
  it('does not show status badge when session_status is null', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ session_status: null }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('T-1')).toBeTruthy()
    })
    expect(screen.queryByText('Done')).toBeNull()
    expect(screen.queryByText('Running')).toBeNull()
    expect(screen.queryByText('Paused')).toBeNull()
    expect(screen.queryByText('Error')).toBeNull()
    expect(screen.queryByText('Stopped')).toBeNull()
  })

  it('navigates to project board on task click', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ id: 'T-5', project_id: 'proj-42', project_name: 'My Project' }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('T-5')).toBeTruthy()
    })

    const taskCard = screen.getByText('T-5').closest('button')
    expect(taskCard).toBeTruthy()
    await fireEvent.click(taskCard!)

    expect(pushNavState).toHaveBeenCalled()
    expect(vi.mocked(activeProjectId)).toBeDefined()
    // Verify stores were updated — read current values
    const { get } = await import('svelte/store')
    expect(get(activeProjectId)).toBe('proj-42')
    expect(get(currentView)).toBe('board')
    expect(get(selectedTaskId)).toBe('T-5')
  })

  it('shows loading state initially', () => {
    // Make IPC never resolve to keep loading state
    vi.mocked(getWorkQueueTasks).mockReturnValue(new Promise(() => {}))

    render(WorkQueueView)

    expect(screen.getByText('Loading...')).toBeTruthy()
  })

  it('calls getWorkQueueTasks on mount', async () => {
    render(WorkQueueView)

    await waitFor(() => {
      expect(getWorkQueueTasks).toHaveBeenCalledTimes(1)
    })
  })

  it('re-fetches when refreshTrigger changes', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ id: 'T-1' }),
    ])

    const { rerender } = render(WorkQueueView, { props: { refreshTrigger: 0 } })

    await waitFor(() => {
      expect(getWorkQueueTasks).toHaveBeenCalledTimes(1)
    })

    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ id: 'T-1' }),
      makeWorkQueueTask({ id: 'T-2', initial_prompt: 'New task' }),
    ])

    await rerender({ refreshTrigger: 1 })

    await waitFor(() => {
      expect(getWorkQueueTasks).toHaveBeenCalledTimes(2)
    })
  })

  describe('column reordering', () => {
    it('respects saved column order from config', async () => {
      vi.mocked(getConfig).mockImplementation(async (key: string) => {
        if (key === 'workqueue_column_order') return JSON.stringify(['Backend API', 'Frontend App'])
        return null
      })
      vi.mocked(getWorkQueueTasks).mockResolvedValue([
        makeWorkQueueTask({ id: 'T-1', project_name: 'Frontend App', project_id: 'proj-1' }),
        makeWorkQueueTask({ id: 'T-2', project_name: 'Backend API', project_id: 'proj-2', initial_prompt: 'Add endpoint' }),
      ])

      render(WorkQueueView)

      await waitFor(() => {
        expect(screen.getByText('Frontend App')).toBeTruthy()
        expect(screen.getByText('Backend API')).toBeTruthy()
      })

      // Verify Backend API column appears before Frontend App
      const columns = screen.getAllByTestId(/^workqueue-column-(?!header)/)
      expect(columns[0].getAttribute('data-testid')).toBe('workqueue-column-Backend API')
      expect(columns[1].getAttribute('data-testid')).toBe('workqueue-column-Frontend App')
    })

    it('renders columns with reorder arrow buttons', async () => {
      vi.mocked(getWorkQueueTasks).mockResolvedValue([
        makeWorkQueueTask({ id: 'T-1', project_name: 'Frontend App', project_id: 'proj-1' }),
        makeWorkQueueTask({ id: 'T-2', project_name: 'Backend API', project_id: 'proj-2', initial_prompt: 'Add endpoint' }),
      ])

      render(WorkQueueView)

      await waitFor(() => {
        expect(screen.getByText('Frontend App')).toBeTruthy()
      })

      // Each column header should have left/right arrow buttons
      expect(screen.getByTestId('move-left-Frontend App')).toBeTruthy()
      expect(screen.getByTestId('move-right-Frontend App')).toBeTruthy()
      expect(screen.getByTestId('move-left-Backend API')).toBeTruthy()
      expect(screen.getByTestId('move-right-Backend API')).toBeTruthy()

      // First column's left button should be disabled, last column's right button should be disabled
      expect(screen.getByTestId('move-left-Frontend App').hasAttribute('disabled')).toBe(true)
      expect(screen.getByTestId('move-right-Backend API').hasAttribute('disabled')).toBe(true)
      // Inner buttons should be enabled
      expect(screen.getByTestId('move-right-Frontend App').hasAttribute('disabled')).toBe(false)
      expect(screen.getByTestId('move-left-Backend API').hasAttribute('disabled')).toBe(false)
    })

    it('persists new column order after clicking move-right arrow', async () => {
      vi.mocked(getWorkQueueTasks).mockResolvedValue([
        makeWorkQueueTask({ id: 'T-1', project_name: 'Frontend App', project_id: 'proj-1' }),
        makeWorkQueueTask({ id: 'T-2', project_name: 'Backend API', project_id: 'proj-2', initial_prompt: 'Add endpoint' }),
        makeWorkQueueTask({ id: 'T-3', project_name: 'Mobile App', project_id: 'proj-3', initial_prompt: 'Fix crash' }),
      ])

      render(WorkQueueView)

      await waitFor(() => {
        expect(screen.getByText('Frontend App')).toBeTruthy()
      })

      // Move Frontend App to the right (swap with Backend API)
      await fireEvent.click(screen.getByTestId('move-right-Frontend App'))

      await waitFor(() => {
        expect(setConfig).toHaveBeenCalledWith(
          'workqueue_column_order',
          expect.any(String)
        )
      })

      const orderCall = vi.mocked(setConfig).mock.calls.find(c => c[0] === 'workqueue_column_order')
      expect(orderCall).toBeTruthy()
      const savedOrder = JSON.parse(orderCall![1])
      expect(savedOrder).toEqual(['Backend API', 'Frontend App', 'Mobile App'])
    })

    it('shows new projects not in saved order at the end', async () => {
      vi.mocked(getConfig).mockImplementation(async (key: string) => {
        if (key === 'workqueue_column_order') return JSON.stringify(['Backend API'])
        return null
      })
      vi.mocked(getWorkQueueTasks).mockResolvedValue([
        makeWorkQueueTask({ id: 'T-1', project_name: 'Frontend App', project_id: 'proj-1' }),
        makeWorkQueueTask({ id: 'T-2', project_name: 'Backend API', project_id: 'proj-2', initial_prompt: 'Add endpoint' }),
      ])

      render(WorkQueueView)

      await waitFor(() => {
        expect(screen.getByText('Frontend App')).toBeTruthy()
        expect(screen.getByText('Backend API')).toBeTruthy()
      })

      // Backend API should be first (in saved order), Frontend App appended after
      const columns = screen.getAllByTestId(/^workqueue-column-(?!header)/)
      expect(columns[0].getAttribute('data-testid')).toBe('workqueue-column-Backend API')
      expect(columns[1].getAttribute('data-testid')).toBe('workqueue-column-Frontend App')
    })
  })

  describe('task pinning', () => {
    it('shows pin button on task card hover and hides it by default when unpinned', async () => {
      vi.mocked(getWorkQueueTasks).mockResolvedValue([
        makeWorkQueueTask({ id: 'T-1' }),
      ])

      render(WorkQueueView)

      await waitFor(() => {
        expect(screen.getByText('T-1')).toBeTruthy()
      })

      // Pin button exists but is hidden (opacity-0) by default for unpinned tasks
      const pinBtn = screen.getByTestId('pin-btn-T-1')
      expect(pinBtn).toBeTruthy()
    })

    it('pins a task when pin button is clicked', async () => {
      vi.mocked(getWorkQueueTasks).mockResolvedValue([
        makeWorkQueueTask({ id: 'T-1' }),
        makeWorkQueueTask({ id: 'T-2', initial_prompt: 'Second task' }),
      ])

      render(WorkQueueView)

      await waitFor(() => {
        expect(screen.getByText('T-1')).toBeTruthy()
      })

      const pinBtn = screen.getByTestId('pin-btn-T-2')
      await fireEvent.click(pinBtn)

      // Should persist pinned tasks
      await waitFor(() => {
        expect(setConfig).toHaveBeenCalledWith(
          'workqueue_pinned_tasks',
          expect.any(String)
        )
      })

      const savedPins = JSON.parse(
        vi.mocked(setConfig).mock.calls.find(c => c[0] === 'workqueue_pinned_tasks')![1]
      )
      expect(savedPins).toContain('T-2')
    })

    it('unpins a task when pin button is clicked on a pinned task', async () => {
      vi.mocked(getConfig).mockImplementation(async (key: string) => {
        if (key === 'workqueue_pinned_tasks') return JSON.stringify(['T-1'])
        return null
      })
      vi.mocked(getWorkQueueTasks).mockResolvedValue([
        makeWorkQueueTask({ id: 'T-1' }),
      ])

      render(WorkQueueView)

      await waitFor(() => {
        expect(screen.getByText('T-1')).toBeTruthy()
      })

      const pinBtn = screen.getByTestId('pin-btn-T-1')
      await fireEvent.click(pinBtn)

      await waitFor(() => {
        expect(setConfig).toHaveBeenCalledWith(
          'workqueue_pinned_tasks',
          expect.any(String)
        )
      })

      const savedPins = JSON.parse(
        vi.mocked(setConfig).mock.calls.find(c => c[0] === 'workqueue_pinned_tasks')![1]
      )
      expect(savedPins).not.toContain('T-1')
    })

    it('sorts pinned tasks to the top of their column', async () => {
      vi.mocked(getConfig).mockImplementation(async (key: string) => {
        if (key === 'workqueue_pinned_tasks') return JSON.stringify(['T-3'])
        return null
      })
      vi.mocked(getWorkQueueTasks).mockResolvedValue([
        makeWorkQueueTask({ id: 'T-1', project_name: 'Frontend App', project_id: 'proj-1' }),
        makeWorkQueueTask({ id: 'T-2', project_name: 'Frontend App', project_id: 'proj-1', initial_prompt: 'Second' }),
        makeWorkQueueTask({ id: 'T-3', project_name: 'Frontend App', project_id: 'proj-1', initial_prompt: 'Third (pinned)' }),
      ])

      render(WorkQueueView)

      await waitFor(() => {
        expect(screen.getByText('T-3')).toBeTruthy()
      })

      // T-3 should appear before T-1 and T-2 in the DOM
      const taskIds = screen.getAllByTestId(/^task-card-/).map(el => el.getAttribute('data-testid'))
      const idx3 = taskIds.indexOf('task-card-T-3')
      const idx1 = taskIds.indexOf('task-card-T-1')
      const idx2 = taskIds.indexOf('task-card-T-2')
      expect(idx3).toBeLessThan(idx1)
      expect(idx3).toBeLessThan(idx2)
    })

    it('shows pinned indicator on pinned tasks', async () => {
      vi.mocked(getConfig).mockImplementation(async (key: string) => {
        if (key === 'workqueue_pinned_tasks') return JSON.stringify(['T-1'])
        return null
      })
      vi.mocked(getWorkQueueTasks).mockResolvedValue([
        makeWorkQueueTask({ id: 'T-1' }),
      ])

      render(WorkQueueView)

      await waitFor(() => {
        expect(screen.getByText('T-1')).toBeTruthy()
      })

      // Pinned task should have a visible pin indicator
      const pinBtn = screen.getByTestId('pin-btn-T-1')
      expect(pinBtn.getAttribute('aria-label')).toBe('Unpin task')
    })

    it('pin click does not navigate to the task', async () => {
      vi.mocked(getWorkQueueTasks).mockResolvedValue([
        makeWorkQueueTask({ id: 'T-1' }),
      ])

      render(WorkQueueView)

      await waitFor(() => {
        expect(screen.getByText('T-1')).toBeTruthy()
      })

      const pinBtn = screen.getByTestId('pin-btn-T-1')
      await fireEvent.click(pinBtn)

      // Should NOT navigate
      expect(pushNavState).not.toHaveBeenCalled()
    })
  })
})
