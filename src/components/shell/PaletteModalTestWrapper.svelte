<script lang="ts">
  import PaletteModal from './PaletteModal.svelte'

  interface Props {
    onClose: () => void
    onKeydown?: (event: KeyboardEvent) => boolean | void
    testId?: string
  }

  let { onClose, onKeydown, testId = 'palette-modal-backdrop' }: Props = $props()
</script>

<PaletteModal ariaLabel="Test palette" {onClose} {onKeydown} {testId}>
  <input data-palette-initial-focus aria-label="Palette search" />
  <button type="button">Palette action</button>
</PaletteModal>
