<script lang="ts">
  import type { Snippet } from 'svelte'
  import Modal from '../shared/ui/Modal.svelte'

  interface Props {
    onClose: () => void
    onKeydown?: (event: KeyboardEvent) => boolean | void
    ariaLabel: string
    testId?: string
    children: Snippet
  }

  let { onClose, onKeydown, ariaLabel, testId, children }: Props = $props()
</script>

<Modal
  {onClose}
  {onKeydown}
  {ariaLabel}
  {testId}
  showHeader={false}
  maxWidth="520px"
  initialFocus="[data-palette-initial-focus]"
  modalClass="items-start pt-[15vh]"
  boxClass="bg-base-200 border border-base-300 rounded-lg shadow-2xl overflow-hidden"
>
  {@render children()}
</Modal>
