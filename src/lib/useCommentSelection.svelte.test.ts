import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushSync } from 'svelte'
import type { PrComment } from './types'

// ============================================================================
// Module Mocks
// ============================================================================

vi.mock('./ipc', () => ({
  markCommentAddressed: vi.fn<(commentId: number) => Promise<void>>(),
}))

import { createCommentSelection } from './useCommentSelection.svelte'
import * as ipc from './ipc'

const mockMarkCommentAddressed = vi.mocked(ipc.markCommentAddressed)

// ============================================================================
// Fixtures
// ============================================================================

const makeComment = (id: number, addressed = 0): PrComment => ({
  id,
  pr_id: 10,
  author: 'reviewer',
  body: `Comment ${id}`,
  comment_type: 'inline',
  file_path: 'src/main.rs',
  line_number: id,
  addressed,
  created_at: 1700000000,
})

// ============================================================================
// Tests
// ============================================================================

describe('createCommentSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarkCommentAddressed.mockResolvedValue(undefined)
  })

  it('starts with empty selection', () => {
    let selection!: ReturnType<typeof createCommentSelection>
    const cleanup = $effect.root(() => {
      selection = createCommentSelection({ getPrComments: () => [] })
    })

    expect(selection.selectedPrCommentIds.size).toBe(0)
    expect(selection.selectedCount).toBe(0)
    expect(selection.unaddressedComments).toEqual([])
    expect(selection.unaddressedCount).toBe(0)
    cleanup()
  })

  it('toggleSelected adds an ID to selection', () => {
    const comments = [makeComment(1), makeComment(2)]
    let selection!: ReturnType<typeof createCommentSelection>
    const cleanup = $effect.root(() => {
      selection = createCommentSelection({ getPrComments: () => comments })
    })
    flushSync()

    selection.toggleSelected(1)
    flushSync()

    expect(selection.selectedPrCommentIds.has(1)).toBe(true)
    expect(selection.selectedCount).toBe(1)
    cleanup()
  })

  it('toggleSelected removes an already-selected ID', () => {
    const comments = [makeComment(1), makeComment(2)]
    let selection!: ReturnType<typeof createCommentSelection>
    const cleanup = $effect.root(() => {
      selection = createCommentSelection({ getPrComments: () => comments })
    })
    flushSync()

    selection.toggleSelected(1)
    flushSync()
    selection.toggleSelected(1)
    flushSync()

    expect(selection.selectedPrCommentIds.has(1)).toBe(false)
    expect(selection.selectedCount).toBe(0)
    cleanup()
  })

  it('selectAll selects all unaddressed comments', () => {
    const comments = [makeComment(1), makeComment(2), makeComment(3, 1)]
    let selection!: ReturnType<typeof createCommentSelection>
    const cleanup = $effect.root(() => {
      selection = createCommentSelection({ getPrComments: () => comments })
    })
    flushSync()

    selection.selectAll()
    flushSync()

    expect(selection.selectedPrCommentIds.has(1)).toBe(true)
    expect(selection.selectedPrCommentIds.has(2)).toBe(true)
    expect(selection.selectedPrCommentIds.has(3)).toBe(false) // addressed
    expect(selection.selectedCount).toBe(2)
    cleanup()
  })

  it('deselectAll clears all selections', () => {
    const comments = [makeComment(1), makeComment(2)]
    let selection!: ReturnType<typeof createCommentSelection>
    const cleanup = $effect.root(() => {
      selection = createCommentSelection({ getPrComments: () => comments })
    })
    flushSync()

    selection.selectAll()
    flushSync()
    selection.deselectAll()
    flushSync()

    expect(selection.selectedPrCommentIds.size).toBe(0)
    expect(selection.selectedCount).toBe(0)
    cleanup()
  })

  it('markAddressed calls IPC with the comment id', async () => {
    const comments = [makeComment(1)]
    let selection!: ReturnType<typeof createCommentSelection>
    const cleanup = $effect.root(() => {
      selection = createCommentSelection({ getPrComments: () => comments })
    })
    flushSync()

    await selection.markAddressed(1)

    expect(mockMarkCommentAddressed).toHaveBeenCalledWith(1)
    cleanup()
  })

  it('markAddressed removes comment from selection', async () => {
    const comments = [makeComment(1), makeComment(2)]
    let selection!: ReturnType<typeof createCommentSelection>
    const cleanup = $effect.root(() => {
      selection = createCommentSelection({ getPrComments: () => comments })
    })
    flushSync()

    selection.toggleSelected(1)
    flushSync()
    await selection.markAddressed(1)
    flushSync()

    expect(selection.selectedPrCommentIds.has(1)).toBe(false)
    cleanup()
  })

  it('markAddressed updates addressed flag — comment moves out of unaddressed', async () => {
    const comments = [makeComment(1), makeComment(2)]
    let selection!: ReturnType<typeof createCommentSelection>
    const cleanup = $effect.root(() => {
      selection = createCommentSelection({ getPrComments: () => comments })
    })
    flushSync()

    expect(selection.unaddressedCount).toBe(2)

    await selection.markAddressed(1)
    flushSync()

    expect(selection.unaddressedCount).toBe(1)
    expect(selection.unaddressedComments.find(c => c.id === 1)).toBeUndefined()
    cleanup()
  })

  it('derived counts update correctly when prComments change', () => {
    let comments = $state<PrComment[]>([makeComment(1), makeComment(2)])
    let selection!: ReturnType<typeof createCommentSelection>
    const cleanup = $effect.root(() => {
      selection = createCommentSelection({ getPrComments: () => comments })
    })
    flushSync()

    expect(selection.unaddressedCount).toBe(2)

    comments = [makeComment(1)]
    flushSync()

    expect(selection.unaddressedCount).toBe(1)
    cleanup()
  })

  it('selectedPrComments returns only selected comments', () => {
    const comments = [makeComment(1), makeComment(2), makeComment(3)]
    let selection!: ReturnType<typeof createCommentSelection>
    const cleanup = $effect.root(() => {
      selection = createCommentSelection({ getPrComments: () => comments })
    })
    flushSync()

    selection.toggleSelected(1)
    selection.toggleSelected(3)
    flushSync()

    expect(selection.selectedPrComments).toHaveLength(2)
    expect(selection.selectedPrComments.map(c => c.id)).toContain(1)
    expect(selection.selectedPrComments.map(c => c.id)).toContain(3)
    cleanup()
  })
})
