<script lang="ts">
  import type { Task, AgentSession, KanbanColumn, Action } from '../lib/types'
  import { COLUMNS, COLUMN_LABELS } from '../lib/types'
  import { tasks, selectedTaskId, activeSessions, ticketPrs, error, activeProjectId, searchQuery } from '../lib/stores'
  import { updateTaskStatus, deleteTask, clearDoneTasks } from '../lib/ipc'
  import { pushNavState } from '../lib/navigation'
  import { loadActions, getEnabledActions } from '../lib/actions'
  import TaskCard from './TaskCard.svelte'

  interface Props {
    onRunAction?: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { onRunAction }: Props = $props()

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

<svelte:window onclick={closeContextMenu} />

<div class="flex flex-col h-full overflow-hidden">
  <div class="flex gap-4 px-6 py-5 flex-1 overflow-x-auto">
  {#each COLUMNS as column}
    {@const columnTasks = tasksForColumn(filteredTasks, column)}
    <div class="flex-1 min-w-0 flex flex-col">
       <div class="flex items-center justify-between py-2 mb-2">
         <span class="font-mono text-[11px] font-semibold text-secondary">// {COLUMN_LABELS[column].toLowerCase()}</span>
          <div class="flex items-center gap-2">
            {#if column === 'done' && columnTasks.length > 0}
              <button
                class="font-mono text-[11px] text-[#CCCCCC] hover:text-error cursor-pointer"
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
            <span class="font-mono text-[10px] text-secondary bg-base-300 px-1.5 py-0.5 rounded">{columnTasks.length}</span>
          </div>
       </div>
      <div class="flex-1 flex flex-col gap-2 overflow-y-auto">
        {#each columnTasks as task (task.id)}
          <div oncontextmenu={(e: MouseEvent) => handleContextMenu(e, task.id)}>
            <TaskCard {task} session={getSession($activeSessions, task.id)} pullRequests={$ticketPrs.get(task.id) || []} onSelect={handleSelect} />
          </div>
        {/each}
        {#if columnTasks.length === 0}
          <div class="text-center font-mono text-xs text-secondary py-5">No tasks</div>
        {/if}
      </div>
    </div>
  {/each}
</div>

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
</div>
