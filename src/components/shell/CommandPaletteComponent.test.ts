import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { get, writable } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession, Project, Task } from '../../lib/types'

const mockActiveSessions = writable<Map<string, AgentSession>>(new Map())
const mockProjects = writable<Project[]>([])
const mockActiveProjectId = writable<string | null>(null)
const mockCurrentView = writable<'board' | 'pr_review' | 'settings' | 'skills' | 'workqueue'>('board')
const mockSelectedTaskId = writable<string | null>(null)
const mockTasks = writable<Task[]>([])

const mockGetAllTasks = vi.fn<() => Promise<Task[]>>()
const mockGetLatestSessions = vi.fn<(taskIds: string[]) => Promise<AgentSession[]>>()

vi.mock('../../lib/stores', () => ({
  activeSessions: mockActiveSessions,
  projects: mockProjects,
  activeProjectId: mockActiveProjectId,
  currentView: mockCurrentView,
  selectedTaskId: mockSelectedTaskId,
  tasks: mockTasks,
}))

vi.mock('../../lib/ipc', () => ({
  getAllTasks: mockGetAllTasks,
  getLatestSessions: mockGetLatestSessions,
}))

vi.mock('../../lib/router.svelte', () => ({
  pushNavState: vi.fn(),
}))

Element.prototype.scrollIntoView = vi.fn()

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    initial_prompt: 'Test task',
    status: 'doing',
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

function makeSession(taskId: string, status: string): AgentSession {
  return {
    id: `session-${taskId}`,
    ticket_id: taskId,
    opencode_session_id: null,
    stage: 'implementation',
    status,
    checkpoint_data: null,
    error_message: null,
    created_at: 1000,
    updated_at: 1000,
    provider: 'claude-code',
    claude_session_id: null,
  }
}

describe('CommandPalette component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveSessions.set(new Map())
    mockProjects.set([])
    mockActiveProjectId.set(null)
    mockCurrentView.set('board')
    mockSelectedTaskId.set(null)
    mockTasks.set([])
  })

  it('preserves keyboard selection when async session updates re-render the list', async () => {
    const paletteTasks = [
      makeTask({ id: 'T-100', updated_at: 300 }),
      makeTask({ id: 'T-200', updated_at: 200 }),
      makeTask({ id: 'T-300', updated_at: 100 }),
    ]

    mockGetAllTasks.mockResolvedValue(paletteTasks)
    mockGetLatestSessions.mockResolvedValue([])

    const { default: CommandPalette } = await import('./CommandPalette.svelte')
    const onClose = vi.fn()
    render(CommandPalette, { props: { onClose } })

    await waitFor(() => {
      expect(screen.getByText('T-100')).toBeTruthy()
      expect(mockGetAllTasks).toHaveBeenCalledOnce()
      expect(mockGetLatestSessions).toHaveBeenCalledWith(['T-100', 'T-200', 'T-300'])
    })

    const dialog = screen.getByRole('dialog')
    await fireEvent.keyDown(dialog, { key: 'ArrowDown' })

    mockActiveSessions.set(new Map([['T-300', makeSession('T-300', 'paused')]]))

    await fireEvent.keyDown(dialog, { key: 'Enter' })

    expect(get(mockSelectedTaskId)).toBe('T-200')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
