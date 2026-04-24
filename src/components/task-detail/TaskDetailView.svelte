<script lang="ts">
  import { onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import { activeProjectId, activeSessions, commandHeld, error, startingTasks, taskActiveView } from '../../lib/stores'
  import { getTaskWorkspace, updateTaskStatus } from '../../lib/ipc'
  import { useAppRouter } from '../../lib/router.svelte'
  import { moveTaskToComplete } from '../../lib/moveToComplete'
  import { isInputFocused } from '../../lib/domUtils'
  import { loadActions, getEnabledActions } from '../../lib/actions'
  import PluginSlot from '../plugin/PluginSlot.svelte'
  import { resolveContributions } from '../../lib/plugin/contributionResolver'
  import type { ResolvedTab } from '../../lib/plugin/contributionResolver'
  import { enabledPluginIds, installedPlugins } from '../../lib/plugin/pluginStore'
  import { TERMINAL_PLUGIN_ID } from '../../lib/terminalPlugin'
  import type { PluginManifest } from '../../lib/plugin/types'
  import { useShortcutRegistry } from '../../lib/shortcuts.svelte'
  import { focusTerminal, releaseAllForTask } from '../../lib/terminalPool'
  import type { Action, BoardStatus, Task } from '../../lib/types'
  import AgentPanel from './AgentPanel.svelte'
  import TaskInfoPanel from './TaskInfoPanel.svelte'
  import ResizablePanel from '../shared/ui/ResizablePanel.svelte'
  import SelfReviewView from './SelfReviewView.svelte'
  import ActionDropdown from '../shared/ui/ActionDropdown.svelte'
  import { getTerminalTaskPaneController } from './terminalTaskPaneController'

  interface Props {
    task: Task
    onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { task, onRunAction }: Props = $props()
  const router = useAppRouter()

  let activeView = $state('code')
  let workspacePath = $state<string | null>(null)
  let lastTaskId = ''
  let actions = $state<Action[]>([])
  const taskShortcuts = useShortcutRegistry()

  let displayTitle = $derived(task.initial_prompt || (task.prompt ? task.prompt.split('\n')[0] : '') || task.id)
  let enabledPluginManifests = $derived(
    Array.from($enabledPluginIds)
      .map((id) => $installedPlugins.get(id)?.manifest)
      .filter((manifest): manifest is PluginManifest => manifest !== undefined)
  )
  let pluginTaskPaneTabs = $derived(resolveContributions(enabledPluginManifests).taskPaneTabs)
  let sortedTaskPaneTabs = $derived([...pluginTaskPaneTabs].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)))
  let terminalTaskPaneTab = $derived(
    sortedTaskPaneTabs.find((tab) => tab.pluginId === TERMINAL_PLUGIN_ID && tab.contributionId === 'terminal') ?? null
  )

  function findTaskPaneTab(viewId: string): ResolvedTab | null {
    return sortedTaskPaneTabs.find((tab) => tab.namespacedId === viewId) ?? null
  }

  function isPluginTaskPaneView(viewId: string): boolean {
    return findTaskPaneTab(viewId) !== null
  }

  function normalizeStoredActiveView(viewId: string): string {
    if (viewId === 'code' || viewId === 'review') {
      return viewId
    }

    const namespacedMatch = findTaskPaneTab(viewId)
    if (namespacedMatch !== null) {
      return namespacedMatch.namespacedId
    }

    const legacyMatch = sortedTaskPaneTabs.find((tab) => tab.contributionId === viewId)
    return legacyMatch?.namespacedId ?? 'code'
  }

  function setActiveView(view: string) {
    activeView = view
    const updated = new Map(get(taskActiveView) as Map<string, string>)
    updated.set(task.id, view)
    taskActiveView.set(updated)
  }

  let currentSession = $derived($activeSessions.get(task.id))
  let agentStatus = $derived(currentSession?.status ?? null)
  let isStarting = $derived($startingTasks.has(task.id))

  $effect(() => {
    const taskId = task.id
    if (taskId !== lastTaskId) {
      lastTaskId = taskId
      const stored = (get(taskActiveView) as Map<string, string>).get(taskId) ?? 'code'
      activeView = normalizeStoredActiveView(stored)
      workspacePath = null
      getTaskWorkspace(taskId).then((workspace) => {
        workspacePath = workspace?.workspace_path ?? null
        if (activeView !== 'code' && activeView !== 'review' && workspacePath === null) {
          activeView = 'code'
        }
      })
    }
  })

  $effect(() => {
    if ($activeProjectId) {
      loadActions($activeProjectId).then(a => { actions = getEnabledActions(a) })
    }
  })

  $effect(() => {
    if (workspacePath !== null) {
      taskShortcuts.register('⌘1', () => {
        setActiveView('code')
      })
      taskShortcuts.register('⌘2', () => {
        setActiveView('review')
      })

      if (terminalTaskPaneTab !== null) {
        taskShortcuts.register('⌘3', () => {
          setActiveView(terminalTaskPaneTab.namespacedId)
        })
        taskShortcuts.register('⌘t', () => {
          const controller = getTerminalTaskPaneController(task.id)
          if (activeView === terminalTaskPaneTab.namespacedId && controller) {
            controller.addTab()
            return
          }
          setActiveView(terminalTaskPaneTab.namespacedId)
        })
        taskShortcuts.register('⌘e', () => {
          setActiveView(terminalTaskPaneTab.namespacedId)
          const controller = getTerminalTaskPaneController(task.id)
          if (controller) {
            controller.focusActiveTab()
          } else {
            focusTerminal(`${task.id}-shell-0`)
          }
        })
        taskShortcuts.register('⌘w', () => {
          if (activeView !== terminalTaskPaneTab.namespacedId) return
          void getTerminalTaskPaneController(task.id)?.closeActiveTab()
        })
      }
    }

    return () => {
      taskShortcuts.unregister('⌘1')
      taskShortcuts.unregister('⌘2')
      taskShortcuts.unregister('⌘3')
      taskShortcuts.unregister('⌘t')
      taskShortcuts.unregister('⌘e')
      taskShortcuts.unregister('⌘w')
    }
  })

  let prevTerminalTaskId: string | null = null

  $effect(() => {
    const taskId = task.id
    if (prevTerminalTaskId !== null && prevTerminalTaskId !== taskId) {
      releaseAllForTask(prevTerminalTaskId)
    }
    prevTerminalTaskId = taskId
  })

  onDestroy(() => {
    if (prevTerminalTaskId) {
      releaseAllForTask(prevTerminalTaskId)
    }
  })

  function handleBack() {
    router.resetToBoard()
  }

  async function handleStatusChange(newStatus: BoardStatus) {
    if (newStatus === task.status) return
    if (newStatus === 'done') {
      await moveTaskToComplete(task.id)
      return
    }

    try {
      await updateTaskStatus(task.id, newStatus)
    } catch (e) {
      console.error('Failed to update status:', e)
      $error = String(e)
    }
  }

  function handleActionClick(action: Action) {
    onRunAction({ taskId: task.id, actionPrompt: action.prompt, agent: null })
  }

  function handleSendToAgent(prompt: string) {
    onRunAction({ taskId: task.id, actionPrompt: prompt, agent: null })
  }

  function handleTaskDetailKeydown(e: KeyboardEvent) {
    if (terminalTaskPaneTab !== null && activeView === terminalTaskPaneTab.namespacedId && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey) {
      const match = e.code.match(/^Digit([1-9])$/)
      if (match) {
        e.preventDefault()
        getTerminalTaskPaneController(task.id)?.switchToTab(Number(match[1]) - 1)
        return
      }
    }

    taskShortcuts.handleKeydown(e)
    if (e.defaultPrevented) {
      return
    }

    if (isInputFocused()) return

    if (e.metaKey || e.ctrlKey || e.altKey) return

    if (e.key === 'Escape' || e.key === 'q') {
      e.preventDefault()
      handleBack()
      return
    }
    if (e.key === 'h' && workspacePath !== null) {
      e.preventDefault()
      setActiveView('code')
      return
    }
    if (e.key === 'l' && workspacePath !== null) {
      e.preventDefault()
      setActiveView('review')
      return
    }
  }

</script>

<svelte:window onkeydown={handleTaskDetailKeydown} />

<div class="flex flex-col flex-1 h-full bg-base-100 overflow-hidden">
    <header class="flex flex-col border-b border-base-300 shrink-0" style="background-color: var(--project-bg-alt, oklch(var(--b2)))">
      <div class="flex items-center gap-3 px-6 py-3.5">
        <button class="btn btn-ghost btn-sm text-sm text-secondary border border-base-300 shrink-0 px-2.5 h-7" onclick={handleBack}>
          <span aria-hidden="true">&lt; </span><span>back</span>
        </button>
        <span class="text-base-content/20 select-none">|</span>
        <span class="text-[0.8125rem] font-semibold text-primary font-mono shrink-0">{task.id}</span>
        <h1 class="text-lg font-semibold text-base-content m-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap min-w-0" title={displayTitle}>{displayTitle}</h1>
        {#if task.status === 'backlog'}
          <button
            class="btn btn-primary btn-sm shrink-0 shadow-sm hover:shadow-md transition-shadow"
            disabled={isStarting}
            onclick={() => onRunAction({ taskId: task.id, actionPrompt: '', agent: null })}
          >
            {#if isStarting}
              <span class="loading loading-spinner loading-xs"></span>
              Starting...
            {:else}
              Start Task
            {/if}
          </button>
          {#if actions.length > 0}
            <ActionDropdown {actions} disabled={isStarting} onAction={handleActionClick} />
          {/if}
        {:else if task.status === 'doing'}
          <button
            class="btn btn-success btn-sm shrink-0 shadow-sm hover:shadow-md transition-shadow"
            onclick={() => handleStatusChange('done')}
          >
            Move to Done
          </button>
          {#if actions.length > 0}
            <ActionDropdown {actions} disabled={isStarting} onAction={handleActionClick} />
          {/if}
        {/if}
      </div>
    </header>

    <div class="flex items-center justify-between h-10 px-6 border-b border-base-300 shrink-0">
      <div class="flex items-center gap-1 font-mono text-xs">
        <span class="text-base-content/50">$ cd board</span>
        <span class="text-base-content/20 mx-1">/</span>
        <span class="text-base-content/50">{task.status}</span>
        <span class="text-base-content/20 mx-1">/</span>
        <span class="text-primary font-semibold">{task.id}</span>
        <span class="text-base-content/20 mx-1">/</span>
         <span class="text-primary font-semibold">{activeView === 'review' ? 'self_review' : findTaskPaneTab(activeView)?.title.toLowerCase().replace(/\s+/g, '_') ?? activeView}</span>
      </div>
      {#if workspacePath !== null}
        <div class="flex items-center gap-1">
          <button
            class="btn btn-ghost btn-xs gap-1.5 {activeView === 'code' ? 'text-primary border border-primary' : 'text-base-content/50 border border-base-300'}"
            onclick={() => setActiveView('code')}
          >code_view {#if $commandHeld}<kbd class="kbd kbd-xs opacity-50">⌘1</kbd>{/if}</button>
          <button
            class="btn btn-ghost btn-xs gap-1.5 {activeView === 'review' ? 'text-primary border border-primary' : 'text-base-content/50 border border-base-300'}"
            onclick={() => setActiveView('review')}
          >review_view {#if $commandHeld}<kbd class="kbd kbd-xs opacity-50">⌘2</kbd>{/if}</button>
          {#each sortedTaskPaneTabs as tab (tab.namespacedId)}
            <button
              class="btn btn-ghost btn-xs gap-1.5 {activeView === tab.namespacedId ? 'text-primary border border-primary' : 'text-base-content/50 border border-base-300'}"
              onclick={() => setActiveView(tab.namespacedId)}
            >{tab.title}{#if $commandHeld && terminalTaskPaneTab?.namespacedId === tab.namespacedId}<kbd class="kbd kbd-xs opacity-50">⌘3</kbd>{/if}</button>
          {/each}
        </div>
      {/if}
    </div>

  <div class="flex flex-col flex-1 overflow-hidden">
    {#if activeView === 'code' || activeView === 'review'}
      <div data-testid="upper-area" class="flex flex-1 overflow-hidden max-[800px]:flex-col">
        {#if activeView === 'review'}
          <SelfReviewView {task} {agentStatus} onSendToAgent={handleSendToAgent} />
        {:else}
          <div class="relative flex-1 p-5 overflow-hidden max-[800px]:p-4">
            {#key task.id}
              <AgentPanel taskId={task.id} {isStarting} />
            {/key}
            {#if $commandHeld}
              <kbd class="kbd kbd-xs absolute top-2 right-2 bg-base-content/10 text-base-content/40 border-base-content/20 text-[0.55rem] min-w-4 h-4 flex items-center justify-center pointer-events-none z-10">E</kbd>
            {/if}
          </div>
          <ResizablePanel storageKey="task-detail-sidebar" defaultWidth={360} minWidth={200} maxWidth={600} side="right">
            <div class="overflow-hidden bg-base-200 border-l border-base-300 flex flex-col h-full">
              <div class="flex-1 overflow-y-auto">
                <TaskInfoPanel task={task} {workspacePath} />
              </div>
            </div>
          </ResizablePanel>
        {/if}
      </div>
    {/if}

    {#if activeView !== 'code' && activeView !== 'review' && isPluginTaskPaneView(activeView) && workspacePath !== null}
      <div class="flex flex-col flex-1 overflow-hidden">
        <PluginSlot
          slotType="taskPaneTabs"
          slotId={activeView}
          taskId={task.id}
          projectId={$activeProjectId}
        />
      </div>
    {/if}
  </div>
</div>
