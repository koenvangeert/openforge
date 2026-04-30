<script lang="ts">
  import AppTaskTerminal from '../../../src/components/task-detail/TaskTerminal.svelte'

  interface Props {
    taskId: string
    workspacePath: string
    terminalKey: string
    terminalIndex: number
    isActive: boolean
    onExit?: () => void
  }

  let props: Props = $props()
</script>

<AppTaskTerminal {...props} />
