<script lang="ts">
  import type { Task, Action, PullRequestInfo } from '../../lib/types'
  import { getAvailableActions, filterActions, type PaletteAction } from '../../lib/actionPalette'
  import { useListNavigation } from '../../lib/useListNavigation.svelte'
  import HoverTooltip from '../shared/ui/HoverTooltip.svelte'
  import PaletteModal from './PaletteModal.svelte'

  interface Props {
    task: Task | null
    customActions: Action[]
    taskPrs: PullRequestInfo[]
    onClose: () => void
    onExecute: (actionId: string) => void
  }

  let { task, customActions, taskPrs, onClose, onExecute }: Props = $props()

  let searchQuery = $state('')
  let selectedActionId = $state<string | null>(null)

  let allActions = $derived(getAvailableActions(task, customActions, taskPrs))
  let filtered = $derived(filterActions(allActions, searchQuery))

  // Group by category
  type CategoryGroup = { category: string; label: string; actions: PaletteAction[] }
  let grouped = $derived.by((): CategoryGroup[] => {
    const categoryOrder = ['task', 'navigation', 'general'] as const
    const categoryLabels: Record<string, string> = {
      task: 'Task',
      navigation: 'Navigation',
      general: 'General',
    }
    const groups: CategoryGroup[] = []
    for (const cat of categoryOrder) {
      const items = filtered.filter(a => a.category === cat)
      if (items.length > 0) {
        groups.push({ category: cat, label: categoryLabels[cat], actions: items })
      }
    }
    return groups
  })

  // Flat list for keyboard navigation
  let flatList = $derived(grouped.flatMap(g => g.actions))

  let selectedIndex = $derived.by(() => {
    if (flatList.length === 0) return -1
    if (selectedActionId === null) return 0

    const index = flatList.findIndex(action => action.id === selectedActionId)
    return index === -1 ? 0 : index
  })

  let lastSearchQuery = $state('')

  $effect(() => {
    const trimmedSearchQuery = searchQuery.trim()

    if (flatList.length === 0) {
      selectedActionId = null
      lastSearchQuery = trimmedSearchQuery
      return
    }

    const searchChanged = trimmedSearchQuery !== lastSearchQuery
    lastSearchQuery = trimmedSearchQuery

    if (searchChanged || selectedActionId === null) {
      selectedActionId = flatList[0].id
      return
    }

    const selectedActionStillVisible = flatList.some(action => action.id === selectedActionId)

    if (!selectedActionStillVisible) {
      selectedActionId = flatList[0].id
    }
  })

  const listNav = useListNavigation({
    get itemCount() { return flatList.length },
    get selectedIndex() { return selectedIndex },
    set selectedIndex(index: number) {
      if (flatList.length > 0) {
        selectedActionId = flatList[index].id
      }
    },
    wrap: true,
    onSelect() {
      if (selectedIndex >= 0 && selectedIndex < flatList.length) {
        onExecute(flatList[selectedIndex].id)
      }
    },
    onCancel() { onClose() }
  })

  function handleKeyDown(e: KeyboardEvent): boolean {
    return listNav.handleKeydown(e)
  }

  let listContainer: HTMLDivElement | null = $state(null)

  $effect(() => {
    if (listContainer && selectedIndex >= 0) {
      const items = listContainer.querySelectorAll('[data-palette-item]')
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  })

  // Compute flat index for each action to check if highlighted
  function getFlatIndex(action: PaletteAction): number {
    return flatList.indexOf(action)
  }

  function getActionTooltip(action: PaletteAction): string | undefined {
    if (!action.id.startsWith('custom-action-')) return undefined
    const realId = action.id.replace('custom-action-', '')
    return customActions.find(a => a.id === realId)?.prompt
  }
</script>

<PaletteModal
  ariaLabel="Action palette"
  testId="action-palette-backdrop"
  {onClose}
  onKeydown={handleKeyDown}
>
    <!-- Search input -->
    <div class="p-3 border-b border-base-300">
      <input
        data-palette-initial-focus
        type="text"
        class="input input-sm w-full bg-base-100 border-base-300 focus:outline-none text-base-content placeholder:text-base-content/40"
        placeholder="Type an action..."
        bind:value={searchQuery}
      />
    </div>

    <!-- Action list -->
    <div class="max-h-[400px] overflow-y-auto" bind:this={listContainer}>
      {#if flatList.length === 0}
        <div class="px-4 py-6 text-center text-base-content/50 text-sm">
          No actions match your search
        </div>
      {:else}
         {#each grouped as group (group.category)}
           <div class="text-[10px] text-base-content/40 uppercase tracking-wider px-4 pt-3 pb-1">
             {group.label}
           </div>
          {#each group.actions as action (action.id)}
            {@const flatIdx = getFlatIndex(action)}
            {@const isHighlighted = flatIdx === selectedIndex}
            {@const tooltip = getActionTooltip(action)}
            {#if tooltip}
              <HoverTooltip text={tooltip}>
                <button
                  type="button"
                  data-palette-item
                  class="flex items-center gap-3 w-full px-4 py-2 text-left text-sm text-base-content transition-colors
                    {isHighlighted ? 'bg-base-300' : 'hover:bg-base-300/60'}"
                  onclick={() => onExecute(action.id)}
                >
                  <span class="flex-1">{action.label}</span>
                  {#if action.shortcut}
                    <kbd class="kbd kbd-xs bg-base-content/5 text-base-content/40 border-base-content/10">{action.shortcut}</kbd>
                  {/if}
                </button>
              </HoverTooltip>
            {:else}
              <button
                type="button"
                data-palette-item
                class="flex items-center gap-3 w-full px-4 py-2 text-left text-sm text-base-content transition-colors
                  {isHighlighted ? 'bg-base-300' : 'hover:bg-base-300/60'}"
                onclick={() => onExecute(action.id)}
              >
                <span class="flex-1">{action.label}</span>
                {#if action.shortcut}
                  <kbd class="kbd kbd-xs bg-base-content/5 text-base-content/40 border-base-content/10">{action.shortcut}</kbd>
                {/if}
              </button>
            {/if}
          {/each}
        {/each}
      {/if}
    </div>

    <!-- Hints bar -->
     <div class="flex items-center gap-4 px-3 py-1.5 border-t border-base-300 bg-base-300/30">
       <span class="text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">↑↓</kbd> navigate</span>
       <span class="text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">Enter</kbd> execute</span>
       <span class="text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">Esc</kbd> close</span>
       <span class="text-[10px] text-base-content/40 ml-auto"><kbd class="kbd kbd-xs">⌘K</kbd> toggle</span>
     </div>
</PaletteModal>
