<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import TerminalTabs from './TerminalTabs.svelte'
  import { killPty } from './lib/ipc'
  import { cleanupProjectTerminalTask, getProjectTerminalTaskId } from './lib/projectTerminal'
  import { clearTaskTerminalTabsSession, getTaskTerminalTabsSession, releaseAllForTask } from './lib/terminalPool'
  import { createTerminalShortcutController } from './terminalShortcutController'

  interface Props {
    projectId?: string | null
    projectName?: string
    projectPath?: string
  }

  let { projectId = null, projectName = '', projectPath = '' }: Props = $props()

  const terminalTaskId = $derived(projectId ? getProjectTerminalTaskId(projectId) : null)
  let previousTerminalTaskId = $state<string | null>(null)

  const terminalShortcuts = createTerminalShortcutController({ ignoreWhenDetached: true })

  function cleanupTerminalTask(taskId: string) {
    void cleanupProjectTerminalTask(taskId, {
      getTaskTerminalTabsSession,
      killPty,
      releaseAllForTask,
      clearTaskTerminalTabsSession,
    }).then((result) => {
      for (const failure of result.killFailures) {
        console.error(`[TerminalProjectView] Failed to kill project terminal ${failure.key}:`, failure.error)
      }
    })
  }

  $effect(() => {
    if (previousTerminalTaskId !== null && previousTerminalTaskId !== terminalTaskId) {
      cleanupTerminalTask(previousTerminalTaskId)
    }

    previousTerminalTaskId = terminalTaskId
  })

  onMount(() => terminalShortcuts.registerWindowKeydown())

  onDestroy(() => {
    if (previousTerminalTaskId !== null) {
      cleanupTerminalTask(previousTerminalTaskId)
      previousTerminalTaskId = null
    }
  })
</script>

<div class="flex flex-col h-full min-h-0 overflow-hidden">
  <div class="flex items-center justify-between px-4 py-2 border-b border-base-300 shrink-0 bg-base-200">
    <h2 class="text-sm font-semibold text-base-content">{projectName || 'Project'} — Terminal</h2>
    {#if projectPath}
      <span class="badge badge-neutral badge-sm max-w-[50%] truncate" title={projectPath}>{projectPath}</span>
    {/if}
  </div>

  <div class="flex flex-1 min-h-0 overflow-hidden">
    {#if !projectId}
      <div class="flex-1 flex items-center justify-center text-base-content/50 text-sm p-6 text-center">
        Select a project to open a terminal
      </div>
    {:else if !projectPath}
      <div class="flex-1 flex items-center justify-center text-base-content/50 text-sm p-6 text-center">
        Project path unavailable
      </div>
    {:else if terminalTaskId}
      <div class="flex-1 min-w-0 h-full overflow-hidden">
        {#key terminalTaskId}
          <TerminalTabs
            bind:this={terminalShortcuts.terminalTabsRef}
            taskId={terminalTaskId}
            workspacePath={projectPath}
            onTabChange={null}
            onTabCountChange={null}
          />
        {/key}
      </div>
    {/if}
  </div>
</div>
