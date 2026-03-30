<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    visible: boolean
    x: number
    y: number
    onClose: () => void
    children: Snippet
  }

  let { visible, x, y, onClose, children }: Props = $props()
</script>

<svelte:window onclick={onClose} />

{#if visible}
  <div
    class="fixed z-[100] bg-base-300 border border-base-300 rounded-lg shadow-xl min-w-[180px] p-1"
    style="left: {x}px; top: {y}px;"
    role="menu"
  >
    {@render children()}
  </div>
{/if}
