import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./ipc', () => ({
  writePty: vi.fn().mockResolvedValue(undefined),
}))

import { writePtyWithSubmit } from './ptySubmit'

describe('writePtyWithSubmit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  it('writes text and \\r as separate writePty calls', async () => {
    const { writePty } = await import('./ipc')

    const promise = writePtyWithSubmit('task-1', 'hello world')
    await vi.advanceTimersByTimeAsync(100)
    await promise

    expect(writePty).toHaveBeenCalledTimes(2)
    expect(writePty).toHaveBeenNthCalledWith(1, 'task-1', 'hello world')
    expect(writePty).toHaveBeenNthCalledWith(2, 'task-1', '\r')
  })

  it('sends \\r after a delay so the terminal processes text first', async () => {
    const { writePty } = await import('./ipc')
    const callTimestamps: number[] = []
    vi.mocked(writePty).mockImplementation(async () => {
      callTimestamps.push(Date.now())
    })

    const promise = writePtyWithSubmit('task-2', 'multi\nline\nprompt')

    // First call should happen immediately
    await vi.advanceTimersByTimeAsync(0)
    expect(writePty).toHaveBeenCalledTimes(1)
    expect(writePty).toHaveBeenCalledWith('task-2', 'multi\nline\nprompt')

    // Second call should happen after the delay
    await vi.advanceTimersByTimeAsync(100)
    await promise
    expect(writePty).toHaveBeenCalledTimes(2)
    expect(writePty).toHaveBeenNthCalledWith(2, 'task-2', '\r')

    // Verify there was a time gap between calls
    expect(callTimestamps[1] - callTimestamps[0]).toBeGreaterThan(0)
  })

  it('does not concatenate \\r with the text', async () => {
    const { writePty } = await import('./ipc')

    const promise = writePtyWithSubmit('task-3', 'some prompt')
    await vi.advanceTimersByTimeAsync(100)
    await promise

    // The text write should NOT contain \r
    const firstCallArgs = vi.mocked(writePty).mock.calls[0]
    expect(firstCallArgs[1]).not.toContain('\r')

    // The submit write should be ONLY \r
    const secondCallArgs = vi.mocked(writePty).mock.calls[1]
    expect(secondCallArgs[1]).toBe('\r')
  })
})
