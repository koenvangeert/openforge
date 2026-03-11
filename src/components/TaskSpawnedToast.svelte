<script lang="ts">
  import { taskSpawned } from '../lib/stores'

  let visible = $state(false)
  let message = $state('')
  let timer: ReturnType<typeof setTimeout>

  taskSpawned.subscribe((data) => {
    if (data) {
      message = `New task created: ${data.initial_prompt}`
      visible = true
      clearTimeout(timer)
      timer = setTimeout(() => {
        visible = false
        $taskSpawned = null
      }, 5000)
    }
  })
</script>

{#if visible}
  <div class="toast toast-end toast-bottom z-[200]">
    <div role="alert" class="alert alert-success shadow-lg gap-3 animate-slideIn">
      <span class="flex-1 max-w-[400px] break-words text-sm">{message}</span>
      <button class="btn btn-ghost btn-xs" onclick={() => { visible = false; $taskSpawned = null }}>✕</button>
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
