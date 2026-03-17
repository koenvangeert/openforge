<script lang="ts">
  import { untrack } from 'svelte'
  import type { Task, AgentSession, Action } from '../lib/types'
  import { tasks, selectedTaskId, activeSessions, ticketPrs, error, activeProjectId, startingTasks } from '../lib/stores'
  import { clearDoneTasks, getConfig, setConfig } from '../lib/ipc'
  import { pushNavState } from '../lib/navigation'
  import { loadBoardColumns, DEFAULT_BOARD_COLUMNS, BACKLOG_COLUMN, DONE_COLUMN } from '../lib/boardColumns'
  import { computeTaskState } from '../lib/taskState'
  import { sortBySessionActivity } from '../lib/taskSort'
  import { isInputFocused } from '../lib/domUtils'
  import { useVimNavigation } from '../lib/useVimNavigation.svelte'
  import { loadActions, getEnabledActions } from '../lib/actions'
  import TaskCard from './TaskCard.svelte'
  import TaskContextMenu from './TaskContextMenu.svelte'
  import ProjectPageHeader from './ProjectPageHeader.svelte'

  type BoardColumnConfig = (typeof DEFAULT_BOARD_COLUMNS)[number]

  interface Props {
    projectName: string
    onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { projectName, onRunAction }: Props = $props()

  let boardColumns = $state<BoardColumnConfig[]>([])

  $effect(() => {
    const pid = $activeProjectId
    if (pid) {
      loadBoardColumns(pid).then(cols => {
        boardColumns = cols
      })
    } else {
      boardColumns = [...DEFAULT_BOARD_COLUMNS]
    }
  })

  let showBacklog = $state(true)
  let showDoneDrawer = $state(false)
  let projectActions = $state<Action[]>([])

  $effect(() => {
    getConfig('backlog_visible').then(stored => {
      if (stored === 'false') {
        showBacklog = false
      }
    }).catch(() => {
      // fallthrough: keep default (open)
    })
  })

  $effect(() => {
    const pid = $activeProjectId
    if (pid) {
      loadActions(pid).then(all => { projectActions = getEnabledActions(all) })
    } else {
      projectActions = []
    }
  })

  const backlogColumn = BACKLOG_COLUMN
  const doneColumn = DONE_COLUMN

  let backlogTasks = $derived.by(() => {
    return sortBySessionActivity(
      $tasks.filter(t => {
        const session = $activeSessions.get(t.id) ?? null
        const prs = $ticketPrs.get(t.id) ?? []
        return backlogColumn.statuses.includes(computeTaskState(t, session, prs))
      }),
      $activeSessions,
    )
  })

  let doneTasks = $derived.by(() => {
    return sortBySessionActivity(
      $tasks.filter(t => {
        const session = $activeSessions.get(t.id) ?? null
        const prs = $ticketPrs.get(t.id) ?? []
        return doneColumn.statuses.includes(computeTaskState(t, session, prs))
      }),
      $activeSessions,
    )
  })

  let middleColumnTasks = $derived.by(() => {
    return boardColumns.map(col => ({
      config: col,
      tasks: sortBySessionActivity(
        $tasks.filter(t => {
          const session = $activeSessions.get(t.id) ?? null
          const prs = $ticketPrs.get(t.id) ?? []
          return col.statuses.includes(computeTaskState(t, session, prs))
        }),
        $activeSessions,
      ),
    }))
  })

  let focusedColumn = $state(0)

  let columns = $derived.by(() => {
    const cols: { key: string; tasks: Task[] }[] = []
    if (showBacklog) {
      cols.push({ key: backlogColumn.id, tasks: backlogTasks })
    }
    for (const ct of middleColumnTasks) {
      cols.push({ key: ct.config.id, tasks: ct.tasks })
    }
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

  $effect(() => {
    if (focusedColumn >= columns.length) {
      focusedColumn = Math.max(0, columns.length - 1)
    }
  })

  $effect(() => {
    const idx = vim.focusedIndex
    const columnIndex = focusedColumn

    untrack(() => {
      const col = columns[columnIndex]
      if (!col) return
      const container = document.querySelector(`[data-vim-column="${col.key}"]`)
      if (!container) return
      const items = container.querySelectorAll('[data-vim-item]')
      const el = items[idx] as HTMLElement | undefined
      el?.scrollIntoView?.({ block: 'nearest' })
    })
  })

  function toggleBacklog() {
    if (showBacklog) {
      showBacklog = false
      focusedColumn = Math.max(0, focusedColumn - 1)
    } else {
      showBacklog = true
      focusedColumn = focusedColumn + 1
    }
    setConfig('backlog_visible', String(showBacklog)).catch(e =>
      console.error('Failed to persist backlog state:', e)
    )
  }

  function toggleDoneDrawer() {
    showDoneDrawer = !showDoneDrawer
  }

  function handleBoardKeydown(e: KeyboardEvent) {
    if (isInputFocused()) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'b') { e.preventDefault(); toggleBacklog(); return }
    if (e.key === 'c') { e.preventDefault(); toggleDoneDrawer(); return }
    vim.handleKeydown(e)
  }

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
  <ProjectPageHeader
    title={`${projectName} — Board`}
    subtitle="Manage and prioritize project tasks"
  />

  <div class="flex items-center justify-between px-6 pt-4 pb-1">
    <button
      class="font-mono text-[11px] px-2.5 py-1 rounded cursor-pointer transition-colors {showBacklog ? 'bg-base-300 text-base-content' : 'text-secondary hover:text-base-content hover:bg-base-300/50'}"
      onclick={toggleBacklog}
      title="Toggle backlog (b)"
    >
      {showBacklog ? '▾' : '▸'} {backlogColumn.name.toLowerCase()}
      <span class="ml-1 text-[10px] text-secondary bg-base-300 px-1 py-0.5 rounded">{backlogTasks.length}</span>
    </button>
    <button
      class="font-mono text-[11px] px-2.5 py-1 rounded cursor-pointer transition-colors {showDoneDrawer ? 'bg-base-300 text-base-content' : 'text-secondary hover:text-base-content hover:bg-base-300/50'}"
      onclick={toggleDoneDrawer}
      title="Toggle done drawer (c)"
    >
      {doneColumn.name.toLowerCase()}
      <span class="ml-1 text-[10px] text-secondary bg-base-300 px-1 py-0.5 rounded">{doneTasks.length}</span>
      {showDoneDrawer ? '✕' : '▸'}
    </button>
  </div>

  <div class="flex gap-4 px-6 py-4 flex-1 overflow-hidden">
    {#if showBacklog}
      <div class="flex-1 min-w-0 flex flex-col max-w-[340px] transition-all duration-200">
        <div class="flex items-center justify-between py-2 mb-2">
          <span class="font-mono text-[11px] font-semibold text-secondary">// {backlogColumn.name.toLowerCase()}</span>
          <span class="font-mono text-[10px] text-secondary bg-base-300 px-1.5 py-0.5 rounded">{backlogTasks.length}</span>
        </div>
        <div class="flex-1 flex flex-col gap-2 overflow-y-auto" role="listbox" data-vim-column={backlogColumn.id}>
          {#each backlogTasks as task, i (task.id)}
            {@const isVimFocused = columns[focusedColumn]?.key === backlogColumn.id && vim.focusedIndex === i}
            <div data-vim-item oncontextmenu={(e: MouseEvent) => handleContextMenu(e, task.id)} class={isVimFocused ? 'vim-focus' : ''}>
              <TaskCard {task} session={getSession($activeSessions, task.id)} pullRequests={$ticketPrs.get(task.id) || []} isStarting={$startingTasks.has(task.id)} onSelect={handleSelect} />
            </div>
          {/each}
          {#if backlogTasks.length === 0}
            <div class="text-center font-mono text-xs text-secondary py-5">No tasks</div>
          {/if}
        </div>
      </div>
      <div class="w-px bg-base-300 self-stretch my-2"></div>
    {/if}

    {#each middleColumnTasks as colData, colIdx (colData.config.id)}
      <div class="flex-1 min-w-0 flex flex-col">
        <div class="flex items-center justify-between py-2 mb-2">
          <span class="font-mono text-[11px] font-semibold text-secondary">// {colData.config.name.toLowerCase()}</span>
          <span class="font-mono text-[10px] text-secondary bg-base-300 px-1.5 py-0.5 rounded">{colData.tasks.length}</span>
        </div>
        <div class="flex-1 flex flex-col gap-2 overflow-y-auto" role="listbox" data-vim-column={colData.config.id}>
          {#each colData.tasks as task, i (task.id)}
            {@const isVimFocused = columns[focusedColumn]?.key === colData.config.id && vim.focusedIndex === i}
            <div data-vim-item oncontextmenu={(e: MouseEvent) => handleContextMenu(e, task.id)} class={isVimFocused ? 'vim-focus' : ''}>
              <TaskCard {task} session={getSession($activeSessions, task.id)} pullRequests={$ticketPrs.get(task.id) || []} isStarting={$startingTasks.has(task.id)} onSelect={handleSelect} />
            </div>
          {/each}
          {#if colData.tasks.length === 0}
            <div class="text-center font-mono text-xs text-secondary py-5">No tasks</div>
          {/if}
        </div>
      </div>
      {#if colIdx < middleColumnTasks.length - 1}
        <div class="w-px bg-base-300 self-stretch my-2"></div>
      {/if}
    {/each}
  </div>
</div>

{#if showDoneDrawer}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/30 z-40 transition-opacity duration-200"
    onclick={toggleDoneDrawer}
    onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') toggleDoneDrawer() }}
  ></div>
  <div class="fixed top-0 right-0 h-full w-[400px] max-w-[85vw] bg-base-100 border-l border-base-300 z-50 shadow-2xl flex flex-col">
    <div class="flex items-center justify-between px-5 py-4 border-b border-base-300">
      <div class="flex items-center gap-3">
        <span class="font-mono text-[11px] font-semibold text-secondary">// {doneColumn.name.toLowerCase()}</span>
        <span class="font-mono text-[10px] text-secondary bg-base-300 px-1.5 py-0.5 rounded">{doneTasks.length}</span>
      </div>
      <div class="flex items-center gap-2">
        {#if doneTasks.length > 0}
          <button
            class="font-mono text-[11px] text-secondary hover:text-error cursor-pointer transition-colors"
            onclick={handleClearDone}
            disabled={isClearing}
            title="Clear done tasks"
          >
            {#if isClearing}<span class="loading loading-spinner loading-xs"></span>{:else}$ clear{/if}
          </button>
        {/if}
        <button
          class="text-secondary hover:text-base-content cursor-pointer transition-colors text-lg leading-none"
          onclick={toggleDoneDrawer}
          title="Close done drawer"
        >
          ✕
        </button>
      </div>
    </div>
    <div class="flex-1 flex flex-col gap-2 overflow-y-auto p-4">
      {#each doneTasks as task (task.id)}
        <div oncontextmenu={(e: MouseEvent) => handleContextMenu(e, task.id)}>
          <TaskCard {task} session={getSession($activeSessions, task.id)} pullRequests={$ticketPrs.get(task.id) || []} isStarting={$startingTasks.has(task.id)} onSelect={handleSelect} />
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
  actions={projectActions}
  onRunAction={onRunAction}
/>
