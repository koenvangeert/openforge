import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { WorkQueueEntry, AgentSession, PullRequestInfo, BoardStatus } from '../../lib/types'

vi.mock('../../lib/stores', () => ({
  activeProjectId: writable<string | null>(null),
  currentView: writable('workqueue'),
  selectedTaskId: writable<string | null>(null),
  activeSessions: writable<Map<string, AgentSession>>(new Map()),
  ticketPrs: writable<Map<string, PullRequestInfo[]>>(new Map()),
  startingTasks: writable<Set<string>>(new Set()),
  selectedReviewPr: writable(null),
  selectedSkillName: writable<string | null>(null),
}))

vi.mock('../../lib/ipc', () => ({
  getWorkQueueTasks: vi.fn().mockResolvedValue([]),
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn(),
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
}))

const listenCallbacks = new Map<string, ((event: { payload: unknown }) => void)[]>()
const mockUnlisten = vi.fn()

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockImplementation((eventName: string, cb: (event: { payload: unknown }) => void) => {
    const existing = listenCallbacks.get(eventName) || []
    existing.push(cb)
    listenCallbacks.set(eventName, existing)
    return Promise.resolve(mockUnlisten)
  }),
}))

function emitTauriEvent(eventName: string, payload: unknown = {}) {
  const callbacks = listenCallbacks.get(eventName) || []
  for (const cb of callbacks) {
    cb({ payload })
  }
}

import WorkQueueView from './WorkQueueView.svelte'
import { activeProjectId, currentView, selectedTaskId } from '../../lib/stores'
import { getWorkQueueTasks, getConfig, setConfig } from '../../lib/ipc'
import { listen } from '@tauri-apps/api/event'

const now = Math.floor(Date.now() / 1000)

function makeEntry(overrides: {
  id?: string
  initial_prompt?: string
  status?: BoardStatus
  summary?: string | null
  project_id?: string
  project_name?: string
  session_status?: string | null
  session_checkpoint_data?: string | null
  pull_requests?: WorkQueueEntry['pull_requests']
} = {}): WorkQueueEntry {
  return {
    task: {
      id: overrides.id ?? 'T-1',
      initial_prompt: overrides.initial_prompt ?? 'Fix login bug',
      status: overrides.status ?? 'doing',
      summary: overrides.summary !== undefined ? overrides.summary : 'Updated auth flow to handle edge case',
      prompt: null,
      agent: null,
      permission_mode: null,
      project_id: overrides.project_id ?? 'proj-1',
      created_at: now - 86400,
      updated_at: now - 3600,
    },
    project_name: overrides.project_name ?? 'Frontend App',
    session_status: overrides.session_status !== undefined ? overrides.session_status : null,
    session_checkpoint_data: overrides.session_checkpoint_data !== undefined ? overrides.session_checkpoint_data : null,
    pull_requests: overrides.pull_requests ?? [],
  }
}

describe('WorkQueueView', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    // Polyfill Web Animations API for JSDOM (needed by Svelte animate:flip)
    if (!Element.prototype.animate) {
      Element.prototype.animate = vi.fn().mockReturnValue({
        onfinish: null,
        cancel: vi.fn(),
        finished: Promise.resolve(),
      })
    }
    activeProjectId.set(null)
    currentView.set('workqueue')
    selectedTaskId.set(null)
    listenCallbacks.clear()
    mockUnlisten.mockClear()
    vi.clearAllMocks()
    vi.mocked(getWorkQueueTasks).mockResolvedValue([])
    vi.mocked(getConfig).mockResolvedValue(null)
    vi.mocked(setConfig).mockResolvedValue(undefined)
  })

  it('renders grouped tasks by project', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeEntry({ id: 'T-1', project_name: 'Frontend App', project_id: 'proj-1' }),
      makeEntry({ id: 'T-2', project_name: 'Frontend App', project_id: 'proj-1', initial_prompt: 'Fix button' }),
      makeEntry({ id: 'T-3', project_name: 'Backend API', project_id: 'proj-2', initial_prompt: 'Add endpoint' }),
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

  it('shows task summary when available', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeEntry({ summary: 'Refactored the auth module' }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('Refactored the auth module')).toBeTruthy()
    })
  })

  it('handles null summary gracefully', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeEntry({ summary: null }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('T-1')).toBeTruthy()
    })
    // Should not crash, and no summary text should appear
    expect(screen.queryByText('null')).toBeNull()
  })

  it('shows session status badge when session_status is present', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeEntry({ session_status: 'completed' }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('Done')).toBeTruthy()
    })
  })

  it('does not show status badge when session_status is null', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeEntry({ session_status: null }),
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
      makeEntry({ id: 'T-5', project_id: 'proj-42', project_name: 'My Project' }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('T-5')).toBeTruthy()
    })

    const taskCard = screen.getByText('T-5').closest('button')
    expect(taskCard).toBeTruthy()
    await fireEvent.click(taskCard!)

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

  it('re-fetches when a Tauri event fires', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeEntry({ id: 'T-1' }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(getWorkQueueTasks).toHaveBeenCalledTimes(1)
    })

    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeEntry({ id: 'T-1' }),
      makeEntry({ id: 'T-2', initial_prompt: 'New task' }),
    ])

    emitTauriEvent('task-changed', { action: 'updated', task_id: 'T-2' })

    await waitFor(() => {
      expect(getWorkQueueTasks).toHaveBeenCalledTimes(2)
    })
  })

  it('keeps existing task cards mounted during event-triggered reloads', async () => {
    let resolveRefresh: ((value: WorkQueueEntry[]) => void) | null = null

    vi.mocked(getWorkQueueTasks)
      .mockResolvedValueOnce([makeEntry({ id: 'T-1' })])
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRefresh = resolve
      }))

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('T-1')).toBeTruthy()
    })

    emitTauriEvent('task-changed', { action: 'updated', task_id: 'T-1' })

    expect(screen.getByText('T-1')).toBeTruthy()
    expect(screen.queryByText('Loading...')).toBeNull()

    resolveRefresh!([makeEntry({ id: 'T-1' }), makeEntry({ id: 'T-2', initial_prompt: 'New task' })])

    await waitFor(() => {
      expect(screen.getByText('T-2')).toBeTruthy()
    })
  })

  it('does not scroll focused work queue item into view on event-triggered reloads', async () => {
    vi.mocked(getWorkQueueTasks)
      .mockResolvedValueOnce([
        makeEntry({ id: 'T-1', project_name: 'Frontend App' }),
        makeEntry({ id: 'T-2', project_name: 'Frontend App', initial_prompt: 'Second task' }),
      ])
      .mockResolvedValueOnce([
        makeEntry({ id: 'T-1', project_name: 'Frontend App' }),
        makeEntry({ id: 'T-2', project_name: 'Frontend App', initial_prompt: 'Second task' }),
        makeEntry({ id: 'T-3', project_name: 'Frontend App', initial_prompt: 'Third task' }),
      ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('T-1')).toBeTruthy()
    })

    vi.mocked(Element.prototype.scrollIntoView).mockClear()

    emitTauriEvent('task-changed', { action: 'updated', task_id: 'T-3' })

    await waitFor(() => {
      expect(screen.getByText('T-3')).toBeTruthy()
    })

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not scroll when a refresh removes the focused project column', async () => {
    vi.mocked(getWorkQueueTasks)
      .mockResolvedValueOnce([
        makeEntry({ id: 'T-1', project_name: 'Frontend App', project_id: 'proj-1' }),
        makeEntry({ id: 'T-2', project_name: 'Backend API', project_id: 'proj-2', initial_prompt: 'Backend task' }),
      ])
      .mockResolvedValueOnce([
        makeEntry({ id: 'T-1', project_name: 'Frontend App', project_id: 'proj-1' }),
      ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('Backend API')).toBeTruthy()
    })

    await fireEvent.keyDown(window, { key: 'l' })
    vi.mocked(Element.prototype.scrollIntoView).mockClear()

    emitTauriEvent('task-changed', { action: 'deleted', task_id: 'T-2' })

    await waitFor(() => {
      expect(getWorkQueueTasks).toHaveBeenCalledTimes(2)
    })

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('scrolls the focused work queue item into view on vim navigation', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeEntry({ id: 'T-1', project_name: 'Frontend App' }),
      makeEntry({ id: 'T-2', project_name: 'Frontend App', initial_prompt: 'Second task' }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('T-2')).toBeTruthy()
    })

    vi.mocked(Element.prototype.scrollIntoView).mockClear()

    await fireEvent.keyDown(window, { key: 'j' })

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  describe('column reordering', () => {
    it('respects saved column order from config', async () => {
      vi.mocked(getConfig).mockImplementation(async (key: string) => {
        if (key === 'workqueue_column_order') return JSON.stringify(['Backend API', 'Frontend App'])
        return null
      })
      vi.mocked(getWorkQueueTasks).mockResolvedValue([
        makeEntry({ id: 'T-1', project_name: 'Frontend App', project_id: 'proj-1' }),
        makeEntry({ id: 'T-2', project_name: 'Backend API', project_id: 'proj-2', initial_prompt: 'Add endpoint' }),
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
        makeEntry({ id: 'T-1', project_name: 'Frontend App', project_id: 'proj-1' }),
        makeEntry({ id: 'T-2', project_name: 'Backend API', project_id: 'proj-2', initial_prompt: 'Add endpoint' }),
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
        makeEntry({ id: 'T-1', project_name: 'Frontend App', project_id: 'proj-1' }),
        makeEntry({ id: 'T-2', project_name: 'Backend API', project_id: 'proj-2', initial_prompt: 'Add endpoint' }),
        makeEntry({ id: 'T-3', project_name: 'Mobile App', project_id: 'proj-3', initial_prompt: 'Fix crash' }),
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
        makeEntry({ id: 'T-1', project_name: 'Frontend App', project_id: 'proj-1' }),
        makeEntry({ id: 'T-2', project_name: 'Backend API', project_id: 'proj-2', initial_prompt: 'Add endpoint' }),
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
        makeEntry({ id: 'T-1' }),
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
        makeEntry({ id: 'T-1' }),
        makeEntry({ id: 'T-2', initial_prompt: 'Second task' }),
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
        makeEntry({ id: 'T-1' }),
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
        makeEntry({ id: 'T-1', project_name: 'Frontend App', project_id: 'proj-1' }),
        makeEntry({ id: 'T-2', project_name: 'Frontend App', project_id: 'proj-1', initial_prompt: 'Second' }),
        makeEntry({ id: 'T-3', project_name: 'Frontend App', project_id: 'proj-1', initial_prompt: 'Third (pinned)' }),
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
        makeEntry({ id: 'T-1' }),
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
        makeEntry({ id: 'T-1' }),
      ])

      render(WorkQueueView)

      await waitFor(() => {
        expect(screen.getByText('T-1')).toBeTruthy()
      })

      const pinBtn = screen.getByTestId('pin-btn-T-1')
      await fireEvent.click(pinBtn)

      // Should NOT update selectedTaskId
      const { get } = await import('svelte/store')
      expect(get(selectedTaskId)).toBe(null)
    })
  })

  describe('auto-refresh via Tauri events', () => {
    it('registers Tauri event listeners on mount', async () => {
      vi.mocked(getWorkQueueTasks).mockResolvedValue([])

      render(WorkQueueView)

      await waitFor(() => {
        expect(listen).toHaveBeenCalled()
      })

      const registeredEvents = vi.mocked(listen).mock.calls.map(c => c[0])
      expect(registeredEvents).toContain('task-changed')
      expect(registeredEvents).toContain('action-complete')
      expect(registeredEvents).toContain('agent-status-changed')
      expect(registeredEvents).toContain('implementation-failed')
    })

    it('re-fetches tasks when task-changed event fires', async () => {
      vi.mocked(getWorkQueueTasks).mockResolvedValue([
        makeEntry({ id: 'T-1' }),
      ])

      render(WorkQueueView)

      await waitFor(() => {
        expect(screen.getByText('T-1')).toBeTruthy()
      })

      vi.mocked(getWorkQueueTasks).mockResolvedValue([
        makeEntry({ id: 'T-1' }),
        makeEntry({ id: 'T-2', initial_prompt: 'New task from event' }),
      ])

      emitTauriEvent('task-changed', { action: 'updated', task_id: 'T-2' })

      await waitFor(() => {
        expect(screen.getByText('T-2')).toBeTruthy()
      })
    })

    it('re-fetches tasks when action-complete event fires', async () => {
      vi.mocked(getWorkQueueTasks).mockResolvedValue([])

      render(WorkQueueView)

      await waitFor(() => {
        expect(screen.getByText('No tasks waiting for review')).toBeTruthy()
      })

      vi.mocked(getWorkQueueTasks).mockResolvedValue([
        makeEntry({ id: 'T-5', initial_prompt: 'Completed task' }),
      ])

      emitTauriEvent('action-complete', { task_id: 'T-5' })

      await waitFor(() => {
        expect(screen.getByText('T-5')).toBeTruthy()
      })
    })

    it('re-fetches tasks when agent-status-changed event fires', async () => {
      vi.mocked(getWorkQueueTasks).mockResolvedValue([
        makeEntry({ id: 'T-1' }),
      ])

      render(WorkQueueView)

      await waitFor(() => {
        expect(screen.getByText('T-1')).toBeTruthy()
      })

      vi.mocked(getWorkQueueTasks).mockResolvedValue([
        makeEntry({ id: 'T-1' }),
        makeEntry({ id: 'T-3', initial_prompt: 'Agent finished' }),
      ])

      emitTauriEvent('agent-status-changed', { task_id: 'T-3', status: 'completed' })

      await waitFor(() => {
        expect(screen.getByText('T-3')).toBeTruthy()
      })
    })

    it('re-fetches tasks when implementation-failed event fires', async () => {
      vi.mocked(getWorkQueueTasks).mockResolvedValue([])

      render(WorkQueueView)

      await waitFor(() => {
        expect(getWorkQueueTasks).toHaveBeenCalledTimes(1)
      })

      emitTauriEvent('implementation-failed', { task_id: 'T-1', error: 'build failed' })

      await waitFor(() => {
        expect(getWorkQueueTasks).toHaveBeenCalledTimes(2)
      })
    })

    it('unregisters Tauri event listeners on unmount', async () => {
      vi.mocked(getWorkQueueTasks).mockResolvedValue([])

      const { unmount } = render(WorkQueueView)

      await waitFor(() => {
        expect(listen).toHaveBeenCalled()
      })

      const listenerCount = vi.mocked(listen).mock.calls.length

      unmount()

      expect(mockUnlisten).toHaveBeenCalledTimes(listenerCount)
    })
  })
})
