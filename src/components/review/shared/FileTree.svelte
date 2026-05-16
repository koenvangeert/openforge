<script lang="ts">
  import SharedFileTree from '@openforge/pr-review-ui/FileTree.svelte'
  import type { PrFileDiff } from '../../../lib/types'

  interface Props {
    files?: PrFileDiff[]
    onSelectFile: (filename: string) => void
  }

  let { files = [], onSelectFile }: Props = $props()
</script>

<SharedFileTree {files} {onSelectFile} />
