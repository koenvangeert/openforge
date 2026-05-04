<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { getTaskWorkspace } from '../../lib/ipc'
  import { createTerminalShortcutController } from '../../lib/terminalShortcutController'
  import TerminalTabs from './TerminalTabs.svelte'
  import { registerTerminalTaskPaneController, unregisterTerminalTaskPaneController } from './terminalTaskPaneController'

  interface Props {
    taskId: string
  }

  let { taskId }: Props = $props()
  let workspacePath = $state<string | null>(null)
  let previousTaskId = $state<string | null>(null)

  const terminalShortcuts = createTerminalShortcutController()
  const controller = terminalShortcuts.controller
  let terminalTabsRef = $state<TerminalTabs | null>(null)

  $effect(() => {
    terminalShortcuts.terminalTabsRef = terminalTabsRef
  })

  $effect(() => {
    if (taskId === previousTaskId) {
      return
    }

    if (previousTaskId !== null) {
      unregisterTerminalTaskPaneController(previousTaskId, controller)
    }

    previousTaskId = taskId
    workspacePath = null
    registerTerminalTaskPaneController(taskId, controller)

    void getTaskWorkspace(taskId).then((workspace) => {
      workspacePath = workspace?.workspace_path ?? null
    })
  })

  onMount(() => terminalShortcuts.registerWindowKeydown())

  onDestroy(() => {
    unregisterTerminalTaskPaneController(taskId, controller)
  })
</script>

{#if workspacePath !== null}
  <div class="flex flex-col flex-1 overflow-hidden h-full">
    <TerminalTabs
      bind:this={terminalTabsRef}
      taskId={taskId}
      {workspacePath}
      onTabChange={null}
      onTabCountChange={null}
    />
  </div>
{/if}
