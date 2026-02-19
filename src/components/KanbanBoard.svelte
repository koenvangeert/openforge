<script lang="ts">
  import type { Task, AgentSession, KanbanColumn, Action } from '../lib/types'
  import { COLUMNS, COLUMN_LABELS } from '../lib/types'
  import { tasks, selectedTaskId, activeSessions, ticketPrs, error, activeProjectId, searchQuery } from '../lib/stores'
  import { updateTaskStatus, deleteTask } from '../lib/ipc'
  import { loadActions, getEnabledActions } from '../lib/actions'
  import TaskCard from './TaskCard.svelte'

  interface Props {
    onRunAction?: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { onRunAction }: Props = $props()

  let searchInput: HTMLInputElement | undefined = $state()

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

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.metaKey && e.key === '/') {
      e.preventDefault()
      searchInput?.focus()
    }
    if (e.key === 'Escape' && $searchQuery && document.activeElement === searchInput) {
      e.preventDefault()
      $searchQuery = ''
    }
  }
</script>

<svelte:window onclick={closeContextMenu} onkeydown={handleGlobalKeydown} />

<div class="flex flex-col h-full overflow-hidden">
  <div class="flex items-center gap-2 px-4 pt-3 pb-1 shrink-0">
    <label class="input input-bordered input-sm flex items-center gap-2 w-64">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="h-4 w-4 opacity-50"><path fill-rule="evenodd" d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z" clip-rule="evenodd" /></svg>
      <input
        type="text"
        class="grow bg-transparent border-none outline-none text-sm"
        placeholder="Search tasks..."
        bind:value={$searchQuery}
        bind:this={searchInput}
      />
      {#if $searchQuery}
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-circle"
          onclick={() => { $searchQuery = ''; searchInput?.focus() }}
        >✕</button>
      {/if}
    </label>
    <span class="text-xs text-base-content/40 ml-1">⌘/</span>
    {#if $searchQuery}
      <span class="text-xs text-base-content/50">{filteredTasks.length} of {$tasks.length} tasks</span>
    {/if}
  </div>

  <div class="flex gap-3 p-4 flex-1 overflow-x-auto">
  {#each COLUMNS as column}
    {@const columnTasks = tasksForColumn(filteredTasks, column)}
    <div class="flex-1 min-w-0 flex flex-col bg-base-200 rounded-lg border border-base-300">
       <div class="flex items-center justify-between px-3.5 py-3 border-b border-base-300">
         <span class="text-xs font-semibold text-base-content uppercase tracking-wider">{COLUMN_LABELS[column]}</span>
         <div class="flex items-center gap-2">
           <span class="badge badge-ghost badge-sm">{columnTasks.length}</span>
         </div>
       </div>
      <div class="flex-1 p-2 flex flex-col gap-2 overflow-y-auto">
        {#each columnTasks as task (task.id)}
          <div oncontextmenu={(e: MouseEvent) => handleContextMenu(e, task.id)}>
            <TaskCard {task} session={getSession($activeSessions, task.id)} pullRequests={$ticketPrs.get(task.id) || []} onSelect={handleSelect} />
          </div>
        {/each}
        {#if columnTasks.length === 0}
          <div class="text-center text-xs text-base-content/50 py-5">No tasks</div>
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
