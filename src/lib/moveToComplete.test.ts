import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockUpdateTaskStatus, mockResetToBoard, mockErrorStore } = vi.hoisted(() => {
  const mockUpdateTaskStatus = vi.fn()
  const mockResetToBoard = vi.fn()
  const mockErrorStore = { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() }
  return { mockUpdateTaskStatus, mockResetToBoard, mockErrorStore }
})

vi.mock('./ipc', () => ({
  updateTaskStatus: mockUpdateTaskStatus,
}))

vi.mock('./router.svelte', () => ({
  resetToBoard: mockResetToBoard,
  useAppRouter: () => ({ resetToBoard: mockResetToBoard }),
}))

vi.mock('./stores', () => ({
  error: mockErrorStore,
}))

import { moveTaskToComplete } from './moveToComplete'

describe('moveTaskToComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateTaskStatus.mockResolvedValue(undefined)
  })

  it('calls resetToBoard immediately (before updateTaskStatus resolves)', async () => {
    let resolveUpdate!: () => void
    mockUpdateTaskStatus.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveUpdate = resolve }),
    )

    const p = moveTaskToComplete('T-1')

    expect(mockResetToBoard).toHaveBeenCalledTimes(1)
    expect(mockUpdateTaskStatus).toHaveBeenCalledWith('T-1', 'done')

    resolveUpdate()
    await p
  })

  it('calls resetToBoard before updateTaskStatus (order check)', async () => {
    const callOrder: string[] = []
    mockResetToBoard.mockImplementation(() => { callOrder.push('resetToBoard') })
    mockUpdateTaskStatus.mockImplementation(async () => { callOrder.push('updateTaskStatus') })

    await moveTaskToComplete('T-2')

    expect(callOrder).toEqual(['resetToBoard', 'updateTaskStatus'])
  })

  it('sets error store with cleanup message when updateTaskStatus rejects', async () => {
    mockUpdateTaskStatus.mockRejectedValueOnce(new Error('cleanup exploded'))

    await moveTaskToComplete('T-3')

    expect(mockErrorStore.set).toHaveBeenCalledWith(
      'Task completion may have succeeded, but background cleanup failed.',
    )
  })

  it('does NOT set error store on success', async () => {
    await moveTaskToComplete('T-4')
    expect(mockErrorStore.set).not.toHaveBeenCalled()
  })

  it('still calls resetToBoard even when updateTaskStatus will reject', async () => {
    mockUpdateTaskStatus.mockRejectedValueOnce(new Error('fail'))

    await moveTaskToComplete('T-5')

    expect(mockResetToBoard).toHaveBeenCalledTimes(1)
  })

  it('passes the correct taskId to updateTaskStatus', async () => {
    await moveTaskToComplete('PROJ-999')
    expect(mockUpdateTaskStatus).toHaveBeenCalledWith('PROJ-999', 'done')
  })

  it('skips resetToBoard when resetToBoard is false', async () => {
    await moveTaskToComplete('T-6', { resetToBoard: false })

    expect(mockResetToBoard).not.toHaveBeenCalled()
    expect(mockUpdateTaskStatus).toHaveBeenCalledWith('T-6', 'done')
  })
})
