<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    onclick?: (e: MouseEvent) => void
    selected?: boolean
    class?: string
    children: Snippet
  }

  let { onclick, selected = false, class: className = '', children }: Props = $props()
</script>

<button
  class="w-full text-left bg-base-100 border rounded cursor-pointer transition-all {selected ? 'selected border-2 border-primary bg-primary/10' : 'border-base-300 hover:border-primary'} {className}"
  {onclick}
>
  {@render children()}
</button>
