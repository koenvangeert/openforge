<script lang="ts">
  import { onMount } from 'svelte'
  import { skills, selectedSkillName, activeProjectId, currentView, selectedTaskId } from '../lib/stores'
  import { listOpenCodeSkills, createTask } from '../lib/ipc'
  import { pushNavState } from '../lib/navigation'
  import { isInputFocused } from '../lib/domUtils'
  import { useVimNavigation } from '../lib/useVimNavigation.svelte'
  import MarkdownContent from './MarkdownContent.svelte'
  import type { SkillInfo } from '../lib/types'

  interface Props {
    onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { onRunAction }: Props = $props()

  let isLoading = $state(false)
  let error = $state<string | null>(null)
  let searchFilter = $state('')
  let askPrompt = $state('')
  let showAskInput = $state(false)

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
    pushNavState()
    $selectedSkillName = skill.name
    showAskInput = false
    askPrompt = ''
  }

  async function handleEdit() {
    if (!selectedSkill || !$activeProjectId) return
    const initialPrompt = `Edit skill: ${selectedSkill.name}`
    const task = await createTask(initialPrompt, 'backlog', null, $activeProjectId)
    const prompt = `Edit the "${selectedSkill.name}" skill (${selectedSkill.level}-level).

Current skill content:
\`\`\`markdown
${selectedSkill.template || '(no content)'}
\`\`\`

Please review this skill and improve it. Focus on making it clearer, more actionable, and better structured.`
    onRunAction({ taskId: task.id, actionPrompt: prompt, agent: null })
    pushNavState()
    $currentView = 'board'
    $selectedTaskId = task.id
  }

  async function handleCreate() {
    if (!$activeProjectId) return
    const initialPrompt = 'Create new skill'
    const task = await createTask(initialPrompt, 'backlog', null, $activeProjectId)
    const prompt = `Create a new OpenCode skill (SKILL.md file). 

Use the "creating-skills" skill/guide if available. The skill should follow proper structure with:
- Clear name and description
- Progressive disclosure (overview → details)
- Concrete workflows and examples
- Proper frontmatter

Ask me what the skill should be about, then create it.`
    onRunAction({ taskId: task.id, actionPrompt: prompt, agent: null })
    pushNavState()
    $currentView = 'board'
    $selectedTaskId = task.id
  }

  async function handleAsk() {
    if (!selectedSkill || !$activeProjectId || !askPrompt.trim()) return
    const initialPrompt = `Question about skill: ${selectedSkill.name}`
    const task = await createTask(initialPrompt, 'backlog', null, $activeProjectId)
    const prompt = `I have a question about the "${selectedSkill.name}" skill.

Skill content:
\`\`\`markdown
${selectedSkill.template || '(no content)'}
\`\`\`

My question: ${askPrompt.trim()}`
    onRunAction({ taskId: task.id, actionPrompt: prompt, agent: null })
    askPrompt = ''
    showAskInput = false
    pushNavState()
    $currentView = 'board'
    $selectedTaskId = task.id
  }

  function handleAskKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAsk()
    }
    if (e.key === 'Escape') {
      showAskInput = false
      askPrompt = ''
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

  onMount(() => {
    loadSkills()
  })
</script>

<svelte:window onkeydown={handleSkillsKeydown} />

<div class="flex flex-col h-full overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between px-6 py-4 bg-base-200 border-b border-base-300 shrink-0">
    <div class="flex items-center gap-3">
      <h2 class="text-xl font-semibold text-base-content m-0">Skills</h2>
      <span class="badge badge-primary badge-sm">{$skills.length} {$skills.length === 1 ? 'skill' : 'skills'}</span>
    </div>
    <div class="flex items-center gap-2">
      <button class="btn btn-sm btn-primary" onclick={handleCreate}>+ New Skill</button>
      <button class="btn btn-sm border border-base-300" onclick={loadSkills} disabled={isLoading}>
        {isLoading ? '⟳' : '↻'} Refresh
      </button>
    </div>
  </div>

  <!-- Content -->
  <div class="flex flex-1 overflow-hidden">
    <!-- Left panel: Skill list -->
    <div class="w-72 border-r border-base-300 flex flex-col shrink-0 bg-base-100">
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
            <div class="px-3 pt-3 pb-1">
              <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider">Project</span>
            </div>
            {#each projectSkills as skill}
              {@const flatIdx = filteredSkills.indexOf(skill)}
              <button
                data-vim-skill
                class="w-full text-left px-3 py-2.5 border-b border-base-200 hover:bg-base-200 transition-colors cursor-pointer {$selectedSkillName === skill.name ? 'bg-primary/10 border-l-2 border-l-primary' : ''} {flatIdx === vimSkills.focusedIndex ? 'vim-focus' : ''}"
                onclick={() => selectSkill(skill)}
              >
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-sm font-medium text-base-content truncate flex-1">{skill.name}</span>
                  <span class="badge badge-outline badge-xs shrink-0">project</span>
                </div>
                {#if skill.description}
                  <p class="text-xs text-base-content/50 m-0 mt-1 line-clamp-2">{skill.description}</p>
                {/if}
              </button>
            {/each}
          {/if}

          {#if userSkills.length > 0}
            <div class="px-3 pt-3 pb-1">
              <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider">User</span>
            </div>
            {#each userSkills as skill}
              {@const flatIdx = filteredSkills.indexOf(skill)}
              <button
                data-vim-skill
                class="w-full text-left px-3 py-2.5 border-b border-base-200 hover:bg-base-200 transition-colors cursor-pointer {$selectedSkillName === skill.name ? 'bg-primary/10 border-l-2 border-l-primary' : ''} {flatIdx === vimSkills.focusedIndex ? 'vim-focus' : ''}"
                onclick={() => selectSkill(skill)}
              >
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-sm font-medium text-base-content truncate flex-1">{skill.name}</span>
                  <span class="badge badge-outline badge-xs shrink-0">user</span>
                </div>
                {#if skill.description}
                  <p class="text-xs text-base-content/50 m-0 mt-1 line-clamp-2">{skill.description}</p>
                {/if}
              </button>
            {/each}
          {/if}
        {/if}
      </div>
    </div>

    <!-- Right panel: Skill detail -->
    <div class="flex-1 flex flex-col overflow-hidden bg-base-100">
      {#if selectedSkill}
        <!-- Skill detail header -->
        <div class="flex items-center justify-between px-6 py-3 border-b border-base-300 bg-base-200 shrink-0">
          <div class="flex items-center gap-3 min-w-0">
            <h3 class="text-base font-semibold text-base-content m-0 truncate">{selectedSkill.name}</h3>
            <span class="badge badge-sm {selectedSkill.level === 'project' ? 'badge-primary' : 'badge-secondary'} shrink-0">{selectedSkill.level}</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              class="btn btn-ghost btn-sm text-base-content/70"
              onclick={() => { showAskInput = !showAskInput; if (!showAskInput) askPrompt = '' }}
              title="Ask a question about this skill"
            >Ask</button>
            <button
              class="btn btn-ghost btn-sm text-base-content/70"
              onclick={handleEdit}
              title="Create a task to edit this skill"
            >Edit</button>
          </div>
        </div>

        <!-- Ask input (collapsible) -->
        {#if showAskInput}
          <div class="px-6 py-3 border-b border-base-300 bg-base-200/50 shrink-0">
            <div class="flex gap-2">
              <input
                type="text"
                placeholder="Ask a question about this skill..."
                class="input input-sm input-bordered flex-1"
                bind:value={askPrompt}
                onkeydown={handleAskKeydown}
              />
              <button
                class="btn btn-sm btn-primary"
                onclick={handleAsk}
                disabled={!askPrompt.trim()}
              >Send</button>
            </div>
          </div>
        {/if}

        <!-- Description -->
        {#if selectedSkill.description}
          <div class="px-6 py-3 border-b border-base-300 shrink-0">
            <p class="text-sm text-base-content/70 m-0">{selectedSkill.description}</p>
          </div>
        {/if}

        <!-- Markdown content -->
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
            <p class="text-sm m-0">Create your first skill to get started.</p>
            <button class="btn btn-primary btn-sm mt-2" onclick={handleCreate}>+ New Skill</button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
