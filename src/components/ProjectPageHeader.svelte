<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    subtitle: string
    actions?: Snippet
  }

  let { title, subtitle, actions }: Props = $props()
</script>

<div class="flex items-center justify-between px-6 py-3 shrink-0" style="background-color: var(--project-bg-alt, oklch(var(--b2)))">
  <div>
    <h2 class="text-base font-semibold text-base-content m-0">{title}</h2>
    <p class="text-xs text-base-content/50 mt-0.5 m-0">{subtitle}</p>
  </div>
  {#if actions}
    <div class="shrink-0">
      {@render actions()}
    </div>
  {/if}
</div>
