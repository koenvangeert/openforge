<script lang="ts">
  import { skills, selectedSkillName, activeProjectId } from '../lib/stores'
  import { listOpenCodeSkills, saveSkillContent } from '../lib/ipc'
  import { useAppRouter } from '../lib/router.svelte'
  import { isInputFocused } from '../lib/domUtils'

  interface Props {
    projectName: string
  }

  let { projectName }: Props = $props()
  import { useVimNavigation } from '../lib/useVimNavigation.svelte'
  import ProjectPageHeader from './project/ProjectPageHeader.svelte'
  import MarkdownContent from './shared/content/MarkdownContent.svelte'
  import type { SkillInfo } from '../lib/types'

  const router = useAppRouter()

  let isLoading = $state(false)
  let error = $state<string | null>(null)
  let searchFilter = $state('')
  let editMode = $state(false)
  let editContent = $state('')
  let isSaving = $state(false)
  let saveError = $state<string | null>(null)

  let selectedSkill = $derived($skills.find(s => s.name === $selectedSkillName) || null)

  let filteredSkills = $derived(
    searchFilter.trim()
      ? $skills.filter(s =>
          s.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
          (s.description || '').toLowerCase().includes(searchFilter.toLowerCase())
        )
      : $skills
  )

  let projectSkills = $derived(filteredSkills.filter(s => s.level === 'project'))
  let userSkills = $derived(filteredSkills.filter(s => s.level === 'user'))

  // Group skills by source_dir within each level
  const SOURCE_DIRS = ['.agents', '.claude', '.opencode'] as const

  function groupBySource(skills: SkillInfo[]): { source: string; skills: SkillInfo[] }[] {
    const groups: { source: string; skills: SkillInfo[] }[] = []
    for (const src of SOURCE_DIRS) {
      const matching = skills.filter(s => s.source_dir === src)
      if (matching.length > 0) {
        groups.push({ source: src, skills: matching })
      }
    }
    // Catch any skills with unknown source_dir
    const known = new Set<string>(SOURCE_DIRS)
    const other = skills.filter(s => !known.has(s.source_dir))
    if (other.length > 0) {
      groups.push({ source: 'other', skills: other })
    }
    return groups
  }

  let projectGroups = $derived(groupBySource(projectSkills))
  let userGroups = $derived(groupBySource(userSkills))

  // Collapsible state: track collapsed sections by key like "project" / "user" / "project:.claude"
  let collapsed = $state(new Map<string, boolean>())

  // Auto-select first filtered skill when current selection is filtered out
  $effect(() => {
    if ($selectedSkillName && filteredSkills.length > 0 && !filteredSkills.find(s => s.name === $selectedSkillName)) {
      $selectedSkillName = filteredSkills[0].name
    }
  })

  async function loadSkills() {
    if (!$activeProjectId) return
    isLoading = true
    error = null
    try {
      const result = await listOpenCodeSkills($activeProjectId)
      $skills = result
      // Auto-select first skill if none selected
      if (!$selectedSkillName && result.length > 0) {
        $selectedSkillName = result[0].name
      }
    } catch (e) {
      console.error('Failed to load skills:', e)
      error = 'Failed to load skills. Is OpenCode running?'
    } finally {
      isLoading = false
    }
  }

  function selectSkill(skill: SkillInfo) {
    router.navigate('skills')
    $selectedSkillName = skill.name
    editMode = false
    saveError = null
  }

  function enterEditMode() {
    if (!selectedSkill) return
    editContent = selectedSkill.template || ''
    editMode = true
    saveError = null
  }

  function cancelEdit() {
    editMode = false
    saveError = null
  }

  async function saveEdit() {
    if (!selectedSkill || !$activeProjectId) return
    isSaving = true
    saveError = null
    try {
      await saveSkillContent(
        $activeProjectId,
        selectedSkill.name,
        selectedSkill.level,
        selectedSkill.source_dir,
        editContent,
      )
      // Update the local skill data with new content
      $skills = $skills.map(s =>
        s.name === selectedSkill!.name && s.level === selectedSkill!.level && s.source_dir === selectedSkill!.source_dir
          ? { ...s, template: editContent }
          : s
      )
      editMode = false
    } catch (e) {
      console.error('Failed to save skill:', e)
      saveError = String(e)
    } finally {
      isSaving = false
    }
  }

  const vimSkills = useVimNavigation({
    getItemCount: () => filteredSkills.length,
    onSelect: (index) => {
      const skill = filteredSkills[index]
      if (skill) selectSkill(skill)
    },
  })

  function handleSkillsKeydown(e: KeyboardEvent) {
    if (isInputFocused()) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    vimSkills.handleKeydown(e)
  }

  // Scroll focused skill into view
  $effect(() => {
    const idx = vimSkills.focusedIndex
    const items = document.querySelectorAll('[data-vim-skill]')
    const el = items[idx] as HTMLElement | undefined
    el?.scrollIntoView?.({ block: 'nearest' })
  })

  // Reload skills when active project changes (also handles initial load)
  $effect(() => {
    const _pid = $activeProjectId
    if (_pid) {
      loadSkills()
    }
  })
</script>

<svelte:window onkeydown={handleSkillsKeydown} />

<div class="flex flex-col h-full overflow-hidden">
  <!-- Header -->
  <ProjectPageHeader
    title={`${projectName} — Skills`}
    subtitle="View and edit project and personal skills"
  >
    {#snippet actions()}
      <div class="flex items-center gap-2">
        <span class="badge badge-primary badge-sm">{$skills.length} {$skills.length === 1 ? 'skill' : 'skills'}</span>
        <button class="btn btn-sm border border-base-300" onclick={loadSkills} disabled={isLoading}>
          {isLoading ? '⟳' : '↻'} Refresh
        </button>
      </div>
    {/snippet}
  </ProjectPageHeader>

  <!-- Content -->
  <div class="flex flex-1 overflow-hidden">
    <!-- Left panel: Skill list -->
    <div class="w-72 border-r border-base-300 flex flex-col shrink-0" style="background-color: var(--project-bg, oklch(var(--b1)))">
      <!-- Search -->
      <div class="p-3 border-b border-base-300">
        <input
          type="text"
          placeholder="Filter skills..."
          class="input input-sm input-bordered w-full"
          bind:value={searchFilter}
        />
      </div>

      <!-- Skill list -->
      <div class="flex-1 overflow-y-auto">
        {#if isLoading && $skills.length === 0}
          <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm">
            <span class="loading loading-spinner loading-md text-primary"></span>
            <span>Loading skills...</span>
          </div>
        {:else if error}
          <div class="flex flex-col items-center justify-center h-full gap-3 text-error text-sm text-center p-5">
            <span class="text-3xl">⚠</span>
            <span>{error}</span>
          </div>
        {:else if $skills.length === 0}
          <div class="flex flex-col items-center justify-center h-full gap-4 text-base-content/50 text-center p-6">
            <span class="text-4xl">📝</span>
            <p class="text-sm m-0">No skills found. Create your first skill!</p>
          </div>
        {:else if filteredSkills.length === 0}
          <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-center p-6">
            <p class="text-sm m-0">No skills match your filter.</p>
          </div>
        {:else}
          {#if projectSkills.length > 0}
            {@const levelCollapsed = collapsed.get('project') ?? false}
            <button
              class="w-full flex items-center gap-1.5 px-3 pt-3 pb-1 cursor-pointer hover:bg-base-200/50"
              onclick={() => { collapsed = new Map(collapsed).set('project', !levelCollapsed) }}
            >
              <span class="text-xs text-base-content/40 transition-transform {levelCollapsed ? '' : 'rotate-90'}">&rsaquo;</span>
              <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider">Repository</span>
              <span class="text-xs text-base-content/30 ml-auto">{projectSkills.length}</span>
            </button>
            {#if !levelCollapsed}
              {#each projectGroups as group}
                {@const groupKey = `project:${group.source}`}
                {@const groupCollapsed = collapsed.get(groupKey) ?? false}
                <button
                  class="w-full flex items-center gap-1.5 pl-5 pr-3 pt-2 pb-1 cursor-pointer hover:bg-base-200/50"
                  onclick={() => { collapsed = new Map(collapsed).set(groupKey, !groupCollapsed) }}
                >
                  <span class="text-xs text-base-content/40 transition-transform {groupCollapsed ? '' : 'rotate-90'}">&rsaquo;</span>
                  <span class="text-xs font-medium text-base-content/40">{group.source}/skills</span>
                  <span class="text-xs text-base-content/30 ml-auto">{group.skills.length}</span>
                </button>
                {#if !groupCollapsed}
                  {#each group.skills as skill}
                    {@const flatIdx = filteredSkills.indexOf(skill)}
                    <button
                      data-vim-skill
                      class="w-full text-left pl-8 pr-3 py-2 border-b border-base-200 hover:bg-base-200 transition-colors cursor-pointer {$selectedSkillName === skill.name ? 'bg-primary/10 border-l-2 border-l-primary' : ''} {flatIdx === vimSkills.focusedIndex ? 'vim-focus' : ''}"
                      onclick={() => selectSkill(skill)}
                    >
                      <span class="text-sm font-medium text-base-content truncate block">{skill.name}</span>
                      {#if skill.description}
                        <p class="text-xs text-base-content/50 m-0 mt-0.5 line-clamp-1">{skill.description}</p>
                      {/if}
                    </button>
                  {/each}
                {/if}
              {/each}
            {/if}
          {/if}

          {#if userSkills.length > 0}
            {@const levelCollapsed = collapsed.get('user') ?? false}
            <button
              class="w-full flex items-center gap-1.5 px-3 pt-3 pb-1 cursor-pointer hover:bg-base-200/50"
              onclick={() => { collapsed = new Map(collapsed).set('user', !levelCollapsed) }}
            >
              <span class="text-xs text-base-content/40 transition-transform {levelCollapsed ? '' : 'rotate-90'}">&rsaquo;</span>
              <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider">Personal</span>
              <span class="text-xs text-base-content/30 ml-auto">{userSkills.length}</span>
            </button>
            {#if !levelCollapsed}
              {#each userGroups as group}
                {@const groupKey = `user:${group.source}`}
                {@const groupCollapsed = collapsed.get(groupKey) ?? false}
                <button
                  class="w-full flex items-center gap-1.5 pl-5 pr-3 pt-2 pb-1 cursor-pointer hover:bg-base-200/50"
                  onclick={() => { collapsed = new Map(collapsed).set(groupKey, !groupCollapsed) }}
                >
                  <span class="text-xs text-base-content/40 transition-transform {groupCollapsed ? '' : 'rotate-90'}">&rsaquo;</span>
                  <span class="text-xs font-medium text-base-content/40">~/{group.source}/skills</span>
                  <span class="text-xs text-base-content/30 ml-auto">{group.skills.length}</span>
                </button>
                {#if !groupCollapsed}
                  {#each group.skills as skill}
                    {@const flatIdx = filteredSkills.indexOf(skill)}
                    <button
                      data-vim-skill
                      class="w-full text-left pl-8 pr-3 py-2 border-b border-base-200 hover:bg-base-200 transition-colors cursor-pointer {$selectedSkillName === skill.name ? 'bg-primary/10 border-l-2 border-l-primary' : ''} {flatIdx === vimSkills.focusedIndex ? 'vim-focus' : ''}"
                      onclick={() => selectSkill(skill)}
                    >
                      <span class="text-sm font-medium text-base-content truncate block">{skill.name}</span>
                      {#if skill.description}
                        <p class="text-xs text-base-content/50 m-0 mt-0.5 line-clamp-1">{skill.description}</p>
                      {/if}
                    </button>
                  {/each}
                {/if}
              {/each}
            {/if}
          {/if}
        {/if}
      </div>
    </div>

    <!-- Right panel: Skill detail -->
    <div class="flex-1 flex flex-col overflow-hidden" style="background-color: var(--project-bg, oklch(var(--b1)))">
      {#if selectedSkill}
        <!-- Skill detail header -->
        <div class="flex items-center justify-between px-6 py-3 border-b border-base-300 shrink-0" style="background-color: var(--project-bg-alt, oklch(var(--b2)))">
          <div class="flex items-center gap-3 min-w-0">
            <h3 class="text-base font-semibold text-base-content m-0 truncate">{selectedSkill.name}</h3>
            <span class="badge badge-sm {selectedSkill.level === 'project' ? 'badge-primary' : 'badge-secondary'} shrink-0">{selectedSkill.level === 'project' ? 'repository' : 'personal'}</span>
            <span class="text-xs text-base-content/40 shrink-0">{selectedSkill.source_dir}/skills</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            {#if editMode}
              <button
                class="btn btn-ghost btn-sm text-base-content/70"
                onclick={cancelEdit}
                disabled={isSaving}
              >Cancel</button>
              <button
                class="btn btn-primary btn-sm"
                onclick={saveEdit}
                disabled={isSaving}
              >{isSaving ? 'Saving...' : 'Save'}</button>
            {:else}
              <button
                class="btn btn-ghost btn-sm text-base-content/70"
                onclick={enterEditMode}
              >Manually Edit</button>
            {/if}
          </div>
        </div>

        {#if saveError}
          <div class="px-6 py-2 bg-error/10 border-b border-error/20 shrink-0">
            <p class="text-xs text-error m-0">{saveError}</p>
          </div>
        {/if}

        <!-- Description -->
        {#if selectedSkill.description && !editMode}
          <div class="px-6 py-3 border-b border-base-300 shrink-0">
            <p class="text-sm text-base-content/70 m-0">{selectedSkill.description}</p>
          </div>
        {/if}

        {#if editMode}
          <!-- Edit mode: raw markdown textarea -->
          <div class="flex-1 overflow-hidden flex flex-col">
            <textarea
              class="flex-1 w-full p-4 font-mono text-sm text-base-content resize-none border-none outline-none"
              style="background-color: var(--project-bg, oklch(var(--b1)))"
              bind:value={editContent}
              spellcheck="false"
            ></textarea>
          </div>
        {:else}
          <!-- Read mode: rendered markdown -->
          <div class="flex-1 overflow-y-auto px-6 py-4">
            {#if selectedSkill.template}
              <MarkdownContent content={selectedSkill.template} />
            {:else}
              <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-center">
                <span class="text-3xl">📄</span>
                <p class="text-sm m-0">No content available for this skill.</p>
              </div>
            {/if}
          </div>
        {/if}
      {:else}
        <!-- No skill selected -->
        <div class="flex flex-col items-center justify-center h-full gap-4 text-base-content/50 text-center">
          {#if $skills.length > 0}
            <span class="text-5xl">👈</span>
            <h3 class="text-lg font-semibold text-base-content/70 m-0">Select a skill</h3>
            <p class="text-sm m-0">Choose a skill from the list to view its content.</p>
          {:else if !isLoading && !error}
            <span class="text-5xl">📝</span>
            <h3 class="text-lg font-semibold text-base-content/70 m-0">No skills yet</h3>
            <p class="text-sm m-0">Add skills to your project or personal directories to see them here.</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
