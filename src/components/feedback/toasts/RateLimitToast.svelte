<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { RateLimitNotification } from '../../../lib/types'
  import { rateLimitNotification } from '../../../lib/stores'

  let visible = $state(false)
  let timer: ReturnType<typeof setTimeout>

  function calculateResetTime(resetAt: number | null): string {
    if (!resetAt) return ''
    const now = Math.floor(Date.now() / 1000)
    const secondsUntilReset = resetAt - now
    if (secondsUntilReset <= 0) return 'now'
    const minutes = Math.ceil(secondsUntilReset / 60)
    return `${minutes} min`
  }

  function dismiss() {
    clearTimeout(timer)
    visible = false
    $rateLimitNotification = null
  }

  const unsub = rateLimitNotification.subscribe((notification: RateLimitNotification | null) => {
    clearTimeout(timer)
    if (notification) {
      visible = true
      timer = setTimeout(() => {
        visible = false
        $rateLimitNotification = null
      }, 15000)
    } else {
      visible = false
    }
  })

  onDestroy(() => {
    clearTimeout(timer)
    unsub()
  })
</script>

{#if visible && $rateLimitNotification}
  <div class="toast toast-end z-[200]" style="bottom: 5rem;">
    <div class="alert alert-warning shadow-lg gap-2.5 max-w-[400px] font-semibold text-sm animate-slideIn">
      <span class="flex items-center justify-center w-5 h-5 rounded-full bg-warning-content/20 text-xs font-bold shrink-0">⚠</span>
      <div class="flex-1 flex flex-col gap-1">
        <span>GitHub API rate limited</span>
        {#if $rateLimitNotification.reset_at}
          <span class="text-xs opacity-75">Resets in {calculateResetTime($rateLimitNotification.reset_at)}</span>
        {/if}
      </div>
      <button class="btn btn-ghost btn-xs shrink-0" onclick={(e: MouseEvent) => { e.stopPropagation(); dismiss() }}>✕</button>
    </div>
  </div>
{/if}
