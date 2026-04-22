<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    pluginId: string
    pluginName: string
    children?: Snippet
    onDisable?: () => void
    errorMessage?: string | null
  }

  let { pluginId, pluginName, children, onDisable, errorMessage = null }: Props = $props()
</script>

{#if errorMessage}
  <div class="rounded-lg border border-error/20 bg-error/10 p-4" role="alert" data-plugin-id={pluginId}>
    <p class="text-sm font-medium text-error">Plugin Error: {pluginName}</p>
    <p class="mt-1 text-xs text-error/70">{errorMessage}</p>
    {#if onDisable}
      <button class="btn btn-error btn-outline btn-xs mt-2" onclick={onDisable}>
        Disable Plugin
      </button>
    {/if}
  </div>
{:else if children}
  {@render children()}
{/if}
