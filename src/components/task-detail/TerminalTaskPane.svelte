<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { getTaskWorkspace } from '../../lib/ipc'
  import { handleTerminalShortcutKeydown } from '../../lib/terminalShortcuts'
  import TerminalTabs from './TerminalTabs.svelte'
  import { registerTerminalTaskPaneController, unregisterTerminalTaskPaneController } from './terminalTaskPaneController'

  interface Props {
    taskId: string
  }

  let { taskId }: Props = $props()
  let workspacePath = $state<string | null>(null)
  let previousTaskId = $state<string | null>(null)
  let terminalTabsRef = $state<TerminalTabs | null>(null)

  const controller = {
    addTab() {
      terminalTabsRef?.addTab()
    },
    async closeActiveTab() {
      await terminalTabsRef?.closeActiveTab()
    },
    focusActiveTab() {
      terminalTabsRef?.focusActiveTab()
    },
    switchToTab(tabIndex: number) {
      terminalTabsRef?.switchToTab(tabIndex)
    },
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    handleTerminalShortcutKeydown(event, controller)
  }

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

  onMount(() => {
    window.addEventListener('keydown', handleWindowKeydown, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleWindowKeydown, { capture: true })
    }
  })

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
