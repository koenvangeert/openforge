import { describe, it, expect, vi, beforeEach } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

import { createTask, getAllTasks, getWorkQueueTasks, spawnShellPty } from './ipc'

describe('ipc spawnShellPty', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(7)
  })

  it('sends terminalIndex in the invoke payload for shell tabs', async () => {
    await spawnShellPty('T-42', '/tmp/worktree', 80, 24, 1)

    expect(invokeMock).toHaveBeenCalledWith('pty_spawn_shell', {
      taskId: 'T-42',
      cwd: '/tmp/worktree',
      cols: 80,
      rows: 24,
      terminalIndex: 1,
    })
  })

  it('normalizes legacy board statuses in task responses', async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: 'T-1',
        initial_prompt: 'Legacy task',
        status: 'todo',
        prompt: null,
        summary: null,
        agent: null,
        permission_mode: null,
        project_id: null,
        created_at: 1000,
        updated_at: 1000,
      },
    ])

    await expect(getAllTasks()).resolves.toEqual([
      expect.objectContaining({ id: 'T-1', status: 'backlog' }),
    ])
  })

  it('rejects unknown task statuses from the backend boundary', async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: 'T-2',
        initial_prompt: 'Broken task',
        status: 'wat',
        prompt: null,
        summary: null,
        agent: null,
        permission_mode: null,
        project_id: null,
        created_at: 1000,
        updated_at: 1000,
      },
    ])

    await expect(getAllTasks()).rejects.toThrow('Invalid board status: wat')
  })

  it('normalizes task status inside work queue responses', async () => {
    invokeMock.mockResolvedValueOnce([
      {
        task: {
          id: 'T-3',
          initial_prompt: 'Queue task',
          status: 'in_progress',
          prompt: null,
          summary: null,
          agent: null,
          permission_mode: null,
          project_id: null,
          created_at: 1000,
          updated_at: 1000,
        },
        project_name: 'Test Project',
        session_status: null,
        session_checkpoint_data: null,
        pull_requests: [],
      },
    ])

    await expect(getWorkQueueTasks()).resolves.toEqual([
      expect.objectContaining({
        task: expect.objectContaining({ id: 'T-3', status: 'doing' }),
      }),
    ])
  })

  it('normalizes createTask responses before returning to the UI', async () => {
    invokeMock.mockResolvedValueOnce({
      id: 'T-4',
      initial_prompt: 'Created task',
      status: 'testing',
      prompt: null,
      summary: null,
      agent: null,
      permission_mode: null,
      project_id: null,
      created_at: 1000,
      updated_at: 1000,
    })

    await expect(
      createTask('Created task', 'doing', null, null, null),
    ).resolves.toEqual(expect.objectContaining({ id: 'T-4', status: 'doing' }))
  })
})
