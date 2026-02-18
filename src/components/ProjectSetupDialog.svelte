<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { createProject, setProjectConfig } from '../lib/ipc'

  const dispatch = createEventDispatcher()

  let projectName = ''
  let path = ''
  let jiraBoardId = ''
  let githubDefaultRepo = ''
  let isSubmitting = false
  let showJiraSection = false
  let showGithubSection = false

  async function handleSubmit() {
    if (!projectName.trim() || !path.trim()) return

    isSubmitting = true
    try {
      const project = await createProject(projectName.trim(), path.trim())

      // Set JIRA config if provided
      if (jiraBoardId.trim()) {
        await setProjectConfig(project.id, 'jira_board_id', jiraBoardId.trim())
      }

      // Set GitHub config if provided
      if (githubDefaultRepo.trim()) {
        await setProjectConfig(project.id, 'github_default_repo', githubDefaultRepo.trim())
      }

      dispatch('project-created', project)
      close()
    } catch (e) {
      console.error('Failed to create project:', e)
    } finally {
      isSubmitting = false
    }
  }

  function close() {
    dispatch('close')
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close()
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      close()
    }
  }
</script>

<div class="overlay" on:click={handleOverlayClick} on:keydown={handleKeydown} role="dialog" aria-modal="true" tabindex="-1">
  <div class="dialog">
    <div class="dialog-header">
      <h2>New Project</h2>
      <button class="close-btn" on:click={close} type="button">X</button>
    </div>

    <form class="dialog-body" on:submit|preventDefault={handleSubmit}>
      <label class="field">
        <span>Project Name <span class="required">*</span></span>
        <input
          type="text"
          bind:value={projectName}
          placeholder="My Awesome Project"
          required
          autofocus
        />
      </label>

      <label class="field">
         <span>Repository Path <span class="required">*</span></span>
         <input
           type="text"
           bind:value={path}
           placeholder="/Users/you/workspace/my-project"
           required
         />
       </label>

      <div class="section-divider"></div>

      <div class="section-toggle">
        <button
          class="toggle-btn"
          on:click={() => showJiraSection = !showJiraSection}
          type="button"
        >
          <span class="toggle-icon" class:expanded={showJiraSection}>▶</span>
          <span>JIRA Configuration (Optional)</span>
        </button>
      </div>

      {#if showJiraSection}
        <div class="section-content">
          <label class="field">
            <span>Board ID</span>
            <input
              type="text"
              bind:value={jiraBoardId}
              placeholder="123"
            />
          </label>
        </div>
      {/if}

      <div class="section-divider"></div>

      <div class="section-toggle">
        <button
          class="toggle-btn"
          on:click={() => showGithubSection = !showGithubSection}
          type="button"
        >
          <span class="toggle-icon" class:expanded={showGithubSection}>▶</span>
          <span>GitHub Configuration (Optional)</span>
        </button>
      </div>

      {#if showGithubSection}
        <div class="section-content">
          <label class="field">
            <span>Default Repository</span>
            <input
              type="text"
              bind:value={githubDefaultRepo}
              placeholder="owner/repo-name"
            />
          </label>
        </div>
      {/if}
    </form>

    <div class="dialog-footer">
      <button class="btn btn-cancel" on:click={close} type="button" disabled={isSubmitting}>
        Cancel
      </button>
      <button
         class="btn btn-submit"
         on:click={handleSubmit}
         type="button"
         disabled={!projectName.trim() || !path.trim() || isSubmitting}
       >
        {isSubmitting ? 'Creating...' : 'Create Project'}
      </button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(2px);
  }

  .dialog {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    width: 90%;
    max-width: 550px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }

  .dialog-header h2 {
    margin: 0;
    font-size: 0.95rem;
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

  .dialog-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field > span {
    font-size: 0.7rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .required {
    color: var(--error);
  }

  .field input {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 10px;
    color: var(--text-primary);
    font-size: 0.8rem;
    outline: none;
    font-family: inherit;
  }

  .field input:focus {
    border-color: var(--accent);
  }

  .section-divider {
    height: 1px;
    background: var(--border);
    margin: 8px 0;
  }

  .section-toggle {
    margin: 4px 0;
  }

  .toggle-btn {
    all: unset;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
    padding: 6px 8px;
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .toggle-btn:hover {
    background: var(--bg-card);
    color: var(--text-primary);
  }

  .toggle-icon {
    font-size: 0.6rem;
    transition: transform 0.2s ease;
  }

  .toggle-icon.expanded {
    transform: rotate(90deg);
  }

  .section-content {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-left: 16px;
    margin-top: 8px;
  }

  .dialog-footer {
    display: flex;
    gap: 10px;
    padding: 16px 20px;
    border-top: 1px solid var(--border);
    justify-content: flex-end;
  }

  .btn {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-cancel {
    background: var(--bg-card);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .btn-cancel:not(:disabled):hover {
    background: var(--bg-primary);
  }

  .btn-submit {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .btn-submit:not(:disabled):hover {
    filter: brightness(1.1);
  }
</style>
