<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { CheckpointNotification } from '../lib/types'
  import { checkpointNotification, selectedTaskId } from '../lib/stores'

  let visible = $state(false)
  let timer: ReturnType<typeof setTimeout>

  function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + '...' : text
  }

  function handleClick() {
    if ($checkpointNotification) {
      $selectedTaskId = $checkpointNotification.ticketId
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
  <div class="checkpoint-toast" onclick={handleClick} role="button" tabindex="0" onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && handleClick()}>
    <span class="toast-icon">!</span>
    <span class="toast-message">
      Agent needs input on {$checkpointNotification.ticketKey || truncate($checkpointNotification.ticketId, 20)}
    </span>
    <button class="toast-close" onclick={(e: MouseEvent) => { e.stopPropagation(); dismiss() }}>X</button>
  </div>
{/if}

<style>
  .checkpoint-toast {
    position: fixed;
    bottom: 80px;
    right: 20px;
    z-index: 200;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: var(--warning, #e0af68);
    color: #1a1b26;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    animation: slideIn 0.2s ease-out;
    cursor: pointer;
    max-width: 400px;
  }

  @keyframes slideIn {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .toast-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: rgba(26, 27, 38, 0.2);
    font-size: 0.75rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  .toast-message {
    flex: 1;
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .toast-close {
    all: unset;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .toast-close:hover {
    background: rgba(26, 27, 38, 0.2);
  }
</style>
