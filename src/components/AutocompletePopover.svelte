<script lang="ts">
  import type { AutocompleteItem } from '../lib/types'

  interface Props {
    items: AutocompleteItem[]
    visible: boolean
    selectedIndex: number
    onSelect: (item: AutocompleteItem) => void
    onClose: () => void
  }

  let { items, visible, selectedIndex, onSelect, onClose }: Props = $props()

  let itemEls = $state<(HTMLElement | null)[]>([])

  $effect(() => {
    const el = itemEls[selectedIndex]
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
    }
  })

  function typeIcon(type: AutocompleteItem['type']): string | undefined {
    switch (type) {
      case 'file': return '📄'
      case 'directory': return '📁'
      case 'agent': return '🤖'
      case 'skill': return '⚡'
      case 'command': return '⌘'
    }
  }
</script>

{#if visible && items.length > 0}
  <div
    class="absolute top-full left-0 right-0 z-50 mt-1 bg-base-100 border border-base-300 shadow-lg rounded-lg overflow-hidden max-h-[320px] overflow-y-auto"
    role="listbox"
    aria-label="Autocomplete suggestions"
    onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
    tabindex="-1"
    >
      {#each items as item, i}
      <button
        type="button"
        bind:this={itemEls[i]}
        role="option"
        aria-selected={i === selectedIndex}
        tabindex="-1"
        class="px-3 py-2 cursor-pointer flex items-center gap-2 hover:bg-base-200 {i === selectedIndex ? 'bg-primary/10 text-primary' : ''}"
        onclick={() => onSelect(item)}
        onmousedown={(e: MouseEvent) => e.preventDefault()}
      >
        <span class="shrink-0 text-base leading-none" aria-hidden="true">{typeIcon(item.type)}</span>
        <span class="flex-1 min-w-0 flex items-baseline gap-2">
          <span class="text-sm font-medium truncate">{item.label}</span>
          {#if item.description}
            <span class="text-xs text-base-content/50 truncate flex-1">{item.description}</span>
          {/if}
        </span>
        {#if item.type === 'command' && item.source}
          <span class="shrink-0 text-[0.6rem] bg-base-200 px-1 rounded text-base-content/50">{item.source}</span>
        {/if}
      </button>
    {/each}
  </div>
{/if}
