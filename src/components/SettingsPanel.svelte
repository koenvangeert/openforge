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

<div class="settings">
  <div class="settings-header">
    <h2>Project Settings: {projectName || 'No Project'}</h2>
    <button class="close-btn" onclick={close}>X</button>
  </div>

  {#if !$activeProjectId}
    <div class="no-project">
      <p>Please select a project first</p>
    </div>
  {:else}
    <div class="settings-body">
      <section class="section">
        <h3>Project</h3>
        <label class="field">
          <span>Project Name</span>
          <input type="text" bind:value={projectName} placeholder="My Project" />
        </label>
         <label class="field">
           <span>Repository Path</span>
           <input type="text" bind:value={path} placeholder="/path/to/repo" />
         </label>
         <button class="btn btn-delete" onclick={handleDelete} disabled={isDeleting}>
           {#if isDeleting}Deleting...{:else}Delete Project{/if}
         </button>
      </section>

      <section class="section">
        <h3>JIRA</h3>
        <label class="field">
          <span>Project / Board ID</span>
          <input type="text" bind:value={jiraBoardId} placeholder="e.g. PROJ" />
        </label>
      </section>

      <section class="section">
        <h3>GitHub</h3>
        <label class="field">
          <span>Default Repository</span>
          <input type="text" bind:value={githubDefaultRepo} placeholder="owner/repo" />
        </label>
      </section>

      <section class="section">
        <h3>Actions</h3>
        <p class="section-description">Configure actions available in the task context menu. Each action sends its prompt to the AI agent along with the task context.</p>
        
        {#each actions as action, i (action.id)}
          <div class="action-item">
            <div class="action-header">
              <label class="action-toggle">
                <input type="checkbox" bind:checked={action.enabled} />
                <span class="action-name">{action.name}</span>
              </label>
              <button class="action-delete-btn" onclick={() => removeAction(i)} title="Delete action">&times;</button>
            </div>
            <label class="field">
              <span>Name</span>
              <input type="text" bind:value={action.name} placeholder="Action name" />
            </label>
            <label class="field">
              <span>Prompt</span>
              <textarea bind:value={action.prompt} placeholder="Instruction for the AI agent..." rows="3"></textarea>
            </label>
            <label class="field">
              <span>Agent</span>
              <select value={action.agent ?? ''} onchange={(e) => action.agent = (e.currentTarget as HTMLSelectElement).value || null}>
                <option value="">Default</option>
                {#each availableAgents as agent}
                  <option value={agent.name}>{agent.name}</option>
                {/each}
              </select>
            </label>
          </div>
        {/each}
        
        <div class="action-buttons">
          <button class="btn btn-add" onclick={addAction}>+ Add Action</button>
          <button class="btn btn-reset" onclick={resetActions}>Reset to Defaults</button>
        </div>
      </section>
    </div>

    <div class="settings-footer">
      <button class="btn btn-save" onclick={save} disabled={isSaving}>
        {#if isSaving}Saving...{:else if saved}Saved!{:else}Save Settings{/if}
      </button>
    </div>
  {/if}
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: var(--bg-secondary);
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
  }

  .settings-header h2 {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .close-btn {
    all: unset;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 0.8rem;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: var(--bg-card);
    color: var(--text-primary);
  }

  .settings-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .section h3 {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 12px;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field span {
    font-size: 0.7rem;
    color: var(--text-secondary);
  }

  .field input {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 10px;
    color: var(--text-primary);
    font-size: 0.8rem;
    outline: none;
  }

  .field input:focus {
    border-color: var(--accent);
  }

  .field select {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 10px;
    color: var(--text-primary);
    font-size: 0.8rem;
    outline: none;
  }

  .field select:focus {
    border-color: var(--accent);
  }

  .section-description {
    font-size: 0.7rem;
    color: var(--text-secondary);
    margin: 0 0 8px;
    line-height: 1.4;
  }

  .action-item {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .action-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .action-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .action-toggle input[type="checkbox"] {
    accent-color: var(--accent);
  }

  .action-name {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .action-delete-btn {
    all: unset;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 1rem;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .action-delete-btn:hover {
    background: var(--error);
    color: white;
  }

  .field textarea {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 10px;
    color: var(--text-primary);
    font-size: 0.8rem;
    font-family: inherit;
    outline: none;
    resize: vertical;
  }

  .field textarea:focus {
    border-color: var(--accent);
  }

  .action-buttons {
    display: flex;
    gap: 8px;
  }

  .btn-add {
    flex: 1;
    background: transparent;
    border: 1px dashed var(--border);
    color: var(--text-secondary);
  }

  .btn-add:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .btn-reset {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
  }

  .btn-reset:hover {
    border-color: var(--text-primary);
    color: var(--text-primary);
  }

  .settings-footer {
    padding: 12px 20px;
    border-top: 1px solid var(--border);
  }

  .btn {
    padding: 10px 20px;
    border: none;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    width: 100%;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-save {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .btn-delete {
    background: var(--error);
    color: var(--text-primary);
    margin-top: 8px;
  }

  .no-project {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
  }

  .no-project p {
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
</style>
