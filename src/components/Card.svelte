<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    onclick?: (e: MouseEvent) => void
    onmouseenter?: (e: MouseEvent) => void
    onmouseleave?: (e: MouseEvent) => void
    selected?: boolean
    featured?: boolean
    class?: string
    children: Snippet
  }

  let { onclick, onmouseenter, onmouseleave, selected = false, featured = false, class: className = '', children }: Props = $props()

  let baseClasses = 'w-full text-left bg-base-100 border rounded-box cursor-pointer transition-all'

  let stateClasses = $derived.by(() => {
    if (selected) return 'selected border-2 border-primary bg-primary/10'
    if (featured) return 'border-base-300 shadow-sm'
    return 'border-base-300/50 hover:border-primary/50 hover:shadow-sm'
  })
</script>

<button
  class="{baseClasses} {stateClasses} {className}"
  {onclick}
  {onmouseenter}
  {onmouseleave}
>
  {@render children()}
</button>
