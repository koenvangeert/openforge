<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte'
  import { fly, fade } from 'svelte/transition'
  import { flip } from 'svelte/animate'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import { ChevronLeft, ChevronRight } from 'lucide-svelte'
  import type { WorkQueueEntry } from '../lib/types'
  import type { AgentSession } from '../lib/types'
  import { getWorkQueueTasks, getConfig, setConfig } from '../lib/ipc'
  import { activeProjectId, currentView, selectedTaskId, activeSessions, ticketPrs, startingTasks } from '../lib/stores'
  import { pushNavState } from '../lib/navigation'
  import { isInputFocused } from '../lib/domUtils'
  import { useVimNavigation } from '../lib/useVimNavigation.svelte'
  import TaskCard from './TaskCard.svelte'
  import TaskContextMenu from './TaskContextMenu.svelte'

  interface Props {
    onRunAction?: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { onRunAction }: Props = $props()

  let entries = $state<WorkQueueEntry[]>([])
  let loading = $state(true)
  let columnOrder = $state<string[]>([])
  let pinnedTaskIds = $state<Set<string>>(new Set())

  let grouped = $derived(groupByProject(entries))
  let sortedColumns = $derived(sortColumns(grouped, columnOrder))

  function groupByProject(items: WorkQueueEntry[]): Map<string, WorkQueueEntry[]> {
    const map = new Map<string, WorkQueueEntry[]>()
    for (const entry of items) {
      const existing = map.get(entry.project_name)
      if (existing) {
        existing.push(entry)
      } else {
        map.set(entry.project_name, [entry])
      }
    }
    return map
  }

  function sortColumns(groups: Map<string, WorkQueueEntry[]>, order: string[]): [string, WorkQueueEntry[]][] {
    const projectNames = [...groups.keys()]
    const sorted: [string, WorkQueueEntry[]][] = []

    // First, add projects that are in the saved order
    for (const name of order) {
      if (groups.has(name)) {
        sorted.push([name, sortEntriesWithPins(groups.get(name)!)])
      }
    }

    // Then, add any new projects not in saved order (appended at end)
    for (const name of projectNames) {
      if (!order.includes(name)) {
        sorted.push([name, sortEntriesWithPins(groups.get(name)!)])
      }
    }

    return sorted
  }

  function sortEntriesWithPins(items: WorkQueueEntry[]): WorkQueueEntry[] {
    return [...items].sort((a, b) => {
      const aPinned = pinnedTaskIds.has(a.task.id)
      const bPinned = pinnedTaskIds.has(b.task.id)
      if (aPinned && !bPinned) return -1
      if (!aPinned && bPinned) return 1
      return 0
    })
  }

  async function loadTasks(showLoadingState: boolean) {
    if (showLoadingState) {
      loading = true
    }
    try {
      const [fetchedEntries, savedOrder, savedPins] = await Promise.all([
        getWorkQueueTasks(),
        getConfig('workqueue_column_order'),
        getConfig('workqueue_pinned_tasks'),
      ])
      entries = fetchedEntries
      if (savedOrder) {
        try { columnOrder = JSON.parse(savedOrder) } catch { columnOrder = [] }
      }
      if (savedPins) {
        try { pinnedTaskIds = new Set(JSON.parse(savedPins)) } catch { pinnedTaskIds = new Set() }
      }
    } catch (e) {
      console.error('Failed to load work queue tasks:', e)
      entries = []
    } finally {
      loading = false
    }
  }

  function handleTaskClick(entry: WorkQueueEntry) {
    pushNavState()
    $activeProjectId = entry.task.project_id
    $currentView = 'board'
    $selectedTaskId = entry.task.id
  }

  function handleSelect(taskId: string) {
    const entry = entries.find(e => e.task.id === taskId)
    if (entry) handleTaskClick(entry)
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

  function getSession(entry: WorkQueueEntry): AgentSession | null {
    // Prefer live session from store (updated via Tauri events) over static backend data
    const liveSession = $activeSessions.get(entry.task.id)
    if (liveSession) return liveSession
    if (!entry.session_status) return null
    return {
      id: '',
      ticket_id: entry.task.id,
      opencode_session_id: null,
      stage: '',
      status: entry.session_status,
      checkpoint_data: entry.session_checkpoint_data,
      error_message: null,
      created_at: 0,
      updated_at: 0,
      provider: '',
      claude_session_id: null,
    }
  }

  function getPullRequests(entry: WorkQueueEntry) {
    // Prefer live PR data from store (updated via Tauri events) over static backend data
    const livePrs = $ticketPrs.get(entry.task.id)
    if (livePrs && livePrs.length > 0) return livePrs
    return entry.pull_requests
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

  // Context menu
  let contextMenu = $state({ visible: false, x: 0, y: 0, taskId: '' })

  function handleContextMenu(event: MouseEvent, taskId: string) {
    event.preventDefault()
    contextMenu = { visible: true, x: event.clientX, y: event.clientY, taskId }
  }

  function closeContextMenu() {
    contextMenu = { ...contextMenu, visible: false }
  }

  // Vim navigation — column-based
  let focusedCol = $state(0)
  let suppressNextAutoScroll = false

  function currentColEntries(): WorkQueueEntry[] {
    return sortedColumns[focusedCol]?.[1] ?? []
  }

  const vimWq = useVimNavigation({
    getItemCount: () => currentColEntries().length,
    onSelect: (index) => {
      const entry = currentColEntries()[index]
      if (entry) handleTaskClick(entry)
    },
    onLeft: () => {
      if (focusedCol > 0) {
        focusedCol--
        vimWq.setFocusedIndex(0)
      }
    },
    onRight: () => {
      if (focusedCol < sortedColumns.length - 1) {
        focusedCol++
        vimWq.setFocusedIndex(0)
      }
    },
  })

  // Clamp focusedCol when columns change
  $effect(() => {
    if (focusedCol >= sortedColumns.length && sortedColumns.length > 0) {
      suppressNextAutoScroll = true
      focusedCol = sortedColumns.length - 1
    }
  })

  function handleWorkQueueKeydown(e: KeyboardEvent) {
    if (isInputFocused()) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    vimWq.handleKeydown(e)
  }

  // Scroll focused item into view
  $effect(() => {
    const idx = vimWq.focusedIndex
    const colIndex = focusedCol

    if (suppressNextAutoScroll) {
      suppressNextAutoScroll = false
      return
    }

    untrack(() => {
      const col = sortedColumns[colIndex]
      if (!col) return
      const container = document.querySelector(`[data-vim-wq-col="${col[0]}"]`)
      if (!container) return
      const items = container.querySelectorAll('[data-vim-wq-item]')
      const el = items[idx] as HTMLElement | undefined
      el?.scrollIntoView?.({ block: 'nearest' })
    })
  })

  $effect(() => {
    loadTasks(true)
  })

  // Auto-refresh: listen for Tauri events that affect work queue
  const tauriEvents = ['task-changed', 'action-complete', 'agent-status-changed', 'implementation-failed']
  let unlisteners: UnlistenFn[] = []

  onMount(() => {
    for (const eventName of tauriEvents) {
      listen(eventName, () => {
        loadTasks(false)
      }).then((unlisten: UnlistenFn) => {
        unlisteners.push(unlisten)
      })
    }
  })

  onDestroy(() => {
    for (const unlisten of unlisteners) {
      unlisten()
    }
    unlisteners = []
  })
</script>

<svelte:window onkeydown={handleWorkQueueKeydown} />

{#if loading}
  <div class="flex-1 overflow-hidden flex items-center justify-center">
    <span class="text-base-content/50">Loading...</span>
  </div>
{:else if entries.length === 0}
  <div class="flex-1 overflow-hidden flex items-center justify-center">
    <span class="text-base-content/50">No tasks waiting for review</span>
  </div>
{:else}
  <div class="flex-1 overflow-auto p-6">
    <div class="flex gap-6 items-start">
      {#each sortedColumns as [projectName, projectEntries] (projectName)}
        <div
          class="min-w-[340px] max-w-[400px] rounded-lg"
          data-testid={`workqueue-column-${projectName}`}
          data-vim-wq-col={projectName}
          role="group"
          aria-label={`${projectName} column`}
          in:fly={{ x: 30, duration: 300 }}
          out:fade={{ duration: 200 }}
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
            {#each projectEntries as entry, i (entry.task.id)}
              {@const colIdx = sortedColumns.findIndex(([n]) => n === projectName)}
              {@const isVimFocused = colIdx === focusedCol && vimWq.focusedIndex === i}
              <div
                role="presentation"
                data-testid={`task-card-${entry.task.id}`}
                data-vim-wq-item
                class={isVimFocused ? 'vim-focus' : ''}
                oncontextmenu={(e: MouseEvent) => handleContextMenu(e, entry.task.id)}
                in:fly={{ y: 20, duration: 300 }}
                out:fade={{ duration: 200 }}
                animate:flip={{ duration: 300 }}
              >
                <TaskCard
                  task={entry.task}
                  session={getSession(entry)}
                  pullRequests={getPullRequests(entry)}
                  isStarting={$startingTasks.has(entry.task.id)}
                  isPinned={pinnedTaskIds.has(entry.task.id)}
                  onTogglePin={togglePin}
                  onSelect={handleSelect}
                />
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<TaskContextMenu
  visible={contextMenu.visible}
  x={contextMenu.x}
  y={contextMenu.y}
  taskId={contextMenu.taskId}
  onClose={closeContextMenu}
  onStart={(taskId) => onRunAction?.({ taskId, actionPrompt: '', agent: null })}
  onDelete={(taskId) => { if ($selectedTaskId === taskId) $selectedTaskId = null }}
  onRunAction={onRunAction}
/>
