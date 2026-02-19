<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { projects, activeProjectId } from '../lib/stores'
  import type { Project } from '../lib/types'

  interface Props {
    onNewProject?: () => void
  }

  let { onNewProject }: Props = $props()

  let isOpen = $state(false)
  let dropdownRef: HTMLDivElement

  let activeProject = $derived($projects.find(p => p.id === $activeProjectId))

  function toggleDropdown() {
    isOpen = !isOpen
  }

  function selectProject(project: Project) {
    $activeProjectId = project.id
    isOpen = false
  }

  function openNewProjectDialog() {
    isOpen = false
    onNewProject?.()
  }

  function handleClickOutside(e: MouseEvent) {
    if (dropdownRef && !dropdownRef.contains(e.target as Node)) {
      isOpen = false
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isOpen) {
      e.stopPropagation()
      isOpen = false
    }
  }

  onMount(() => {
    document.addEventListener('click', handleClickOutside)
    document.addEventListener('keydown', handleKeydown)
  })

  onDestroy(() => {
    document.removeEventListener('click', handleClickOutside)
    document.removeEventListener('keydown', handleKeydown)
  })
</script>

<div class="relative" bind:this={dropdownRef}>
  <button class="btn btn-sm gap-2 bg-base-100 border border-base-300" onclick={toggleDropdown} type="button">
    <span class="font-medium">{activeProject ? activeProject.name : 'No Project'}</span>
    <span class="text-[0.6rem] text-base-content/50 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}">▼</span>
  </button>

  {#if isOpen}
    <div class="absolute top-[calc(100%+4px)] left-0 min-w-[220px] bg-base-200 border border-base-300 rounded-lg shadow-lg z-[100] overflow-hidden">
      {#if $projects.length === 0}
        <div class="p-5 text-center">
          <p class="m-0 mb-3 text-sm text-base-content/50">Create your first project</p>
          <button class="btn btn-primary btn-sm w-full" onclick={openNewProjectDialog} type="button">+ New Project</button>
        </div>
      {:else}
        <div class="max-h-[300px] overflow-y-auto">
          {#each $projects as project (project.id)}
            <button
              class="flex items-center justify-between w-full px-3.5 py-2.5 cursor-pointer text-sm text-base-content hover:bg-base-300 transition-colors text-left {project.id === $activeProjectId ? 'bg-base-300 text-primary' : ''}"
              onclick={() => selectProject(project)}
              type="button"
            >
              <span class="flex-1 text-left">{project.name}</span>
              {#if project.id === $activeProjectId}
                <span class="text-primary text-[0.9rem] font-bold">✓</span>
              {/if}
            </button>
          {/each}
        </div>
        <div class="p-2 border-t border-base-300 bg-base-100">
          <button class="btn btn-primary btn-xs w-full" onclick={openNewProjectDialog} type="button">+ New Project</button>
        </div>
      {/if}
    </div>
  {/if}
</div>
