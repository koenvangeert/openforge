<script lang="ts">
  import { untrack } from 'svelte'
  import { focusBoardFilters } from '../lib/stores'
  import { filterTasks, getFilterCounts, DEFAULT_FOCUS_STATES, loadFocusFilterStates } from '../lib/boardFilters'
  import type { BoardFilter } from '../lib/boardFilters'
  import { getTaskReasonText } from '../lib/taskReason'
  import { computeTaskState } from '../lib/taskState'
  import type { TaskState } from '../lib/taskState'
  import { sortBySessionActivity } from '../lib/taskSort'
  import { useVimNavigation } from '../lib/useVimNavigation.svelte'
  import { isInputFocused } from '../lib/domUtils'
  import { loadActions, getEnabledActions } from '../lib/actions'
  import TaskListItem from './TaskListItem.svelte'
  import TaskDetailPane from './TaskDetailPane.svelte'
  import TaskContextMenu from './TaskContextMenu.svelte'
  import FocusEmptyState from './FocusEmptyState.svelte'
  import type { Task, AgentSession, PullRequestInfo, Action } from '../lib/types'

  interface Props {
    projectId: string | null
    projectName: string
    tasks: Task[]
    activeSessions: Map<string, AgentSession>
    ticketPrs: Map<string, PullRequestInfo[]>
    onOpenTask: (taskId: string) => void
    onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  const FILTER_OPTIONS = [
    { value: 'focus' as BoardFilter, label: 'Focus now' },
    { value: 'in-progress' as BoardFilter, label: 'In progress' },
    { value: 'backlog' as BoardFilter, label: 'Backlog' },
  ] as const

  let { projectId, projectName, tasks, activeSessions, ticketPrs, onOpenTask, onRunAction }: Props = $props()

  let selectedTaskIdLocal: string | null = $state(null)
  let paneHasFocus = $state(false)
  let contextMenu = $state({ visible: false, x: 0, y: 0, taskId: '' })
  let projectActions = $state<Action[]>([])
  let focusStates = $state<TaskState[]>(DEFAULT_FOCUS_STATES)
  let fallbackFilter: BoardFilter = $state('focus')

  let activeFilter = $derived.by(() => {
    if (!projectId) return fallbackFilter
    return $focusBoardFilters.get(projectId) ?? 'focus'
  })

  let filteredTasks = $derived.by(() => {
    const filtered = filterTasks(tasks, activeFilter, activeSessions, ticketPrs, focusStates)
    return sortBySessionActivity(filtered, activeSessions)
  })

  let filterCounts = $derived.by(() => getFilterCounts(tasks, activeSessions, ticketPrs, focusStates))

  let selectedTask = $derived.by(() => {
    if (!selectedTaskIdLocal) return null
    return filteredTasks.find(t => t.id === selectedTaskIdLocal) ?? null
  })

  function setActiveFilter(filter: BoardFilter) {
    if (!projectId) {
      fallbackFilter = filter
      return
    }
    const nextFilters = new Map($focusBoardFilters)
    nextFilters.set(projectId, filter)
    focusBoardFilters.set(nextFilters)
  }

  $effect(() => {
    if (selectedTaskIdLocal && !filteredTasks.find(t => t.id === selectedTaskIdLocal)) {
      selectedTaskIdLocal = null
    }
  })

  const vim = useVimNavigation({
    getItemCount: () => filteredTasks.length,
    onSelect: (index) => {
      const task = filteredTasks[index]
      if (task) onOpenTask(task.id)
    },
    onBack: () => {
      selectedTaskIdLocal = null
    },
    onAction: (index) => {
      const task = filteredTasks[index]
      if (task) onRunAction({ taskId: task.id, actionPrompt: '', agent: null })
    },
  })

  $effect(() => {
    const count = filteredTasks.length
    if (count === 0) return
    if (vim.focusedIndex >= count) {
      vim.setFocusedIndex(count - 1)
    }
  })

  $effect(() => {
    const idx = vim.focusedIndex
    untrack(() => {
      const items = document.querySelectorAll('[data-vim-item]')
      const el = items[idx] as HTMLElement | undefined
      el?.scrollIntoView?.({ block: 'nearest' })
    })
  })

  $effect(() => {
    const idx = vim.focusedIndex
    const task = filteredTasks[idx]
    if (task) {
      selectedTaskIdLocal = task.id
    }
  })

  $effect(() => {
    const projectId = tasks.find(t => t.project_id !== null)?.project_id
    if (!projectId) {
      projectActions = []
      return
    }
    loadActions(projectId)
      .then((all) => {
        projectActions = getEnabledActions(all)
      })
      .catch(() => {
        projectActions = []
      })
  })

  $effect(() => {
    const projectId = tasks.find(t => t.project_id !== null)?.project_id
    if (projectId) {
      loadFocusFilterStates(projectId).then(states => {
        focusStates = states
      })
    }
  })

  function handleKeydown(e: KeyboardEvent) {
    if (isInputFocused()) return

    // CMD+1/2/3 filter chip shortcuts (works even when pane has focus)
    if (e.metaKey && !e.shiftKey && !e.altKey) {
      const filterMap: Record<string, BoardFilter> = { '1': 'focus', '2': 'in-progress', '3': 'backlog' }
      const filter = filterMap[e.key]
      if (filter) {
        e.preventDefault()
        setActiveFilter(filter)
        selectedTaskIdLocal = null
        vim.setFocusedIndex(0)
        return
      }
    }

    if (paneHasFocus) return
    vim.handleKeydown(e)
  }

  function handleContextMenu(event: MouseEvent, taskId: string) {
    event.preventDefault()
    contextMenu = { visible: true, x: event.clientX, y: event.clientY, taskId }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex flex-col gap-5 h-full p-7 bg-base-200/50">
  <div class="flex flex-col gap-2">
    <span class="font-mono text-[10px] font-semibold text-base-content/40 tracking-widest uppercase">BOARD</span>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-base-content">{projectName}</h1>
        <p class="text-sm text-base-content/50">Focus on what needs attention first, with context always visible.</p>
      </div>
      <div class="flex items-center gap-2">
        {#each FILTER_OPTIONS as opt}
          <button
            class="rounded-[18px] px-3 py-2 text-xs font-medium transition-colors {activeFilter === opt.value
              ? 'bg-base-100 border border-base-300 shadow-sm text-base-content'
              : 'bg-base-200 text-base-content/50 hover:text-base-content/70'}"
            aria-pressed={activeFilter === opt.value}
            onclick={() => {
              setActiveFilter(opt.value)
              selectedTaskIdLocal = null
              vim.setFocusedIndex(0)
            }}
          >
            {opt.label} {filterCounts[opt.value]}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="flex gap-6 flex-1 min-h-0">
    <div class="flex flex-col gap-4 flex-1 min-w-0 overflow-y-auto">
      {#if activeFilter === 'focus'}
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-base-content/70">Needs attention</span>
            <span class="badge badge-ghost badge-sm">{filterCounts.focus}</span>
          </div>
          <span class="text-xs text-base-content/40">Quiet by default · select for context</span>
        </div>
      {/if}

      {#if filteredTasks.length === 0}
        <FocusEmptyState filter={activeFilter} />
      {:else}
        {#each filteredTasks as task, i (task.id)}
          {@const session = activeSessions.get(task.id) ?? null}
          {@const pullRequests = ticketPrs.get(task.id) ?? []}
          {@const state = computeTaskState(task, session, pullRequests)}
          <TaskListItem
            {task}
            {state}
            {session}
            {pullRequests}
            reasonText={getTaskReasonText(task, state, session, pullRequests)}
            isSelected={selectedTaskIdLocal === task.id}
            isFocused={vim.focusedIndex === i}
            onSelect={() => {
              if (selectedTaskIdLocal === task.id) {
                onOpenTask(task.id)
              } else {
                selectedTaskIdLocal = task.id
                vim.setFocusedIndex(i)
              }
            }}
            onContextMenu={(e) => handleContextMenu(e, task.id)}
          />
        {/each}
      {/if}
    </div>

    <div class="w-2/5 flex-shrink-0" onfocusin={() => paneHasFocus = true} onfocusout={() => paneHasFocus = false}>
      <TaskDetailPane
        task={selectedTask}
        pullRequests={selectedTask ? ticketPrs.get(selectedTask.id) ?? [] : []}
        onOpenFullView={() => {
          if (selectedTaskIdLocal) onOpenTask(selectedTaskIdLocal)
        }}
      />
    </div>
  </div>

  <TaskContextMenu
    visible={contextMenu.visible}
    x={contextMenu.x}
    y={contextMenu.y}
    taskId={contextMenu.taskId}
    onClose={() => contextMenu = { ...contextMenu, visible: false }}
    onStart={(taskId) => onRunAction({ taskId, actionPrompt: '', agent: null })}
    onDelete={() => contextMenu = { ...contextMenu, visible: false }}
    actions={projectActions}
    {onRunAction}
  />
</div>
