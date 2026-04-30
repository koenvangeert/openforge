<script lang="ts">
  import SharedTerminalTaskPane from '@openforge/terminal-shared/TerminalTaskPane.svelte'

  interface Props {
    taskId: string
  }

  let props: Props = $props()
</script>

<SharedTerminalTaskPane {...props} />
