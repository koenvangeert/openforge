import { markCommentAddressed } from './ipc'
import type { PrComment } from './types'

// ============================================================================
// Interface
// ============================================================================

export interface CommentSelectionState {
  readonly selectedPrCommentIds: Set<number>
  readonly unaddressedComments: PrComment[]
  readonly unaddressedCount: number
  readonly addressedCount: number
  readonly selectedCount: number
  readonly selectedPrComments: PrComment[]
  toggleSelected(id: number): void
  selectAll(): void
  deselectAll(): void
  markAddressed(commentId: number): Promise<void>
}

// ============================================================================
// Factory
// ============================================================================

export function createCommentSelection(deps: {
  getPrComments: () => PrComment[]
}): CommentSelectionState {
  let selectedPrCommentIds = $state<Set<number>>(new Set())
  let localPrComments = $state<PrComment[]>([])

  // Sync local copy from external source reactively
  $effect(() => {
    localPrComments = deps.getPrComments()
  })

  let unaddressedComments = $derived(localPrComments.filter(c => c.addressed === 0))
  let unaddressedCount = $derived(unaddressedComments.length)
  let addressedCount = $derived(localPrComments.filter(c => c.addressed === 1).length)
  let selectedCount = $derived(selectedPrCommentIds.size)
  let selectedPrComments = $derived(localPrComments.filter(c => selectedPrCommentIds.has(c.id)))

  function toggleSelected(id: number): void {
    const next = new Set(selectedPrCommentIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedPrCommentIds = next
  }

  function selectAll(): void {
    selectedPrCommentIds = new Set(unaddressedComments.map(c => c.id))
  }

  function deselectAll(): void {
    selectedPrCommentIds = new Set()
  }

  async function markAddressed(commentId: number): Promise<void> {
    try {
      await markCommentAddressed(commentId)
      localPrComments = localPrComments.map(c =>
        c.id === commentId ? { ...c, addressed: 1 } : c
      )
      if (selectedPrCommentIds.has(commentId)) {
        const next = new Set(selectedPrCommentIds)
        next.delete(commentId)
        selectedPrCommentIds = next
      }
    } catch (e) {
      console.error('Failed to mark comment addressed:', e)
    }
  }

  return {
    get selectedPrCommentIds() { return selectedPrCommentIds },
    get unaddressedComments() { return unaddressedComments },
    get unaddressedCount() { return unaddressedCount },
    get addressedCount() { return addressedCount },
    get selectedCount() { return selectedCount },
    get selectedPrComments() { return selectedPrComments },
    toggleSelected,
    selectAll,
    deselectAll,
    markAddressed,
  }
}
