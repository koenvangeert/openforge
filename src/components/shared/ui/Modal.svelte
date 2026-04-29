<script lang="ts">
  import { tick } from 'svelte'
  import type { Snippet } from 'svelte'

  export type ModalInitialFocus = HTMLElement | string | (() => HTMLElement | null | undefined) | null | undefined

  interface Props {
    onClose: () => void
    maxWidth?: string
    overflowVisible?: boolean
    initialFocus?: ModalInitialFocus
    header?: Snippet
    children: Snippet
  }

  let { onClose, maxWidth = '500px', overflowVisible = false, initialFocus, header, children }: Props = $props()

  let modalElement: HTMLDivElement | null = $state(null)
  let hasAppliedInitialFocus = false

  function resolveInitialFocusTarget(): HTMLElement | null {
    if (!modalElement) return null

    if (typeof initialFocus === 'function') {
      return initialFocus() ?? modalElement
    }

    if (typeof initialFocus === 'string') {
      return modalElement.querySelector<HTMLElement>(initialFocus) ?? modalElement
    }

    return initialFocus ?? modalElement
  }

  function focusInitialTarget() {
    resolveInitialFocusTarget()?.focus()

    if (initialFocus !== undefined) {
      void tick().then(() => resolveInitialFocusTarget()?.focus())
    }
  }

  $effect(() => {
    if (!modalElement || hasAppliedInitialFocus) return

    hasAppliedInitialFocus = true
    void focusInitialTarget()
  })

  function handleKeydown(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return

    e.stopPropagation()

    if (e.key === 'Escape') {
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
