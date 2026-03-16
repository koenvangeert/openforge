<script lang="ts">
  import HoverTooltip from './HoverTooltip.svelte'

  interface Props {
    label: string
    onclick: (e: MouseEvent) => void
    variant?: 'default' | 'primary' | 'danger'
    description?: string
  }

  let { label, onclick, variant = 'default', description }: Props = $props()

  let variantClasses = $derived(
    variant === 'primary'
      ? 'text-primary font-medium hover:bg-primary hover:text-primary-content'
      : variant === 'danger'
        ? 'text-error hover:bg-error hover:text-error-content'
        : 'text-base-content hover:bg-primary hover:text-primary-content'
  )
</script>

{#if description}
  <HoverTooltip text={description}>
    <button
      class="context-item block w-full text-left px-3 py-2 text-sm cursor-pointer rounded {variantClasses}"
      {onclick}
      role="menuitem"
    >
      {label}
    </button>
  </HoverTooltip>
{:else}
  <button
    class="context-item block w-full text-left px-3 py-2 text-sm cursor-pointer rounded {variantClasses}"
    {onclick}
    role="menuitem"
  >
    {label}
  </button>
{/if}
