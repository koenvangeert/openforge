<script lang="ts">
  import { activeProjectId, projects } from '../lib/stores'
  import { getProjectConfig, setProjectConfig, updateProject, deleteProject, getAgents } from '../lib/ipc'
  import { loadActions, saveActions, createAction, DEFAULT_ACTIONS } from '../lib/actions'
  import type { Action, AgentInfo } from '../lib/types'

  interface Props {
    onClose?: () => void
    onProjectDeleted?: () => void
  }

  let { onClose, onProjectDeleted }: Props = $props()

  let projectName = $state('')
  let path = $state('')
  let jiraBoardId = $state('')
  let githubDefaultRepo = $state('')
  let agentInstructions = $state('')
  let actions = $state<Action[]>([])
  let availableAgents = $state<AgentInfo[]>([])
  let isSaving = $state(false)
  let saved = $state(false)
  let isDeleting = $state(false)

  let currentProject = $derived($projects.find((p: typeof $projects[0]) => p.id === $activeProjectId))

  $effect(() => {
    projectName = currentProject?.name || ''
  })

  $effect(() => {
    path = currentProject?.path || ''
  })

  $effect(() => {
    if ($activeProjectId) {
      loadConfig($activeProjectId)
    }
  })

  async function loadConfig(projectId: string) {
    try {
      jiraBoardId = (await getProjectConfig(projectId, 'jira_board_id')) || ''
      githubDefaultRepo = (await getProjectConfig(projectId, 'github_default_repo')) || ''
      agentInstructions = (await getProjectConfig(projectId, 'additional_instructions')) || ''
      actions = await loadActions(projectId)
      availableAgents = await getAgents().catch(() => [])
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  }

  async function save() {
    if (!$activeProjectId) return

    isSaving = true
    saved = false
    try {
      await updateProject($activeProjectId, projectName, path)
      await setProjectConfig($activeProjectId, 'jira_board_id', jiraBoardId)
      await setProjectConfig($activeProjectId, 'github_default_repo', githubDefaultRepo)
      await setProjectConfig($activeProjectId, 'additional_instructions', agentInstructions)
      await saveActions($activeProjectId, actions)
      saved = true
      setTimeout(() => { saved = false }, 2000)
    } catch (e) {
      console.error('Failed to save settings:', e)
    } finally {
      isSaving = false
    }
  }

  async function handleDelete() {
    if (!$activeProjectId) return

    const confirmed = confirm(`Are you sure you want to delete project "${projectName}"? This action cannot be undone.`)
    if (!confirmed) return

    isDeleting = true
    try {
      await deleteProject($activeProjectId)
      onProjectDeleted?.()
      close()
    } catch (e) {
      console.error('Failed to delete project:', e)
      alert('Failed to delete project: ' + e)
    } finally {
      isDeleting = false
    }
  }

  function addAction() {
    actions = [...actions, createAction('New Action', '')]
  }

  function removeAction(index: number) {
    const action = actions[index]
    if (action.builtin) {
      if (!confirm(`Delete built-in action "${action.name}"? You can restore it with Reset to Defaults.`)) return
    }
    actions = actions.filter((_, i) => i !== index)
  }

  function resetActions() {
    if (!confirm('Reset all actions to defaults? This will remove any custom actions.')) return
    actions = [...DEFAULT_ACTIONS]
  }

  function close() {
    onClose?.()
  }
</script>

<div class="flex flex-col h-full w-full bg-base-200">
  <div class="flex items-center justify-between px-6 py-4 border-b border-base-300">
    <h2 class="text-[0.9rem] font-semibold text-base-content m-0">Project Settings: {projectName || 'No Project'}</h2>
    <button class="btn btn-ghost btn-xs" onclick={close}>✕</button>
  </div>

  {#if !$activeProjectId}
    <div class="flex-1 flex items-center justify-center px-5 py-10">
      <p class="text-base-content/50 text-[0.9rem]">Please select a project first</p>
    </div>
  {:else}
    <div class="flex-1 overflow-y-auto py-5 flex flex-col gap-6 max-w-2xl mx-auto w-full px-6">
      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-semibold text-primary uppercase tracking-wider mb-3 mt-0">Project</h3>
        <label class="flex flex-col gap-1">
          <span class="text-[0.7rem] text-base-content/50">Project Name</span>
          <input type="text" bind:value={projectName} placeholder="My Project" class="input input-bordered input-sm w-full" />
        </label>
         <label class="flex flex-col gap-1">
           <span class="text-[0.7rem] text-base-content/50">Repository Path</span>
           <input type="text" bind:value={path} placeholder="/path/to/repo" class="input input-bordered input-sm w-full" />
         </label>
         <button class="btn btn-error btn-sm w-full mt-2" onclick={handleDelete} disabled={isDeleting}>
           {#if isDeleting}Deleting...{:else}Delete Project{/if}
         </button>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-semibold text-primary uppercase tracking-wider mb-3 mt-0">JIRA</h3>
        <label class="flex flex-col gap-1">
          <span class="text-[0.7rem] text-base-content/50">Project / Board ID</span>
          <input type="text" bind:value={jiraBoardId} placeholder="e.g. PROJ" class="input input-bordered input-sm w-full" />
        </label>
      </section>

       <section class="flex flex-col gap-2">
         <h3 class="text-xs font-semibold text-primary uppercase tracking-wider mb-3 mt-0">GitHub</h3>
         <label class="flex flex-col gap-1">
           <span class="text-[0.7rem] text-base-content/50">Default Repository</span>
           <input type="text" bind:value={githubDefaultRepo} placeholder="owner/repo" class="input input-bordered input-sm w-full" />
         </label>
       </section>

       <section class="flex flex-col gap-2">
         <h3 class="text-xs font-semibold text-primary uppercase tracking-wider mb-3 mt-0">Agent</h3>
         <label class="flex flex-col gap-1">
           <span class="text-[0.7rem] text-base-content/50">Additional Instructions</span>
           <textarea bind:value={agentInstructions} placeholder="Optional instructions prepended to the first prompt when starting a new task..." rows="5" class="textarea textarea-bordered w-full text-sm resize-y"></textarea>
         </label>
       </section>

       <section class="flex flex-col gap-2">
         <h3 class="text-xs font-semibold text-primary uppercase tracking-wider mb-3 mt-0">Actions</h3>
        <p class="text-[0.7rem] text-base-content/50 mb-2 leading-snug">Configure actions available in the task context menu. Each action sends its prompt to the AI agent along with the task context.</p>
        
        {#each actions as action, i (action.id)}
          <div class="bg-base-100 border border-base-300 rounded-md p-3 flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" bind:checked={action.enabled} class="checkbox checkbox-primary checkbox-sm" />
                <span class="text-sm font-semibold text-base-content">{action.name}</span>
              </label>
              <button class="btn btn-ghost btn-xs text-base-content/50 hover:bg-error hover:text-error-content" onclick={() => removeAction(i)} title="Delete action">&times;</button>
            </div>
            <label class="flex flex-col gap-1">
              <span class="text-[0.7rem] text-base-content/50">Name</span>
              <input type="text" bind:value={action.name} placeholder="Action name" class="input input-bordered input-sm w-full" />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-[0.7rem] text-base-content/50">Prompt</span>
              <textarea bind:value={action.prompt} placeholder="Instruction for the AI agent..." rows="3" class="textarea textarea-bordered w-full text-sm resize-y"></textarea>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-[0.7rem] text-base-content/50">Agent</span>
              <select value={action.agent ?? ''} onchange={(e) => action.agent = (e.currentTarget as HTMLSelectElement).value || null} class="select select-bordered select-sm w-full">
                <option value="">Default</option>
                {#each availableAgents as agent}
                  <option value={agent.name}>{agent.name}</option>
                {/each}
              </select>
            </label>
          </div>
        {/each}
        
        <div class="flex gap-2">
          <button class="btn btn-ghost btn-sm flex-1 border border-dashed border-base-300 text-base-content/50 hover:border-primary hover:text-primary" onclick={addAction}>+ Add Action</button>
          <button class="btn btn-ghost btn-sm border border-base-300 text-base-content/50 hover:border-base-content hover:text-base-content" onclick={resetActions}>Reset to Defaults</button>
        </div>
      </section>
    </div>

    <div class="py-4 border-t border-base-300 max-w-2xl mx-auto w-full px-6">
      <button class="btn btn-primary btn-block" onclick={save} disabled={isSaving}>
        {#if isSaving}Saving...{:else if saved}Saved!{:else}Save Settings{/if}
      </button>
    </div>
  {/if}
</div>
