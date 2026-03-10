<script lang="ts">
  import type { Task, AgentSession, KanbanColumn } from '../lib/types'
  import { tasks, selectedTaskId, activeSessions, ticketPrs, error, activeProjectId, runningTerminals, startingTasks } from '../lib/stores'
  import { clearDoneTasks } from '../lib/ipc'
  import { pushNavState } from '../lib/navigation'
  import { sortBySessionActivity } from '../lib/taskSort'
  import { isInputFocused } from '../lib/domUtils'
  import { useVimNavigation } from '../lib/useVimNavigation.svelte'
  import TaskCard from './TaskCard.svelte'
  import TaskContextMenu from './TaskContextMenu.svelte'

  interface Props {
    onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { onRunAction }: Props = $props()

  // Column visibility state
  let showBacklog = $state(true)
  let showDoneDrawer = $state(false)

  // Vim navigation state — default to "doing" column (index 1 when backlog visible, 0 when hidden)
  let focusedColumn = $state(showBacklog ? 1 : 0)

  let columns = $derived.by(() => {
    const cols: { key: string; tasks: Task[] }[] = []
    if (showBacklog) cols.push({ key: 'backlog', tasks: backlogTasks })
    cols.push({ key: 'doing', tasks: doingTasks })
    return cols
  })

  function currentColumnTasks(): Task[] {
    return columns[focusedColumn]?.tasks ?? []
  }

  const vim = useVimNavigation({
    getItemCount: () => currentColumnTasks().length,
    onSelect: (index) => {
      const task = currentColumnTasks()[index]
      if (task) handleSelect(task.id)
    },
    onAction: (index) => {
      const task = currentColumnTasks()[index]
      if (task) onRunAction({ taskId: task.id, actionPrompt: '', agent: null })
    },
    onLeft: () => {
      if (focusedColumn > 0) {
        focusedColumn--
        vim.setFocusedIndex(0)
      }
    },
    onRight: () => {
      if (focusedColumn < columns.length - 1) {
        focusedColumn++
        vim.setFocusedIndex(0)
      }
    },
  })

  // Clamp focusedColumn when columns change (e.g. backlog hidden)
  $effect(() => {
    if (focusedColumn >= columns.length) {
      focusedColumn = Math.max(0, columns.length - 1)
    }
  })

  // Scroll focused item into view
  $effect(() => {
    const idx = vim.focusedIndex
    const col = columns[focusedColumn]
    if (!col) return
    const container = document.querySelector(`[data-vim-column="${col.key}"]`)
    if (!container) return
    const items = container.querySelectorAll('[data-vim-item]')
    const el = items[idx] as HTMLElement | undefined
    el?.scrollIntoView?.({ block: 'nearest' })
  })

  function toggleBacklog() {
    showBacklog = !showBacklog
  }

  function toggleDoneDrawer() {
    showDoneDrawer = !showDoneDrawer
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
      // Vim navigation
      vim.handleKeydown(e)
    }
  }

  function tasksForColumn(allTasks: Task[], column: KanbanColumn): Task[] {
    const filtered = allTasks.filter(t => t.status === column)
    return sortBySessionActivity(filtered, $activeSessions)
  }

  let backlogTasks = $derived(tasksForColumn($tasks, 'backlog'))
  let doingTasks = $derived(tasksForColumn($tasks, 'doing'))
  let doneTasks = $derived(tasksForColumn($tasks, 'done'))

  function getSession(sessions: Map<string, AgentSession>, taskId: string): AgentSession | null {
    return sessions.get(taskId) || null
  }

  function handleSelect(taskId: string) {
    pushNavState()
    $selectedTaskId = taskId
  }

  let contextMenu = $state({ visible: false, x: 0, y: 0, taskId: '' })

  function handleContextMenu(event: MouseEvent, taskId: string) {
    event.preventDefault()
    contextMenu = { visible: true, x: event.clientX, y: event.clientY, taskId }
  }

  function closeContextMenu() {
    contextMenu = { ...contextMenu, visible: false }
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


<svelte:window onkeydown={handleBoardKeydown} />

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
          data-vim-column="backlog"
        >
          {#each backlogTasks as task, i (task.id)}
            {@const isVimFocused = columns[focusedColumn]?.key === 'backlog' && vim.focusedIndex === i}
            <div data-vim-item oncontextmenu={(e: MouseEvent) => handleContextMenu(e, task.id)} class={isVimFocused ? 'vim-focus' : ''}>
              <TaskCard {task} session={getSession($activeSessions, task.id)} pullRequests={$ticketPrs.get(task.id) || []} hasRunningTerminal={$runningTerminals.has(task.id)} isStarting={$startingTasks.has(task.id)} onSelect={handleSelect} />
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
        data-vim-column="doing"
      >
        {#each doingTasks as task, i (task.id)}
          {@const isVimFocused = columns[focusedColumn]?.key === 'doing' && vim.focusedIndex === i}
          <div data-vim-item oncontextmenu={(e: MouseEvent) => handleContextMenu(e, task.id)} class={isVimFocused ? 'vim-focus' : ''}>
            <TaskCard {task} session={getSession($activeSessions, task.id)} pullRequests={$ticketPrs.get(task.id) || []} hasRunningTerminal={$runningTerminals.has(task.id)} isStarting={$startingTasks.has(task.id)} onSelect={handleSelect} />
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
          <TaskCard {task} session={getSession($activeSessions, task.id)} pullRequests={$ticketPrs.get(task.id) || []} hasRunningTerminal={$runningTerminals.has(task.id)} isStarting={$startingTasks.has(task.id)} onSelect={handleSelect} />
        </div>
      {/each}
      {#if doneTasks.length === 0}
        <div class="text-center font-mono text-xs text-secondary py-10">No completed tasks</div>
      {/if}
    </div>
  </div>
{/if}

<TaskContextMenu
  visible={contextMenu.visible}
  x={contextMenu.x}
  y={contextMenu.y}
  taskId={contextMenu.taskId}
  onClose={closeContextMenu}
  onStart={(taskId) => onRunAction({ taskId, actionPrompt: '', agent: null })}
  onDelete={(taskId) => { if ($selectedTaskId === taskId) $selectedTaskId = null }}
/>
