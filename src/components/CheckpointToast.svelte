<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { CheckpointNotification } from '../lib/types'
  import { checkpointNotification } from '../lib/stores'
  import { useAppRouter } from '../lib/router.svelte'

  const router = useAppRouter()

  let visible = $state(false)
  let timer: ReturnType<typeof setTimeout>

  function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + '...' : text
  }

  function handleClick() {
    if ($checkpointNotification) {
      router.navigateToTask($checkpointNotification.ticketId)
      dismiss()
    }
  }

  function dismiss() {
    clearTimeout(timer)
    visible = false
    $checkpointNotification = null
  }

  const unsub = checkpointNotification.subscribe((notification: CheckpointNotification | null) => {
    clearTimeout(timer)
    if (notification) {
      visible = true
      timer = setTimeout(() => {
        visible = false
        $checkpointNotification = null
      }, 8000)
    } else {
      visible = false
    }
  })

  onDestroy(() => {
    clearTimeout(timer)
    unsub()
  })
</script>

{#if visible && $checkpointNotification}
  <div class="toast toast-end z-[200]" style="bottom: 5rem;">
    <div class="alert alert-warning shadow-lg gap-2.5 cursor-pointer max-w-[400px] font-semibold text-sm animate-slideIn"
      onclick={handleClick} role="button" tabindex="0" onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && handleClick()}>
      <span class="flex items-center justify-center w-5 h-5 rounded-full bg-warning-content/20 text-xs font-bold shrink-0">!</span>
      <span class="flex-1 max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap">
        Agent needs input on {$checkpointNotification.ticketKey || truncate($checkpointNotification.ticketId, 20)}
      </span>
      <button class="btn btn-ghost btn-xs shrink-0" onclick={(e: MouseEvent) => { e.stopPropagation(); dismiss() }}>✕</button>
    </div>
  </div>
{/if}

<style>
  @keyframes slideIn {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  :global(.animate-slideIn) {
    animation: slideIn 0.2s ease-out;
  }
</style>
