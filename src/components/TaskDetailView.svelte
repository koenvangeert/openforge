<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import type { Task, Action } from '../lib/types'
  import { activeSessions, activeProjectId, startingTasks, taskReviewModes, taskTerminalOpen, error } from '../lib/stores'
  import { getWorktreeForTask, updateTaskStatus, getConfig } from '../lib/ipc'
  import { useAppRouter } from '../lib/router.svelte'
  import { moveTaskToComplete } from '../lib/moveToComplete'
  import { isInputFocused } from '../lib/domUtils'
  import { loadActions, getEnabledActions } from '../lib/actions'
  import { commandHeld } from '../lib/stores'
  import { focusTerminal, releaseAllForTask } from '../lib/terminalPool'
  import AgentPanel from './AgentPanel.svelte'
  import TaskInfoPanel from './TaskInfoPanel.svelte'
  import ResizablePanel from './ResizablePanel.svelte'
  import ResizableBottomPanel from './ResizableBottomPanel.svelte'
  import SelfReviewView from './SelfReviewView.svelte'
  import TerminalTabs from './TerminalTabs.svelte'
  import ActionDropdown from './ActionDropdown.svelte'

  interface Props {
    task: Task
    onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { task, onRunAction }: Props = $props()
  const router = useAppRouter()

  let reviewMode = $state(false)
  let bottomPanelOpen = $state(false)
  let terminalFullscreen = $state(false)
  let terminalEverOpened = $state(false)
  let worktreePath = $state<string | null>(null)
  let jiraBaseUrl = $state('')
  let lastTaskId = ''
  let actions = $state<Action[]>([])
  let terminalTabsRef = $state<TerminalTabs | null>(null)

  let displayTitle = $derived(task.initial_prompt || (task.prompt ? task.prompt.split('\n')[0] : '') || task.id)

  function setReviewMode(value: boolean) {
    reviewMode = value
    const updated = new Map(get(taskReviewModes) as Map<string, boolean>)
    updated.set(task.id, value)
    taskReviewModes.set(updated)
  }

  function setBottomPanelOpen(value: boolean) {
    bottomPanelOpen = value
    const updated = new Map(get(taskTerminalOpen) as Map<string, boolean>)
    updated.set(task.id, value)
    taskTerminalOpen.set(updated)
  }

  let currentSession = $derived($activeSessions.get(task.id))
  let agentStatus = $derived(currentSession?.status ?? null)
  let isStarting = $derived($startingTasks.has(task.id))

  $effect(() => {
    const taskId = task.id
    if (taskId !== lastTaskId) {
      lastTaskId = taskId
      reviewMode = (get(taskReviewModes) as Map<string, boolean>).get(taskId) ?? false
      const wasOpen = (get(taskTerminalOpen) as Map<string, boolean>).get(taskId) ?? false
      bottomPanelOpen = wasOpen
      terminalFullscreen = false
      terminalEverOpened = wasOpen
      worktreePath = null
      getWorktreeForTask(taskId).then((worktree) => {
        worktreePath = worktree?.worktree_path ?? null
      })
    }
  })

  $effect(() => {
    if ($activeProjectId) {
      loadActions($activeProjectId).then(a => { actions = getEnabledActions(a) })
    }
  })

  $effect(() => {
    if (bottomPanelOpen) terminalEverOpened = true
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

  onMount(async () => {
    jiraBaseUrl = (await getConfig('jira_base_url')) || ''
  })

  function handleBack() {
    router.resetToBoard()
  }

  async function handleStatusChange(newStatus: string) {
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
    if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyJ') {
      e.preventDefault()
      if (terminalFullscreen) { terminalFullscreen = false; return }
      setBottomPanelOpen(!bottomPanelOpen)
      return
    }

    if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyT') {
      e.preventDefault()
      if (!bottomPanelOpen) setBottomPanelOpen(true)
      return
    }

    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyF' && bottomPanelOpen && !reviewMode) {
      e.preventDefault()
      terminalFullscreen = !terminalFullscreen
      return
    }

    if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && worktreePath !== null) {
      if (e.code === 'Digit1') {
        e.preventDefault()
        setReviewMode(false)
        return
      }
      if (e.code === 'Digit2') {
        e.preventDefault()
        setReviewMode(true)
        return
      }
    }

    if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key === 'e') {
      e.preventDefault()
      setReviewMode(false)
      terminalFullscreen = false
      if (!bottomPanelOpen) setBottomPanelOpen(true)
      if (terminalTabsRef) {
        terminalTabsRef.focusActiveTab()
      } else {
        focusTerminal(`${task.id}-shell-0`)
      }
      return
    }

    if (e.key === 'Escape' && terminalFullscreen) {
      e.preventDefault()
      terminalFullscreen = false
      return
    }

    if (isInputFocused()) return
    if (e.metaKey || e.ctrlKey || e.altKey) return

    if (e.key === 'Escape' || e.key === 'q') {
      e.preventDefault()
      handleBack()
      return
    }
    if (e.key === 'h' && worktreePath !== null) {
      e.preventDefault()
      setReviewMode(false)
      return
    }
    if (e.key === 'l' && worktreePath !== null) {
      e.preventDefault()
      setReviewMode(true)
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
       <span class="text-[0.8125rem] font-semibold text-primary font-mono shrink-0">{task.jira_key || task.id}</span>
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
      <span class="text-primary font-semibold">{task.jira_key || task.id}</span>
      <span class="text-base-content/20 mx-1">/</span>
      <span class="text-primary font-semibold">{reviewMode ? 'self_review' : 'code'}</span>
    </div>
    {#if worktreePath !== null}
       <div class="flex items-center gap-1">
        <button
            class="btn btn-ghost btn-xs gap-1.5 {!reviewMode ? 'text-primary border border-primary' : 'text-base-content/50 border border-base-300'}"
            onclick={() => setReviewMode(false)}
           >code_view {#if $commandHeld}<kbd class="kbd kbd-xs opacity-50">⌘1</kbd>{/if}</button>
          <button
            class="btn btn-ghost btn-xs gap-1.5 {reviewMode ? 'text-primary border border-primary' : 'text-base-content/50 border border-base-300'}"
            onclick={() => setReviewMode(true)}
           >review_view {#if $commandHeld}<kbd class="kbd kbd-xs opacity-50">⌘2</kbd>{/if}</button>
       </div>
    {/if}
  </div>

  <div class="flex flex-col flex-1 overflow-hidden">
    <!-- Upper area: hidden when fullscreen -->
    {#if !(terminalFullscreen && bottomPanelOpen)}
      <div data-testid="upper-area" class="flex flex-1 overflow-hidden max-[800px]:flex-col">
        {#if reviewMode}
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
                <TaskInfoPanel task={task} {worktreePath} {jiraBaseUrl} />
              </div>
            </div>
          </ResizablePanel>
        {/if}
      </div>
    {/if}

    <!-- Bottom panel: stays mounted once opened so tabs survive ⌘J toggle -->
    {#if terminalEverOpened && worktreePath !== null}
      <div class="{bottomPanelOpen ? (terminalFullscreen ? 'flex flex-col flex-1 min-h-0' : 'shrink-0') : 'hidden'}">
        <ResizableBottomPanel storageKey="terminal-panel-height" defaultHeight={300} minHeight={100} maxHeight={null} fillParent={terminalFullscreen}>
          <TerminalTabs
            bind:this={terminalTabsRef}
            taskId={task.id}
            {worktreePath}
            isFullscreen={terminalFullscreen}
            onFullscreenToggle={() => { terminalFullscreen = !terminalFullscreen }}
            onTabChange={null}
            onTabCountChange={null}
          />
        </ResizableBottomPanel>
      </div>
    {/if}
  </div>
</div>
