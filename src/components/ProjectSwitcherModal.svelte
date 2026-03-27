<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { projects, activeProjectId, projectAttention } from '../lib/stores'
  import { getProjectAttention } from '../lib/ipc'
  import { useAppRouter } from '../lib/router.svelte'
  import type { ProjectAttention } from '../lib/types'

  interface Props {
    onClose: () => void
  }

  let { onClose }: Props = $props()
  const router = useAppRouter()

  let searchQuery = $state('')
  let selectedIndex = $state(-1)
  let inputEl = $state<HTMLInputElement | null>(null)

  let filteredProjects = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return $projects
    return $projects.filter(p => p.name.toLowerCase().includes(q))
  })

  // When searching, auto-select first result; when empty, highlight active project
  $effect(() => {
    if (searchQuery.trim()) {
      selectedIndex = filteredProjects.length > 0 ? 0 : -1
    } else {
      const idx = filteredProjects.findIndex(p => p.id === $activeProjectId)
      selectedIndex = idx >= 0 ? idx : -1
    }
  })

  function getAttention(projectId: string): ProjectAttention | undefined {
    return $projectAttention.get(projectId)
  }

  function selectProject(projectId: string) {
    $activeProjectId = projectId
    router.resetToBoard()
    onClose()
  }

  function handleKeyDown(e: KeyboardEvent) {
    const count = filteredProjects.length
    if (count === 0) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
      return
    }

    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault()
      selectedIndex = (selectedIndex + 1) % count
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault()
      selectedIndex = selectedIndex <= 0 ? count - 1 : selectedIndex - 1
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (selectedIndex >= 0 && selectedIndex < count) {
        selectProject(filteredProjects[selectedIndex].id)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  onMount(async () => {
    await tick()
    inputEl?.focus()

    try {
      const summaries = await getProjectAttention()
      const map = new Map<string, ProjectAttention>()
      for (const s of summaries) {
        map.set(s.project_id, s)
      }
      $projectAttention = map
    } catch (err) {
      console.error('Failed to load project attention:', err)
    }
  })
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  data-testid="modal-backdrop"
  role="presentation"
  class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50"
  onclick={handleBackdropClick}
>
  <!-- Dialog card -->
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Switch project"
    class="w-full max-w-[480px] bg-base-200 border border-base-300 rounded-lg shadow-2xl overflow-hidden"
    onkeydown={handleKeyDown}
    tabindex="-1"
  >
    <!-- Search input -->
    <div class="p-3 border-b border-base-300">
      <input
        bind:this={inputEl}
        type="text"
        class="input input-sm w-full bg-base-100 border-base-300 focus:outline-none text-base-content placeholder:text-base-content/40"
        placeholder="Switch project..."
        bind:value={searchQuery}
      />
    </div>

    <!-- Project list -->
    <div class="max-h-[300px] overflow-y-auto">
      {#if filteredProjects.length === 0}
        <div class="px-4 py-6 text-center text-base-content/50 text-sm">
          No projects match your search
        </div>
      {:else}
        {#each filteredProjects as project, i (project.id)}
          {@const attn = getAttention(project.id)}
          {@const isActive = project.id === $activeProjectId}
          {@const isHighlighted = i === selectedIndex}
          <button
            type="button"
            class="flex items-center gap-3 w-full px-4 py-2.5 text-left text-sm text-base-content transition-colors
              {isHighlighted ? 'bg-base-300' : 'hover:bg-base-300/60'}
              {isActive ? 'text-primary' : ''}"
            onclick={() => selectProject(project.id)}
          >
            <!-- Project name + path -->
            <div class="flex-1 min-w-0">
              <div class="font-medium leading-tight truncate">{project.name}</div>
              <div class="font-mono text-xs text-base-content/50 truncate mt-0.5">{project.path}</div>
            </div>

            <!-- Attention indicators -->
            <span class="flex items-center gap-1.5 shrink-0">
              {#if attn}
                {#if attn.needs_input > 0}
                  <span
                    class="w-2 h-2 rounded-full bg-warning"
                    title="{attn.needs_input} agent{attn.needs_input > 1 ? 's' : ''} need{attn.needs_input === 1 ? 's' : ''} input"
                  ></span>
                {:else if attn.running_agents > 0}
                  <span
                    class="w-2 h-2 rounded-full bg-success animate-pulse"
                    title="{attn.running_agents} agent{attn.running_agents > 1 ? 's' : ''} running"
                  ></span>
                {:else if attn.completed_agents > 0}
                  <span
                    class="w-2 h-2 rounded-full bg-info"
                    title="{attn.completed_agents} agent{attn.completed_agents > 1 ? 's' : ''} completed"
                  ></span>
                {:else if attn.ci_failures > 0}
                  <span
                    class="w-2 h-2 rounded-full bg-error"
                    title="{attn.ci_failures} CI failure{attn.ci_failures > 1 ? 's' : ''}"
                  ></span>
                {:else if attn.unaddressed_comments > 0}
                  <span
                    class="badge badge-error badge-xs text-[0.6rem]"
                    title="{attn.unaddressed_comments} unaddressed comment{attn.unaddressed_comments > 1 ? 's' : ''}"
                  >{attn.unaddressed_comments}</span>
                {/if}
              {/if}

              <!-- Active checkmark -->
              {#if isActive}
                <span class="text-primary text-[0.9rem] font-bold leading-none">✓</span>
              {/if}
            </span>
          </button>
        {/each}
      {/if}
    </div>

    <!-- Hints bar -->
     <div class="flex items-center gap-4 px-3 py-1.5 border-t border-base-300 bg-base-300/30">
       <span class="text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">↑↓</kbd> navigate</span>
       <span class="text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">Enter</kbd> select</span>
       <span class="text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">Esc</kbd> close</span>
       <span class="text-[10px] text-base-content/40 ml-auto"><kbd class="kbd kbd-xs">Ctrl+N/P</kbd> navigate</span>
     </div>
  </div>
</div>
