<script lang="ts">
  import { tick } from 'svelte'
  import { useListNavigation } from '../../../lib/useListNavigation.svelte'

  interface Option {
    value: string
    label: string
  }

  interface Props {
    options: Option[]
    value: string
    placeholder?: string
    size?: 'xs' | 'sm' | 'md'
    onSelect: (value: string) => void
  }

  let { options, value, placeholder = 'Search...', size = 'sm', onSelect }: Props = $props()

  let query = $state('')
  let open = $state(false)
  let highlightedIndex = $state(0)
  let inputEl = $state<HTMLInputElement | null>(null)
  let listEl = $state<HTMLUListElement | null>(null)
  const listboxId = `searchable-select-listbox-${Math.random().toString(36).slice(2)}`

  let selectedLabel = $derived(options.find(o => o.value === value)?.label ?? '')

  let filtered = $derived.by(() => {
    const q = query.toLowerCase().trim()
    if (!q) return options
    return options.filter(o => o.label.toLowerCase().includes(q))
  })

  $effect(() => {
    filtered; // subscribe
    highlightedIndex = 0
  })

  $effect(() => {
    if (open && listEl) {
      const el = listEl.children[highlightedIndex] as HTMLElement | undefined
      el?.scrollIntoView?.({ block: 'nearest' })
    }
  })

  function openDropdown() {
    query = ''
    open = true
    highlightedIndex = 0
    tick().then(() => inputEl?.focus())
  }

  function closeDropdown() {
    open = false
    query = ''
  }

  function selectOption(opt: Option) {
    onSelect(opt.value)
    closeDropdown()
  }

  const listNav = useListNavigation({
    get itemCount() { return filtered.length },
    get selectedIndex() { return highlightedIndex },
    set selectedIndex(index: number) { highlightedIndex = index },
    wrap: false,
    onSelect() {
      const opt = filtered[highlightedIndex]
      if (opt) selectOption(opt)
    },
    onCancel() { closeDropdown() }
  })

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return
    const handled = listNav.handleKeydown(e)
    if (handled) return
  }
</script>

<div class="relative">
  <!-- Trigger: styled like a native daisyUI select -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="select select-{size} w-full cursor-pointer"
    onclick={openDropdown}
    onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openDropdown() } }}
    role="combobox"
    aria-controls={listboxId}
    aria-expanded={open}
    tabindex="0"
  >
    {selectedLabel || placeholder}
  </div>

  <!-- Dropdown -->
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div role="presentation" class="fixed inset-0 z-40" onclick={closeDropdown}></div>
    <div class="absolute z-50 mt-1 left-0 right-0 bg-base-100 border border-base-300 rounded-lg shadow-lg overflow-hidden">
      <div class="p-1.5 border-b border-base-200">
        <input
          bind:this={inputEl}
          type="text"
          class="input input-sm w-full"
          placeholder="Search..."
          bind:value={query}
          onkeydown={handleKeydown}
        />
      </div>
      <ul
        id={listboxId}
        bind:this={listEl}
        class="max-h-[200px] overflow-y-auto py-1"
        role="listbox"
      >
        {#each filtered as opt, i (opt.value)}
          <li
            role="option"
            aria-selected={i === highlightedIndex}
            tabindex="-1"
            class="px-3 py-1.5 text-sm cursor-pointer transition-colors
              {i === highlightedIndex ? 'bg-primary text-primary-content' : 'hover:bg-base-200'}
              {opt.value === value && i !== highlightedIndex ? 'font-medium text-primary' : ''}"
            onclick={() => selectOption(opt)}
            onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectOption(opt) } }}
            onmouseenter={() => { highlightedIndex = i }}
          >
            {opt.label}
          </li>
        {:else}
          <li class="px-3 py-2 text-xs text-base-content/40">No matches</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
