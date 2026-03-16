<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { Task, Action } from '../lib/types'
  import { getAvailableActions, filterActions, type PaletteAction } from '../lib/actionPalette'
  import HoverTooltip from './HoverTooltip.svelte'

  interface Props {
    task: Task | null
    customActions: Action[]
    onClose: () => void
    onExecute: (actionId: string) => void
  }

  let { task, customActions, onClose, onExecute }: Props = $props()

  let searchQuery = $state('')
  let selectedIndex = $state(0)
  let inputEl = $state<HTMLInputElement | null>(null)

  let allActions = $derived(getAvailableActions(task, customActions))
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

  $effect(() => {
    // Reset selection when results change
    void filtered.length
    selectedIndex = filtered.length > 0 ? 0 : -1
  })

  function handleKeyDown(e: KeyboardEvent) {
    const count = flatList.length
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }

    if (count === 0) return

    if (e.key === 'ArrowDown' || (e.ctrlKey && (e.key === 'j' || e.key === 'n'))) {
      e.preventDefault()
      selectedIndex = (selectedIndex + 1) % count
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && (e.key === 'k' || e.key === 'p'))) {
      e.preventDefault()
      selectedIndex = selectedIndex <= 0 ? count - 1 : selectedIndex - 1
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (selectedIndex >= 0 && selectedIndex < count) {
        onExecute(flatList[selectedIndex].id)
      }
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  onMount(async () => {
    await tick()
    inputEl?.focus()
  })

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

<div
  data-testid="action-palette-backdrop"
  class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50"
  onclick={handleBackdropClick}
>
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Action palette"
    class="w-full max-w-[520px] bg-base-200 border border-base-300 rounded-lg shadow-2xl overflow-hidden"
    onkeydown={handleKeyDown}
    tabindex="-1"
  >
    <!-- Search input -->
    <div class="p-3 border-b border-base-300">
      <input
        bind:this={inputEl}
        type="text"
        class="input input-sm w-full bg-base-100 border-base-300 focus:outline-none text-base-content placeholder:text-base-content/40 font-mono"
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
          <div class="font-mono text-[10px] text-base-content/40 uppercase tracking-wider px-4 pt-3 pb-1">
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
      <span class="font-mono text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">↑↓</kbd> navigate</span>
      <span class="font-mono text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">Enter</kbd> execute</span>
      <span class="font-mono text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">Esc</kbd> close</span>
      <span class="font-mono text-[10px] text-base-content/40 ml-auto"><kbd class="kbd kbd-xs">⌘⇧P</kbd> toggle</span>
    </div>
  </div>
</div>
