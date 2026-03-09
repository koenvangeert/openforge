<script lang="ts">
  import { ChevronLeft, ChevronRight, Eye, Pin } from 'lucide-svelte'
  import type { WorkQueueTask } from '../lib/types'
  import { getWorkQueueTasks, getConfig, setConfig } from '../lib/ipc'
  import { activeProjectId, currentView, selectedTaskId } from '../lib/stores'
  import { pushNavState } from '../lib/navigation'
  import { timeAgoFromSeconds } from '../lib/timeAgo'
  import Card from './Card.svelte'

  interface Props {
    refreshTrigger?: number
  }

  let { refreshTrigger = 0 }: Props = $props()

  let tasks = $state<WorkQueueTask[]>([])
  let loading = $state(true)
  let hoveredSummaryTaskId = $state<string | null>(null)
  let columnOrder = $state<string[]>([])
  let pinnedTaskIds = $state<Set<string>>(new Set())

  let grouped = $derived(groupByProject(tasks))
  let sortedColumns = $derived(sortColumns(grouped, columnOrder))

  function groupByProject(items: WorkQueueTask[]): Map<string, WorkQueueTask[]> {
    const map = new Map<string, WorkQueueTask[]>()
    for (const task of items) {
      const existing = map.get(task.project_name)
      if (existing) {
        existing.push(task)
      } else {
        map.set(task.project_name, [task])
      }
    }
    return map
  }

  function sortColumns(groups: Map<string, WorkQueueTask[]>, order: string[]): [string, WorkQueueTask[]][] {
    const projectNames = [...groups.keys()]
    const sorted: [string, WorkQueueTask[]][] = []

    // First, add projects that are in the saved order
    for (const name of order) {
      if (groups.has(name)) {
        sorted.push([name, sortTasksWithPins(groups.get(name)!)])
      }
    }

    // Then, add any new projects not in saved order (appended at end)
    for (const name of projectNames) {
      if (!order.includes(name)) {
        sorted.push([name, sortTasksWithPins(groups.get(name)!)])
      }
    }

    return sorted
  }

  function sortTasksWithPins(items: WorkQueueTask[]): WorkQueueTask[] {
    return [...items].sort((a, b) => {
      const aPinned = pinnedTaskIds.has(a.id)
      const bPinned = pinnedTaskIds.has(b.id)
      if (aPinned && !bPinned) return -1
      if (!aPinned && bPinned) return 1
      return 0
    })
  }

  async function loadTasks() {
    loading = true
    try {
      const [fetchedTasks, savedOrder, savedPins] = await Promise.all([
        getWorkQueueTasks(),
        getConfig('workqueue_column_order'),
        getConfig('workqueue_pinned_tasks'),
      ])
      tasks = fetchedTasks
      if (savedOrder) {
        try { columnOrder = JSON.parse(savedOrder) } catch { columnOrder = [] }
      }
      if (savedPins) {
        try { pinnedTaskIds = new Set(JSON.parse(savedPins)) } catch { pinnedTaskIds = new Set() }
      }
    } catch (e) {
      console.error('Failed to load work queue tasks:', e)
      tasks = []
    } finally {
      loading = false
    }
  }

  function statusLabel(s: string): string {
    switch (s) {
      case 'running': return 'Running'
      case 'completed': return 'Done'
      case 'paused': return 'Paused'
      case 'failed': return 'Error'
      case 'interrupted': return 'Stopped'
      default: return s
    }
  }

  function statusStyle(s: string): string {
    switch (s) {
      case 'running': return 'bg-success/15 text-success'
      case 'completed': return 'bg-info/20 text-info'
      case 'paused': return 'bg-warning/15 text-warning'
      case 'failed': return 'bg-error/15 text-error'
      case 'interrupted': return 'bg-base-content/15 text-base-content/50'
      default: return 'bg-base-content/15 text-base-content/50'
    }
  }

  function handleTaskClick(task: WorkQueueTask) {
    pushNavState()
    $activeProjectId = task.project_id
    $currentView = 'board'
    $selectedTaskId = task.id
  }

  function showSummary(taskId: string) {
    hoveredSummaryTaskId = taskId
  }

  function hideSummary() {
    hoveredSummaryTaskId = null
  }

  function togglePin(taskId: string, e: MouseEvent | KeyboardEvent) {
    e.stopPropagation()
    const next = new Set(pinnedTaskIds)
    if (next.has(taskId)) {
      next.delete(taskId)
    } else {
      next.add(taskId)
    }
    pinnedTaskIds = next
    setConfig('workqueue_pinned_tasks', JSON.stringify([...next])).catch((err) =>
      console.error('Failed to save pinned tasks:', err)
    )
  }

  function moveColumn(projectName: string, direction: -1 | 1) {
    const currentOrder = sortedColumns.map(([name]) => name)
    const index = currentOrder.indexOf(projectName)
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= currentOrder.length) return

    const newOrder = [...currentOrder]
    newOrder.splice(index, 1)
    newOrder.splice(targetIndex, 0, projectName)

    columnOrder = newOrder
    setConfig('workqueue_column_order', JSON.stringify(newOrder)).catch((err) =>
      console.error('Failed to save column order:', err)
    )
  }

  $effect(() => {
    loadTasks()
  })

  $effect(() => {
    if (refreshTrigger > 0) {
      loadTasks()
    }
  })
</script>

{#if loading}
  <div class="flex-1 overflow-hidden flex items-center justify-center">
    <span class="text-base-content/50">Loading...</span>
  </div>
{:else if tasks.length === 0}
  <div class="flex-1 overflow-hidden flex items-center justify-center">
    <span class="text-base-content/50">No tasks waiting for review</span>
  </div>
{:else}
  <div class="flex-1 overflow-auto p-6">
    <div class="flex gap-6 items-start">
      {#each sortedColumns as [projectName, projectTasks]}
        <div
          class="min-w-[340px] max-w-[400px] rounded-lg"
          data-testid={`workqueue-column-${projectName}`}
          role="group"
          aria-label={`${projectName} column`}
        >
          <div
            class="flex items-center gap-2 mb-3 px-1"
            data-testid={`workqueue-column-header-${projectName}`}
          >
            <button
              type="button"
              class="text-base-content/30 hover:text-base-content/60 transition-colors disabled:opacity-0 disabled:cursor-default"
              aria-label={`Move ${projectName} column left`}
              data-testid={`move-left-${projectName}`}
              disabled={sortedColumns.map(([n]) => n).indexOf(projectName) === 0}
              onclick={() => moveColumn(projectName, -1)}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <h2 class="font-mono text-sm font-semibold text-base-content select-none">{projectName}</h2>
            <button
              type="button"
              class="text-base-content/30 hover:text-base-content/60 transition-colors disabled:opacity-0 disabled:cursor-default"
              aria-label={`Move ${projectName} column right`}
              data-testid={`move-right-${projectName}`}
              disabled={sortedColumns.map(([n]) => n).indexOf(projectName) === sortedColumns.length - 1}
              onclick={() => moveColumn(projectName, 1)}
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
          <div class="flex flex-col gap-2">
            {#each projectTasks as task}
              {@const isPinned = pinnedTaskIds.has(task.id)}
              <div data-testid={`task-card-${task.id}`}>
                <Card onclick={() => handleTaskClick(task)} class="group/card block px-3.5 py-3 {isPinned ? 'border-primary/30' : ''}">
                  <div class="flex items-center justify-between mb-1">
                    <div class="flex items-center gap-1.5">
                      <span class="font-mono text-xs font-semibold text-primary">{task.id}</span>
                      {#if task.session_status}
                        <span
                          class="font-mono text-[0.6rem] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap leading-tight {statusStyle(task.session_status)}"
                        >{statusLabel(task.session_status)}</span>
                      {/if}
                    </div>
                    <div class="flex items-center gap-1.5">
                      <button
                        type="button"
                        class="shrink-0 transition-opacity {isPinned ? 'text-primary opacity-100' : 'text-base-content/40 hover:text-base-content/70 opacity-0 group-hover/card:opacity-100'}"
                        aria-label={isPinned ? 'Unpin task' : 'Pin task'}
                        data-testid={`pin-btn-${task.id}`}
                        onclick={(e: MouseEvent) => togglePin(task.id, e)}
                        onkeydown={(e: KeyboardEvent) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            togglePin(task.id, e)
                          }
                        }}
                      >
                        <Pin size={12} aria-hidden="true" class={isPinned ? 'fill-primary' : ''} />
                      </button>
                      <span class="font-mono text-[0.6rem] text-base-content/40">{task.session_completed_at ? timeAgoFromSeconds(task.session_completed_at) : 'no session'}</span>
                    </div>
                  </div>
                  <div class="font-mono text-sm font-medium leading-relaxed text-base-content mb-1">
                    {task.title.length > 80 ? task.title.slice(0, 80) + '...' : task.title}
                  </div>
                  {#if task.summary}
                    <div
                      class="relative w-full"
                      data-testid={`summary-container-${task.id}`}
                      onmouseenter={() => showSummary(task.id)}
                      onmouseleave={() => hideSummary()}
                    >
                      <div class="flex items-center gap-1.5 min-w-0 text-xs text-base-content/50">
                        <span class="truncate">{task.summary}</span>
                        <span
                          class="shrink-0 text-base-content/40 hover:text-base-content/70 cursor-default"
                          aria-label="Show full summary"
                          role="img"
                        >
                          <Eye size={12} aria-hidden="true" />
                        </span>
                      </div>
                      {#if hoveredSummaryTaskId === task.id}
                        <div
                          class="absolute left-0 top-full z-30 w-[32rem] max-w-[min(36rem,calc(100vw-4rem))] max-h-72 overflow-auto rounded border border-base-300 bg-base-200 p-4 text-sm leading-relaxed text-base-content shadow-lg whitespace-pre-wrap break-words"
                          data-testid={`summary-popover-${task.id}`}
                          role="tooltip"
                        >
                          {task.summary}
                        </div>
                      {/if}
                    </div>
                  {/if}
                </Card>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}
