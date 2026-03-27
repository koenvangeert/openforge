<script lang="ts">
  import { error } from '../lib/stores'

  let visible = $state(false)
  let message = $state('')
  let timer: ReturnType<typeof setTimeout>

  error.subscribe((err) => {
    if (err) {
      message = err
      visible = true
      clearTimeout(timer)
      timer = setTimeout(() => {
        visible = false
        $error = null
      }, 5000)
    }
  })
</script>

{#if visible}
  <div class="toast toast-end toast-bottom z-[200]">
    <div class="alert alert-error shadow-lg gap-3 animate-slideIn">
      <span class="flex-1 max-w-[400px] break-words text-sm">{message}</span>
      <button class="btn btn-ghost btn-xs" onclick={() => { visible = false; $error = null }}>✕</button>
    </div>
  </div>
{/if}
