<script lang="ts">
  import { onMount } from 'svelte'
  import { activeSessions, projects, activeProjectId } from '../../lib/stores'
  import { matchesSearch, sortTasks, filterActiveTasks, navigateToTask } from '../../lib/commandPalette'
  import { getAllTasks, getLatestSessions } from '../../lib/ipc'
  import { resolveContributions } from '../../lib/plugin/contributionResolver'
  import { executePluginCommand } from '../../lib/plugin/pluginRegistry'
  import { enabledPluginIds, installedPlugins } from '../../lib/plugin/pluginStore'
  import type { PluginManifest } from '../../lib/plugin/types'
  import { useListNavigation } from '../../lib/useListNavigation.svelte'
  import type { Task } from '../../lib/types'
  import PaletteModal from './PaletteModal.svelte'

  interface Props {
    onClose: () => void
  }

  let { onClose }: Props = $props()

  let searchQuery = $state('')
  let selectedTaskKey = $state<string | null>(null)
  let allTasks = $state<Task[]>([])
  let loading = $state(true)

  let projectMap = $derived(new Map($projects.map(p => [p.id, p])))
  let enabledPluginManifests = $derived(
    Array.from($enabledPluginIds)
      .map((pluginId) => $installedPlugins.get(pluginId)?.manifest)
      .filter((manifest): manifest is PluginManifest => manifest !== undefined)
  )
  let pluginCommands = $derived(resolveContributions(enabledPluginManifests).commands)

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
    const active = filterActiveTasks(allTasks)
    const sorted = sortTasks(active, $activeSessions)
    if (!searchQuery.trim()) return sorted
    return sorted.filter(t => matchesSearch(t, searchQuery.trim(), projectMap))
  })
  let filteredCommands = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) {
      return pluginCommands
    }

    return pluginCommands.filter((command) => {
      const pluginName = $installedPlugins.get(command.pluginId)?.manifest.name ?? command.pluginId
      return command.title.toLowerCase().includes(query)
        || command.contributionId.toLowerCase().includes(query)
        || pluginName.toLowerCase().includes(query)
    })
  })

  type PaletteItem =
    | { key: string; kind: 'command'; pluginId: string; commandId: string; title: string; pluginName: string; shortcut: string | null }
    | { key: string; kind: 'task'; task: Task }

  let paletteItems = $derived<PaletteItem[]>([
    ...filteredCommands.map((command) => ({
      key: `command:${command.namespacedId}`,
      kind: 'command' as const,
      pluginId: command.pluginId,
      commandId: command.contributionId,
      title: command.title,
      pluginName: $installedPlugins.get(command.pluginId)?.manifest.name ?? command.pluginId,
      shortcut: command.shortcut,
    })),
    ...sortedAndFiltered.map((task) => ({
      key: `task:${task.id}`,
      kind: 'task' as const,
      task,
    })),
  ])

  let selectedIndex = $derived.by(() => {
    if (paletteItems.length === 0) return -1
    if (selectedTaskKey === null) return 0

    const index = paletteItems.findIndex((item) => item.key === selectedTaskKey)
    return index === -1 ? 0 : index
  })

  let lastSearchQuery = $state('')

  $effect(() => {
    const trimmedSearchQuery = searchQuery.trim()

    if (paletteItems.length === 0) {
      selectedTaskKey = null
      lastSearchQuery = trimmedSearchQuery
      return
    }

    const searchChanged = trimmedSearchQuery !== lastSearchQuery
    lastSearchQuery = trimmedSearchQuery

    if (searchChanged || selectedTaskKey === null) {
      selectedTaskKey = paletteItems[0].key
      return
    }

    const selectedTaskStillVisible = paletteItems.some((item) => item.key === selectedTaskKey)

    if (!selectedTaskStillVisible) {
      selectedTaskKey = paletteItems[0].key
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
    navigateToTask(task)
    onClose()
  }

  async function selectPluginCommand(pluginId: string, commandId: string) {
    await executePluginCommand(pluginId, commandId)
    onClose()
  }

  const listNav = useListNavigation({
    get itemCount() { return paletteItems.length },
    get selectedIndex() { return selectedIndex },
    set selectedIndex(index: number) {
      if (paletteItems.length > 0) {
        selectedTaskKey = paletteItems[index].key
      }
    },
    wrap: true,
    onSelect() {
      if (selectedIndex >= 0 && selectedIndex < paletteItems.length) {
        const item = paletteItems[selectedIndex]
        if (item.kind === 'task') {
          selectTask(item.task)
        } else {
          void selectPluginCommand(item.pluginId, item.commandId)
        }
      }
    },
    onCancel() { onClose() }
  })

  function handleKeyDown(e: KeyboardEvent): boolean {
    return listNav.handleKeydown(e)
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

  onMount(() => {
    void loadAllTasks()
  })

  let listContainer: HTMLDivElement | null = $state(null)

  $effect(() => {
    // Scroll selected item into view
    if (listContainer && selectedIndex >= 0) {
      const items = listContainer.querySelectorAll('[data-palette-item]')
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  })
</script>

<PaletteModal
  ariaLabel="Search tasks or commands"
  testId="command-palette-backdrop"
  {onClose}
  onKeydown={handleKeyDown}
>
    <!-- Search input -->
    <div class="p-3 border-b border-base-300">
      <input
        data-palette-initial-focus
        type="text"
        class="input input-sm w-full bg-base-100 border-base-300 focus:outline-none text-base-content placeholder:text-base-content/40"
        placeholder="Search tasks or commands..."
        bind:value={searchQuery}
      />
    </div>

    <!-- Task list -->
    <div class="max-h-[400px] overflow-y-auto" bind:this={listContainer}>
      {#if loading}
        <div class="px-4 py-6 text-center text-base-content/50 text-sm">
          Loading tasks...
        </div>
      {:else if paletteItems.length === 0}
        <div class="px-4 py-6 text-center text-base-content/50 text-sm">
          No tasks or commands match your search
        </div>
      {:else}
        {#each paletteItems as item, i (item.key)}
          {@const isHighlighted = i === selectedIndex}
          <button
            type="button"
            data-palette-item
            class="flex items-center gap-3 w-full px-4 py-2.5 text-left text-sm text-base-content transition-colors
              {isHighlighted ? 'bg-base-300' : 'hover:bg-base-300/60'}"
            onclick={() => item.kind === 'task' ? selectTask(item.task) : void selectPluginCommand(item.pluginId, item.commandId)}
          >
            {#if item.kind === 'task'}
              {@const sessionStatus = getSessionStatus(item.task.id)}
              {@const label = statusLabel(sessionStatus)}
              {@const badgeClass = statusBadgeClass(sessionStatus)}
              {@const projectName = getProjectName(item.task.project_id)}
              {@const isOtherProject = item.task.project_id !== $activeProjectId}
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="font-mono text-xs font-semibold text-primary shrink-0">{item.task.id}</span>
                   {#if label}
                     <span class="badge {badgeClass} badge-xs shrink-0 {sessionStatus === 'paused' ? 'animate-pulse' : ''}">{label}</span>
                   {/if}
                   {#if projectName && isOtherProject}
                     <span class="badge badge-outline badge-xs shrink-0 opacity-60">{projectName}</span>
                   {/if}
                </div>
                <div class="text-xs text-base-content/70 truncate mt-0.5">
                  {truncate(firstLine(item.task.initial_prompt), 80)}
                </div>
              </div>

              <span class="text-[10px] text-base-content/30 shrink-0">{item.task.status}</span>
            {:else}
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="font-mono text-xs font-semibold text-primary shrink-0">cmd</span>
                  <span class="badge badge-outline badge-xs shrink-0 opacity-70">{item.pluginName}</span>
                  {#if item.shortcut}
                    <span class="badge badge-ghost badge-xs shrink-0">{item.shortcut}</span>
                  {/if}
                </div>
                <div class="text-xs text-base-content/70 truncate mt-0.5">
                  {item.title}
                </div>
              </div>

              <span class="text-[10px] text-base-content/30 shrink-0">command</span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>

    <!-- Hints bar -->
     <div class="flex items-center gap-4 px-3 py-1.5 border-t border-base-300 bg-base-300/30">
       <span class="text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">↑↓</kbd> navigate</span>
       <span class="text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">Enter</kbd> open or run</span>
       <span class="text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">Esc</kbd> close</span>
       <span class="text-[10px] text-base-content/40 ml-auto"><kbd class="kbd kbd-xs">Ctrl+N/P</kbd> navigate</span>
     </div>
</PaletteModal>
