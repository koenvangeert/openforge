<script lang="ts">
  import Modal from './Modal.svelte'

  interface Props {
    onClose: () => void
    initialFocusTarget?: 'dialog' | 'primary-button' | 'input-selector' | 'missing-selector'
  }

  let { onClose, initialFocusTarget = 'dialog' }: Props = $props()
  let primaryButton: HTMLButtonElement | null = $state(null)

  let initialFocus = $derived.by(() => {
    if (initialFocusTarget === 'primary-button') return () => primaryButton
    if (initialFocusTarget === 'input-selector') return '[data-testid="modal-input"]'
    if (initialFocusTarget === 'missing-selector') return '[data-testid="missing-control"]'
    return undefined
  })
</script>

<Modal {onClose} {initialFocus}>
  <p>Test content</p>
  <button bind:this={primaryButton} type="button">Primary action</button>
  <input data-testid="modal-input" aria-label="Modal input" />
</Modal>
