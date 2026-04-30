<script lang="ts">
  import AppTerminalTaskPane from '../../../src/components/task-detail/TerminalTaskPane.svelte'

  interface Props {
    taskId: string
  }

  let props: Props = $props()
</script>

<AppTerminalTaskPane {...props} />
