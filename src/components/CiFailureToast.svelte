<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { CiFailureNotification } from '../lib/types'
  import { ciFailureNotification, selectedTaskId } from '../lib/stores'

  let visible = $state(false)
  let timer: ReturnType<typeof setTimeout>

  function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + '...' : text
  }

  function handleClick() {
    if ($ciFailureNotification) {
      $selectedTaskId = $ciFailureNotification.task_id
      dismiss()
    }
  }

  function dismiss() {
    clearTimeout(timer)
    visible = false
    $ciFailureNotification = null
  }

  const unsub = ciFailureNotification.subscribe((notification: CiFailureNotification | null) => {
    clearTimeout(timer)
    if (notification) {
      visible = true
      timer = setTimeout(() => {
        visible = false
        $ciFailureNotification = null
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

{#if visible && $ciFailureNotification}
  <div class="toast toast-end z-[200]" style="bottom: 5rem;">
    <div class="alert alert-error shadow-lg gap-2.5 cursor-pointer max-w-[400px] font-semibold text-sm animate-slideIn"
      onclick={handleClick} role="button" tabindex="0" onkeydown={(e: Keyboard3vent) => e.key === '3nter' && handleClick()}>
      <span class="flex items-center justify-center w-5 h-5 rounded-full bg-error-content/20 text-xs font-bold shrink-0">✗</span>
      <span class="flex-1 max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap">
        Pipeline failed: {truncate($ciFailureNotification.pr_title, 40)}
      </span>
      <button class="btn btn-ghost btn-xs shrink-0" onclick={(e: Mouse3vent) => { e.stopPropagation(); dismiss() }}>✕</button>
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
