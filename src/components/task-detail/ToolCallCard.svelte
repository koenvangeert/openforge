<script lang="ts">
  import type { SDKToolCall } from '../../lib/types'

  interface Props {
    toolCall: SDKToolCall
  }

  let { toolCall }: Props = $props()

  let expanded = $state(false)

  function formatJson(str: string): string {
    try {
      return JSON.stringify(JSON.parse(str), null, 2)
    } catch {
      return str
    }
  }

  function toggle() {
    expanded = !expanded
  }
</script>

<div class="border border-base-300 rounded bg-base-100 text-sm">
  <button
    class="w-full flex items-center gap-2 px-3 py-2 hover:bg-base-200 transition-colors text-left"
    onclick={toggle}
    aria-expanded={expanded}
  >
    <span class="text-base-content/40 text-[0.6rem] font-mono select-none leading-none">{expanded ? '▼' : '▶'}</span>

    <span class="font-mono font-semibold text-base-content text-xs flex-1 truncate">{toolCall.toolName}</span>

    {#if toolCall.duration !== null}
      <span class="text-[0.65rem] text-base-content/40 font-mono">{toolCall.duration}ms</span>
    {/if}

    {#if toolCall.status === 'running'}
      <span class="badge badge-info badge-xs">running</span>
    {:else if toolCall.status === 'completed'}
      <span class="badge badge-success badge-xs">done</span>
    {:else if toolCall.status === 'error'}
      <span class="badge badge-error badge-xs">error</span>
    {/if}
  </button>

  {#if expanded}
    <div class="border-t border-base-300">
      <div class="px-3 pt-2 pb-1">
        <div class="text-[0.6rem] font-semibold text-base-content/40 uppercase tracking-wider mb-1">Input</div>
        <pre class="text-xs font-mono bg-base-200 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all"><code>{formatJson(toolCall.input)}</code></pre>
      </div>

      {#if toolCall.output !== null}
        <div class="px-3 pt-1 pb-2">
          <div class="text-[0.6rem] font-semibold text-base-content/40 uppercase tracking-wider mb-1">Output</div>
          <pre class="text-xs font-mono bg-base-200 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all"><code>{formatJson(toolCall.output)}</code></pre>
        </div>
      {:else if toolCall.status === 'running'}
        <div class="px-3 pb-2 flex items-center gap-1.5">
          <span class="loading loading-dots loading-xs text-base-content/40"></span>
          <span class="text-xs text-base-content/40">Waiting for output…</span>
        </div>
      {/if}
    </div>
  {/if}
</div>
