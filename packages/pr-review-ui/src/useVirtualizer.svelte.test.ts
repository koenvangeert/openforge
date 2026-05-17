import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createVirtualizer } from './useVirtualizer.svelte'

// Mock @tanstack/virtual-core
const mockScrollToIndex = vi.fn()
const mockMeasureElement = vi.fn()
const mockSetOptions = vi.fn()
const mockWillUpdate = vi.fn()
const mockDidMount = vi.fn().mockReturnValue(() => {})
const mockGetVirtualItems = vi.fn().mockReturnValue([])
const mockGetTotalSize = vi.fn().mockReturnValue(0)

vi.mock('@tanstack/virtual-core', () => {
  const MockVirtualizer = vi.fn(function (this: Record<string, unknown>) {
    this.getVirtualItems = mockGetVirtualItems
    this.getTotalSize = mockGetTotalSize
    this.scrollToIndex = mockScrollToIndex
    this.measureElement = mockMeasureElement
    this.setOptions = mockSetOptions
    this._willUpdate = mockWillUpdate
    this._didMount = mockDidMount
  })

  return {
    Virtualizer: MockVirtualizer,
    observeElementRect: vi.fn(),
    observeElementOffset: vi.fn(),
    elementScroll: vi.fn(),
  }
})

describe('createVirtualizer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetVirtualItems.mockReturnValue([])
    mockGetTotalSize.mockReturnValue(0)
    mockDidMount.mockReturnValue(() => {})
  })

  it('returns empty virtualItems when count is 0', () => {
    let v!: ReturnType<typeof createVirtualizer>
    const cleanup = $effect.root(() => {
      v = createVirtualizer({
        getCount: () => 0,
        getScrollElement: () => null,
        estimateSize: () => 300,
      })
    })

    expect(v.virtualItems).toEqual([])
    expect(v.totalSize).toBe(0)
    cleanup()
  })

  it('scrollToIndex delegates to inner virtualizer', () => {
    let v!: ReturnType<typeof createVirtualizer>
    const cleanup = $effect.root(() => {
      v = createVirtualizer({
        getCount: () => 10,
        getScrollElement: () => null,
        estimateSize: () => 300,
      })
    })

    v.scrollToIndex(5, { align: 'start' })
    expect(mockScrollToIndex).toHaveBeenCalledWith(5, { align: 'start' })
    cleanup()
  })

  it('when disabled, returns items for all indices', () => {
    let v!: ReturnType<typeof createVirtualizer>
    const cleanup = $effect.root(() => {
      v = createVirtualizer({
        getCount: () => 3,
        getScrollElement: () => null,
        estimateSize: () => 300,
        getEnabled: () => false,
      })
    })

    const items = v.virtualItems
    expect(items).toHaveLength(3)
    expect(items[0].index).toBe(0)
    expect(items[1].index).toBe(1)
    expect(items[2].index).toBe(2)
    cleanup()
  })

  it('measureAction returns an object with destroy', () => {
    let v!: ReturnType<typeof createVirtualizer>
    const cleanup = $effect.root(() => {
      v = createVirtualizer({
        getCount: () => 1,
        getScrollElement: () => null,
        estimateSize: () => 300,
      })
    })

    const node = document.createElement('div')
    const action = v.measureAction(node)
    expect(action).toHaveProperty('destroy')
    expect(typeof action.destroy).toBe('function')
    cleanup()
  })
})
