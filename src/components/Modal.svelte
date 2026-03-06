<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    onClose: () => void
    maxWidth?: string
    overflowVisible?: boolean
    header?: Snippet
    children: Snippet
  }

  let { onClose, maxWidth = '500px', overflowVisible = false, header, children }: Props = $props()

  let modalElement: HTMLDivElement | null = $state(null)

  $effect(() => {
    if (modalElement) {
      modalElement.focus()
    }
  })

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }
</script>

<div bind:this={modalElement} class="modal modal-open" onclick={handleOverlayClick} onkeydown={handleKeydown} role="dialog" aria-modal="true" tabindex="-1">
  <div class="modal-box bg-base-100 shadow-xl p-0 flex flex-col max-h-[90vh] {overflowVisible ? 'overflow-visible' : ''}" style="max-width: {maxWidth}">
    <div class="flex items-center justify-between px-5 py-4 border-b border-base-300">
      {#if header}
        {@render header()}
      {/if}
      <button class="btn btn-ghost btn-xs shrink-0" onclick={onClose} type="button">✕</button>
    </div>
    {@render children()}
  </div>
</div>
