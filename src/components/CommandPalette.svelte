<script lang="ts">
  import { selectedTaskId, activeSessions, currentView, projects, activeProjectId } from '../lib/stores'
  import { pushNavState } from '../lib/navigation'
  import { matchesSearch, sortTasks } from '../lib/commandPalette'
  import { getAllTasks, getLatestSessions } from '../lib/ipc'
  import type { Task } from '../lib/types'

  interface Props {
    onClose: () => void
  }

  let { onClose }: Props = $props()

  let searchQuery = $state('')
  let selectedIndex = $state(0)
  let allTasks = $state<Task[]>([])
  let loading = $state(true)

  let projectMap = $derived(new Map($projects.map(p => [p.id, p])))

  // Fetch all tasks across projects on mount
  $effect(() => {
    loadAllTasks()
  })

  async function loadAllTasks() {
    loading = true
    try {
      const tasks = await getAllTasks()
      allTasks = tasks
      // Load sessions for all tasks
      const taskIds = tasks.map(t => t.id)
      if (taskIds.length > 0) {
        const sessions = await getLatestSessions(taskIds)
        const updated = new Map($activeSessions)
        for (const s of sessions) {
          updated.set(s.ticket_id, s)
        }
        $activeSessions = updated
      }
    } catch (e) {
      console.error('Failed to load all tasks:', e)
    } finally {
      loading = false
    }
  }

  let sortedAndFiltered = $derived.by(() => {
    const sorted = sortTasks(allTasks, $activeSessions)
    if (!searchQuery.trim()) return sorted
    return sorted.filter(t => matchesSearch(t, searchQuery.trim(), projectMap))
  })

  $effect(() => {
    // Reset selection when results change
    if (sortedAndFiltered.length > 0) {
      selectedIndex = 0
    } else {
      selectedIndex = -1
    }
  })

  function getSessionStatus(taskId: string): string | null {
    return $activeSessions.get(taskId)?.status ?? null
  }

  function statusLabel(sessionStatus: string | null): string | null {
    switch (sessionStatus) {
      case 'running': return 'Running'
      case 'completed': return 'Done'
      case 'paused': return 'Needs Input'
      case 'failed': return 'Error'
      case 'interrupted': return 'Stopped'
      default: return null
    }
  }

  function statusBadgeClass(sessionStatus: string | null): string {
    switch (sessionStatus) {
      case 'running': return 'badge-success'
      case 'completed': return 'badge-info'
      case 'paused': return 'badge-warning'
      case 'failed': return 'badge-error'
      case 'interrupted': return 'badge-ghost'
      default: return ''
    }
  }

  function selectTask(task: Task) {
    pushNavState()
    // Switch to the task's project if it's different from the active one
    if (task.project_id && task.project_id !== $activeProjectId) {
      $activeProjectId = task.project_id
    }
    $currentView = 'board'
    $selectedTaskId = task.id
    onClose()
  }

  function handleKeyDown(e: KeyboardEvent) {
    const count = sortedAndFiltered.length
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }

    if (count === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      selectedIndex = (selectedIndex + 1) % count
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectedIndex = selectedIndex <= 0 ? count - 1 : selectedIndex - 1
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (selectedIndex >= 0 && selectedIndex < count) {
        selectTask(sortedAndFiltered[selectedIndex])
      }
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  function getProjectName(projectId: string | null): string | null {
    if (!projectId) return null
    return projectMap.get(projectId)?.name ?? null
  }

  function firstLine(text: string): string {
    return text.split('\n')[0]
  }

  function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + '...' : text
  }

  let listContainer: HTMLDivElement | null = $state(null)

  $effect(() => {
    // Scroll selected item into view
    if (listContainer && selectedIndex >= 0) {
      const items = listContainer.querySelectorAll('[data-palette-item]')
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  })
</script>

<div
  data-testid="command-palette-backdrop"
  class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50"
  onclick={handleBackdropClick}
>
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Search tasks"
    class="w-full max-w-[520px] bg-base-200 border border-base-300 rounded-lg shadow-2xl overflow-hidden"
    onkeydown={handleKeyDown}
    tabindex="-1"
  >
    <!-- Search input -->
    <div class="p-3 border-b border-base-300">
      <input
        type="text"
        class="input input-sm w-full bg-base-100 border-base-300 focus:outline-none text-base-content placeholder:text-base-content/40 font-mono"
        placeholder="Search tasks across all projects..."
        bind:value={searchQuery}
        autofocus
      />
    </div>

    <!-- Task list -->
    <div class="max-h-[400px] overflow-y-auto" bind:this={listContainer}>
      {#if loading}
        <div class="px-4 py-6 text-center text-base-content/50 text-sm">
          Loading tasks...
        </div>
      {:else if sortedAndFiltered.length === 0}
        <div class="px-4 py-6 text-center text-base-content/50 text-sm">
          No tasks match your search
        </div>
      {:else}
        {#each sortedAndFiltered as task, i (task.id)}
          {@const sessionStatus = getSessionStatus(task.id)}
          {@const label = statusLabel(sessionStatus)}
          {@const badgeClass = statusBadgeClass(sessionStatus)}
          {@const isHighlighted = i === selectedIndex}
          {@const projectName = getProjectName(task.project_id)}
          {@const isOtherProject = task.project_id !== $activeProjectId}
          <button
            type="button"
            data-palette-item
            class="flex items-center gap-3 w-full px-4 py-2.5 text-left text-sm text-base-content transition-colors
              {isHighlighted ? 'bg-base-300' : 'hover:bg-base-300/60'}"
            onclick={() => selectTask(task)}
          >
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="font-mono text-xs font-semibold text-primary shrink-0">{task.id}</span>
                {#if task.jira_key}
                  <span class="badge badge-ghost badge-xs font-mono shrink-0">{task.jira_key}</span>
                {/if}
                {#if label}
                  <span class="badge {badgeClass} badge-xs font-mono shrink-0 {sessionStatus === 'paused' ? 'animate-pulse' : ''}">{label}</span>
                {/if}
                {#if projectName && isOtherProject}
                  <span class="badge badge-outline badge-xs font-mono shrink-0 opacity-60">{projectName}</span>
                {/if}
              </div>
              <div class="text-xs text-base-content/70 truncate mt-0.5">
                {truncate(firstLine(task.title), 80)}
              </div>
            </div>

            <span class="font-mono text-[10px] text-base-content/30 shrink-0">{task.status}</span>
          </button>
        {/each}
      {/if}
    </div>
  </div>
</div>
