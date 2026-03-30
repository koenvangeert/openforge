<script lang="ts">
  import Modal from './Modal.svelte'

  interface Props {
    onClose: () => void
  }

  let { onClose }: Props = $props()
</script>

<Modal {onClose}>
  <p>Test content</p>
</Modal>
