import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { createTrackedDebouncedSave } from './createTrackedDebouncedSave'

describe('createTrackedDebouncedSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a promise from schedule that resolves after the debounced save completes', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const trackedSave = createTrackedDebouncedSave({
      delayMs: 500,
      save,
    })

    const completion = trackedSave.schedule()

    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)
    await completion

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flushes a pending debounced save immediately', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const trackedSave = createTrackedDebouncedSave({
      delayMs: 500,
      save,
    })

    trackedSave.schedule()
    const completion = trackedSave.flush()

    expect(save).toHaveBeenCalledTimes(1)

    await completion
    await vi.advanceTimersByTimeAsync(500)

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('returns the same in-flight promise and reruns once when an immediate save happens during a save', async () => {
    let resolveFirstSave: (() => void) | null = null
    const firstSave = new Promise<void>((resolve) => {
      resolveFirstSave = resolve
    })

    const save = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce(undefined)

    const trackedSave = createTrackedDebouncedSave({
      delayMs: 500,
      save,
    })

    const firstCompletion = trackedSave.runImmediately()
    const secondCompletion = trackedSave.runImmediately()

    expect(firstCompletion).toBe(secondCompletion)
    expect(save).toHaveBeenCalledTimes(1)

    resolveFirstSave?.()
    await firstCompletion

    expect(save).toHaveBeenCalledTimes(2)
  })
})
