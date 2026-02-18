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

<div class="project-switcher" bind:this={dropdownRef}>
  <button class="switcher-btn" onclick={toggleDropdown} type="button">
    <span class="project-name">
      {activeProject ? activeProject.name : 'No Project'}
    </span>
    <span class="chevron" class:open={isOpen}>▼</span>
  </button>

  {#if isOpen}
    <div class="dropdown">
      {#if $projects.length === 0}
        <div class="empty-state">
          <p>Create your first project</p>
          <button class="new-project-btn" onclick={openNewProjectDialog} type="button">
            + New Project
          </button>
        </div>
      {:else}
        <div class="project-list">
          {#each $projects as project (project.id)}
            <button
              class="project-item"
              class:active={project.id === $activeProjectId}
              onclick={() => selectProject(project)}
              type="button"
            >
              <span class="project-item-name">{project.name}</span>
              {#if project.id === $activeProjectId}
                <span class="check-mark">✓</span>
              {/if}
            </button>
          {/each}
        </div>
        <div class="dropdown-footer">
          <button class="new-project-btn" onclick={openNewProjectDialog} type="button">
            + New Project
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .project-switcher {
    position: relative;
  }

  .switcher-btn {
    all: unset;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
    color: var(--text-primary);
    transition: all 0.15s ease;
  }

  .switcher-btn:hover {
    border-color: var(--accent);
    background: var(--bg-secondary);
  }

  .project-name {
    font-weight: 500;
  }

  .chevron {
    font-size: 0.6rem;
    color: var(--text-secondary);
    transition: transform 0.2s ease;
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  .dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 220px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 100;
    overflow: hidden;
  }

  .empty-state {
    padding: 20px;
    text-align: center;
  }

  .empty-state p {
    margin: 0 0 12px 0;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .project-list {
    max-height: 300px;
    overflow-y: auto;
  }

  .project-item {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 10px 14px;
    cursor: pointer;
    font-size: 0.8rem;
    color: var(--text-primary);
    transition: background 0.1s ease;
  }

  .project-item:hover {
    background: var(--bg-card);
  }

  .project-item.active {
    background: var(--bg-card);
    color: var(--accent);
  }

  .project-item-name {
    flex: 1;
    text-align: left;
  }

  .check-mark {
    color: var(--accent);
    font-size: 0.9rem;
    font-weight: bold;
  }

  .dropdown-footer {
    padding: 8px;
    border-top: 1px solid var(--border);
    background: var(--bg-primary);
  }

  .new-project-btn {
    all: unset;
    display: block;
    width: 100%;
    padding: 8px 12px;
    text-align: center;
    background: var(--accent);
    color: var(--bg-primary);
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: filter 0.15s ease;
  }

  .new-project-btn:hover {
    filter: brightness(1.1);
  }
</style>
