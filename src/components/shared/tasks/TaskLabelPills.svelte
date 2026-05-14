<script lang="ts">
  import type { TaskLabel } from '../../../lib/types'

  interface Props {
    labels: TaskLabel[]
    max?: number
  }

  let { labels, max = 999 }: Props = $props()

  let visibleLabels = $derived(labels.slice(0, max))
  let hiddenCount = $derived(Math.max(0, labels.length - visibleLabels.length))

  function badgeClass(color: TaskLabel['color']): string {
    switch (color) {
      case 'primary': return 'badge-primary'
      case 'secondary': return 'badge-secondary'
      case 'accent': return 'badge-accent'
      case 'info': return 'badge-info'
      case 'success': return 'badge-success'
      case 'warning': return 'badge-warning'
      case 'error': return 'badge-error'
    }
  }
</script>

{#if labels.length > 0}
  <div class="flex flex-wrap gap-1" aria-label="Task labels">
    {#each visibleLabels as label (label.id)}
      <span class="badge badge-sm {badgeClass(label.color)} badge-outline max-w-full truncate">{label.name}</span>
    {/each}
    {#if hiddenCount > 0}
      <span class="badge badge-sm badge-ghost">+{hiddenCount}</span>
    {/if}
  </div>
{/if}
