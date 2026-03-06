<script lang="ts">
  import type { Task, AgentSession, KanbanColumn, Action } from '../lib/types'
  import { COLUMNS, COLUMN_LABELS } from '../lib/types'
  import { tasks, selectedTaskId, activeSessions, ticketPrs, error, activeProjectId, searchQuery } from '../lib/stores'
  import { updateTaskStatus, deleteTask, clearDoneTasks } from '../lib/ipc'
  import { pushNavState } from '../lib/navigation'
  import { loadActions, getEnabledActions } from '../lib/actions'
  import TaskCard from './TaskCard.svelte'
  import Modal from './Modal.svelte'

  interface Props {
    onRunAction?: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { onRunAction }: Props = $props()

  // Column visibility state
  let showBacklog = $state(true)
  let showDoneDrawer = $state(false)

  function toggleBacklog() {
    showBacklog = !showBacklog
  }

  function toggleDoneDrawer() {
    showDoneDrawer = !showDoneDrawer
  }

  function isInputFocused(): boolean {
    const active = document.activeElement
    if (!active) return false
    const tagName = active.tagName.toLowerCase()
    return tagName === 'input' || tagName === 'textarea' || (active as HTMLElement).isContentEditable
  }

  function handleBoardKeydown(e: KeyboardEvent) {
    // Plain key shortcuts (only when not typing in input)
    if (!isInputFocused()) {
      // b — toggle backlog
      if (e.key === 'b' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        toggleBacklog()
        return
      }
      // c — toggle done drawer
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        toggleDoneDrawer()
        return
      }
    }
  }

  function matchesSearch(task: Task, query: string): boolean {
    if (!query) return true
    const q = query.toLowerCase()
    return (
      task.id.toLowerCase().includes(q) ||
      task.title.toLowerCase().includes(q) ||
      (task.jira_key?.toLowerCase().includes(q) ?? false) ||
      (task.jira_title?.toLowerCase().includes(q) ?? false) ||
      (task.jira_assignee?.toLowerCase().includes(q) ?? false)
    )
  }

  let filteredTasks = $derived(
    $searchQuery ? $tasks.filter(t => matchesSearch(t, $searchQuery)) : $tasks
  )

  function tasksForColumn(allTasks: Task[], column: KanbanColumn): Task[] {
    return allTasks.filter(t => t.status === column)
  }

  let backlogTasks = $derived(tasksForColumn(filteredTasks, 'backlog'))
  let doingTasks = $derived(tasksForColumn(filteredTasks, 'doing'))
  let doneTasks = $derived(tasksForColumn(filteredTasks, 'done'))

  function getSession(sessions: Map<string, AgentSession>, taskId: string): AgentSession | null {
    return sessions.get(taskId) || null
  }

  function handleSelect(taskId: string) {
    pushNavState()
    $selectedTaskId = taskId
  }

  let contextMenu = $state({ visible: false, x: 0, y: 0, taskId: '', showMoveSubmenu: false })
  let actions = $state<Action[]>([])
  
  $effect(() => {
    if ($activeProjectId) {
      loadActions($activeProjectId).then(a => { actions = getEnabledActions(a) })
    }
  })

  let contextSession = $derived(contextMenu.taskId ? $activeSessions.get(contextMenu.taskId) : null)
  let isSessionBusy = $derived(contextSession?.status === 'running' || contextSession?.status === 'paused')
  let busyReason = $derived(contextSession?.status === 'running' ? 'Agent is busy' : contextSession?.status === 'paused' ? 'Answer pending question first' : '')

  function handleContextMenu(event: MouseEvent, taskId: string) {
    event.preventDefault()
    contextMenu = { visible: true, x: event.clientX, y: event.clientY, taskId, showMoveSubmenu: false }
  }

  function closeContextMenu() {
    contextMenu = { ...contextMenu, visible: false, showMoveSubmenu: false }
  }

  function toggleMoveSubmenu() {
    contextMenu = { ...contextMenu, showMoveSubmenu: !contextMenu.showMoveSubmenu }
  }

  function handleRunAction(action: Action) {
    const taskId = contextMenu.taskId
    closeContextMenu()
    onRunAction?.({ taskId, actionPrompt: action.prompt, agent: action.agent ?? null })
  }

  async function handleMoveTo(column: KanbanColumn) {
    const taskId = contextMenu.taskId
    closeContextMenu()
    try {
      await updateTaskStatus(taskId, column)
    } catch (err: unknown) {
      console.error('Failed to move task:', err)
      $error = String(err)
    }
  }

  async function handleDelete() {
    const taskId = contextMenu.taskId
    closeContextMenu()
    try {
      await deleteTask(taskId)
      if ($selectedTaskId === taskId) {
        $selectedTaskId = null
      }
    } catch (err: unknown) {
      console.error('Failed to delete task:', err)
      $error = String(err)
    }
  }

  let isClearing = $state(false)

  async function handleClearDone() {
    if (!$activeProjectId) return
    isClearing = true
    try {
      await clearDoneTasks($activeProjectId)
    } catch (err: unknown) {
      console.error('Failed to clear done tasks:', err)
      $error = String(err)
    } finally {
      isClearing = false
    }
  }
</script>


<svelte:window onclick={closeContextMenu} onkeydown={handleBoardKeydown} />

<div class="flex flex-col h-full overflow-hidden">
  <!-- Toggle bar -->
  <div class="flex items-center justify-between px-6 pt-4 pb-1">
    <button
      class="font-mono text-[11px] px-2.5 py-1 rounded cursor-pointer transition-colors {showBacklog ? 'bg-base-300 text-base-content' : 'text-secondary hover:text-base-content hover:bg-base-300/50'}"
      onclick={toggleBacklog}
      title="Toggle backlog (b)"
    >
      {showBacklog ? '▾' : '▸'} backlog
      <span class="ml-1 text-[10px] text-secondary bg-base-300 px-1 py-0.5 rounded">{backlogTasks.length}</span>
    </button>

    <button
      class="font-mono text-[11px] px-2.5 py-1 rounded cursor-pointer transition-colors {showDoneDrawer ? 'bg-base-300 text-base-content' : 'text-secondary hover:text-base-content hover:bg-base-300/50'}"
      onclick={toggleDoneDrawer}
      title="Toggle done drawer (c)"
    >
      done
      <span class="ml-1 text-[10px] text-secondary bg-base-300 px-1 py-0.5 rounded">{doneTasks.length}</span>
      {showDoneDrawer ? '✕' : '▸'}
    </button>
  </div>

  <!-- Main columns area -->
  <div class="flex gap-4 px-6 py-4 flex-1 overflow-hidden">
    <!-- Backlog column (inline, toggleable) -->
    {#if showBacklog}
      <div class="flex-1 min-w-0 flex flex-col max-w-[340px] transition-all duration-200">
        <div class="flex items-center justify-between py-2 mb-2">
          <span class="font-mono text-[11px] font-semibold text-secondary">// backlog</span>
          <span class="font-mono text-[10px] text-secondary bg-base-300 px-1.5 py-0.5 rounded">{backlogTasks.length}</span>
        </div>
        <div
          class="flex-1 flex flex-col gap-2 overflow-y-auto"
          role="listbox"
        >
          {#each backlogTasks as task (task.id)}
            <div oncontextmenu={(e: MouseEvent) => handleContextMenu(e, task.id)}>
              <TaskCard {task} session={getSession($activeSessions, task.id)} pullRequests={$ticketPrs.get(task.id) || []} onSelect={handleSelect} />
            </div>
          {/each}
          {#if backlogTasks.length === 0}
            <div class="text-center font-mono text-xs text-secondary py-5">No tasks</div>
          {/if}
        </div>
      </div>

      <!-- Divider between backlog and doing -->
      <div class="w-px bg-base-300 self-stretch my-2"></div>
    {/if}

    <!-- Doing column (always visible, takes remaining space) -->
    <div class="flex-1 min-w-0 flex flex-col">
      <div class="flex items-center justify-between py-2 mb-2">
        <span class="font-mono text-[11px] font-semibold text-secondary">// doing</span>
        <span class="font-mono text-[10px] text-secondary bg-base-300 px-1.5 py-0.5 rounded">{doingTasks.length}</span>
      </div>
      <div
        class="flex-1 flex flex-col gap-2 overflow-y-auto"
        role="listbox"
      >
        {#each doingTasks as task (task.id)}
          <div oncontextmenu={(e: MouseEvent) => handleContextMenu(e, task.id)}>
            <TaskCard {task} session={getSession($activeSessions, task.id)} pullRequests={$ticketPrs.get(task.id) || []} onSelect={handleSelect} />
          </div>
        {/each}
        {#if doingTasks.length === 0}
          <div class="text-center font-mono text-xs text-secondary py-5">No tasks</div>
        {/if}
      </div>
    </div>
  </div>
</div>

<!-- Done drawer (slides in from the right, overlays the board) -->
{#if showDoneDrawer}
  <!-- Backdrop -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/30 z-40 transition-opacity duration-200"
    onclick={toggleDoneDrawer}
    onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') toggleDoneDrawer() }}
  ></div>

  <!-- Drawer panel -->
  <div class="fixed top-0 right-0 h-full w-[400px] max-w-[85vw] bg-base-100 border-l border-base-300 z-50 shadow-2xl flex flex-col animate-slide-in-right">
    <!-- Drawer header -->
    <div class="flex items-center justify-between px-5 py-4 border-b border-base-300">
      <div class="flex items-center gap-3">
        <span class="font-mono text-[11px] font-semibold text-secondary">// done</span>
        <span class="font-mono text-[10px] text-secondary bg-base-300 px-1.5 py-0.5 rounded">{doneTasks.length}</span>
      </div>
      <div class="flex items-center gap-2">
        {#if doneTasks.length > 0}
          <button
            class="font-mono text-[11px] text-secondary hover:text-error cursor-pointer transition-colors"
            onclick={handleClearDone}
            disabled={isClearing}
            title="Clear all done tasks"
          >
            {#if isClearing}
              <span class="loading loading-spinner loading-xs"></span>
            {:else}
              $ clear
            {/if}
          </button>
        {/if}
        <button
          class="text-secondary hover:text-base-content cursor-pointer transition-colors text-lg leading-none"
          onclick={toggleDoneDrawer}
          title="Close (c)"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- Drawer content -->
    <div class="flex-1 flex flex-col gap-2 overflow-y-auto p-4">
      {#each doneTasks as task (task.id)}
        <div oncontextmenu={(e: MouseEvent) => handleContextMenu(e, task.id)}>
          <TaskCard {task} session={getSession($activeSessions, task.id)} pullRequests={$ticketPrs.get(task.id) || []} onSelect={handleSelect} />
        </div>
      {/each}
      {#if doneTasks.length === 0}
        <div class="text-center font-mono text-xs text-secondary py-10">No completed tasks</div>
      {/if}
    </div>
  </div>
{/if}

<!-- Context menu -->
{#if contextMenu.visible}
  <div class="fixed z-[100] bg-base-300 border border-base-300 rounded-lg shadow-xl min-w-[180px] p-1" style="left: {contextMenu.x}px; top: {contextMenu.y}px;">
    {#each actions as action (action.id)}
      <button
        class="context-item block w-full text-left px-3 py-2 text-sm text-base-content cursor-pointer rounded {isSessionBusy ? 'opacity-40 cursor-not-allowed' : 'hover:bg-primary hover:text-primary-content'}"
        disabled={isSessionBusy}
        title={isSessionBusy ? busyReason : action.name}
        onclick={() => handleRunAction(action)}
      >
        {action.name}
      </button>
    {/each}
    <div class="h-px bg-base-300 my-1"></div>
    <button class="context-item block w-full text-left px-3 py-2 text-sm text-base-content cursor-pointer rounded hover:bg-primary hover:text-primary-content" onclick={(e: MouseEvent) => { e.stopPropagation(); toggleMoveSubmenu() }}>
      Move to... ›
    </button>
    {#if contextMenu.showMoveSubmenu}
      <div class="border-t border-base-300 mt-0.5 pt-0.5">
        {#each COLUMNS as col}
          <button class="context-item block w-full text-left px-3 py-2 text-sm text-base-content cursor-pointer rounded hover:bg-primary hover:text-primary-content" onclick={() => handleMoveTo(col)}>
            {COLUMN_LABELS[col]}
          </button>
        {/each}
      </div>
    {/if}
    <div class="h-px bg-base-300 my-1"></div>
    <button class="context-item block w-full text-left px-3 py-2 text-sm text-error cursor-pointer rounded hover:bg-error hover:text-error-content" onclick={handleDelete}>Delete</button>
  </div>
{/if}
