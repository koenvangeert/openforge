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
  <div class="toast">
    <span class="toast-message">{message}</span>
    <button class="toast-close" onclick={() => { visible = false; $error = null }}>X</button>
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 200;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--error);
    color: white;
    border-radius: 6px;
    font-size: 0.8rem;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    animation: slideIn 0.2s ease-out;
  }

  @keyframes slideIn {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .toast-message {
    flex: 1;
    max-width: 400px;
    word-break: break-word;
  }

  .toast-close {
    all: unset;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.7rem;
  }

  .toast-close:hover {
    background: rgba(255, 255, 255, 0.2);
  }
</style>
