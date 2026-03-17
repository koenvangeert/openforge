<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { Action } from '../lib/types'
  import HoverTooltip from './HoverTooltip.svelte'
  import { ChevronDown } from 'lucide-svelte'

  interface Props {
    actions: Action[]
    disabled?: boolean
    onAction: (action: Action) => void
  }

  let { actions, disabled = false, onAction }: Props = $props()

  let isOpen = $state(false)
  let dropdownRef: HTMLDivElement | null = $state(null)

  let primaryAction = $derived(actions[0])
  let otherActions = $derived(actions.slice(1))

  function toggleDropdown(e: MouseEvent) {
    e.stopPropagation()
    if (disabled) return
    isOpen = !isOpen
  }

  function handlePrimaryClick() {
    if (disabled || !primaryAction) return
    onAction(primaryAction)
  }

  function handleActionClick(action: Action) {
    onAction(action)
    isOpen = false
  }

  function handleClickOutside(e: MouseEvent) {
    if (dropdownRef && !dropdownRef.contains(e.target as Node)) {
      isOpen = false
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isOpen) {
      e.stopPropagation()
      isOpen = false
    }
  }

  onMount(() => {
    document.addEventListener('click', handleClickOutside)
    document.addEventListener('keydown', handleKeydown)
  })

  onDestroy(() => {
    document.removeEventListener('click', handleClickOutside)
    document.removeEventListener('keydown', handleKeydown)
  })
</script>

{#if actions.length === 0}
  <!-- No actions to display -->
{:else if actions.length === 1}
  {#if primaryAction.prompt}
    <HoverTooltip text={primaryAction.prompt} position="left">
      <button
        class="btn btn-soft btn-sm shadow-sm hover:shadow-md hover:btn-primary transition-all duration-200"
        disabled={disabled}
        onclick={handlePrimaryClick}
      >
        {primaryAction.name}
      </button>
    </HoverTooltip>
  {:else}
    <button
      class="btn btn-soft btn-sm shadow-sm hover:shadow-md hover:btn-primary transition-all duration-200"
      disabled={disabled}
      onclick={handlePrimaryClick}
    >
      {primaryAction.name}
    </button>
  {/if}
{:else}
  <div class="relative" bind:this={dropdownRef}>
    <div class="flex items-stretch">
      {#if primaryAction.prompt}
        <HoverTooltip text={primaryAction.prompt} position="left">
          <button
            class="btn btn-soft btn-sm shadow-sm hover:shadow-md hover:btn-primary transition-all duration-200 rounded-r-none border-r-0"
            disabled={disabled}
            onclick={handlePrimaryClick}
          >
            {primaryAction.name}
          </button>
        </HoverTooltip>
      {:else}
        <button
          class="btn btn-soft btn-sm shadow-sm hover:shadow-md hover:btn-primary transition-all duration-200 rounded-r-none border-r-0"
          disabled={disabled}
          onclick={handlePrimaryClick}
        >
          {primaryAction.name}
        </button>
      {/if}
      
      <button
        class="btn btn-soft btn-sm shadow-sm hover:shadow-md hover:btn-primary transition-all duration-200 rounded-l-none px-1.5"
        disabled={disabled}
        onclick={toggleDropdown}
        aria-label="More actions"
        aria-expanded={isOpen}
      >
        <ChevronDown size={14} class="transition-transform duration-200 {isOpen ? 'rotate-180' : ''}" />
      </button>
    </div>

    {#if isOpen}
      <div class="absolute top-[calc(100%+4px)] right-0 min-w-[180px] bg-base-200 border border-base-300 rounded-lg shadow-lg z-[100] overflow-hidden">
        <div class="max-h-[300px] overflow-y-auto py-1">
          {#each otherActions as action (action.id)}
            {#if action.prompt}
              <HoverTooltip text={action.prompt} position="left">
                <button
                  class="flex items-center w-full px-3.5 py-2 cursor-pointer text-sm text-base-content hover:bg-base-300 transition-colors text-left"
                  onclick={() => handleActionClick(action)}
                  type="button"
                >
                  {action.name}
                </button>
              </HoverTooltip>
            {:else}
              <button
                class="flex items-center w-full px-3.5 py-2 cursor-pointer text-sm text-base-content hover:bg-base-300 transition-colors text-left"
                onclick={() => handleActionClick(action)}
                type="button"
              >
                {action.name}
              </button>
            {/if}
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}
