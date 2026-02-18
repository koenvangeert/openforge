<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { activeProjectId, projects } from '../lib/stores'
  import { getProjectConfig, setProjectConfig, updateProject, deleteProject } from '../lib/ipc'

  const dispatch = createEventDispatcher()

  let projectName = ''
  let path = ''
  let jiraBoardId = ''
  let githubDefaultRepo = ''
  let isSaving = false
  let saved = false
  let isDeleting = false

  $: if ($activeProjectId) {
    loadConfig($activeProjectId)
  }

  $: currentProject = $projects.find((p: typeof $projects[0]) => p.id === $activeProjectId)
  $: projectName = currentProject?.name || ''
  $: path = currentProject?.path || ''

  async function loadConfig(projectId: string) {
    try {
      jiraBoardId = (await getProjectConfig(projectId, 'jira_board_id')) || ''
      githubDefaultRepo = (await getProjectConfig(projectId, 'github_default_repo')) || ''
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
      dispatch('project-deleted')
      close()
    } catch (e) {
      console.error('Failed to delete project:', e)
      alert('Failed to delete project: ' + e)
    } finally {
      isDeleting = false
    }
  }

  function close() {
    dispatch('close')
  }
</script>

<div class="settings">
  <div class="settings-header">
    <h2>Project Settings: {projectName || 'No Project'}</h2>
    <button class="close-btn" on:click={close}>X</button>
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
        <button class="btn btn-delete" on:click={handleDelete} disabled={isDeleting}>
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
    </div>

    <div class="settings-footer">
      <button class="btn btn-save" on:click={save} disabled={isSaving}>
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

  .section-note {
    margin: 0;
    font-size: 0.7rem;
    color: var(--text-secondary);
    font-style: italic;
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

  .checkbox {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .checkbox input {
    accent-color: var(--accent);
  }

  .checkbox span {
    font-size: 0.8rem;
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
