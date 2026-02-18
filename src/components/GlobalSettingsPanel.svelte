<script lang="ts">
  import { onMount } from 'svelte'
  import { getConfig, setConfig } from '../lib/ipc'

  interface Props {
    onClose?: () => void
  }

  let { onClose }: Props = $props()

  let jiraBaseUrl = $state('')
  let jiraUsername = $state('')
  let jiraApiToken = $state('')
  let githubToken = $state('')
  let isSaving = $state(false)
  let saved = $state(false)

  onMount(() => {
    loadConfig()
  })

  async function loadConfig() {
    try {
      jiraBaseUrl = (await getConfig('jira_base_url')) || ''
      jiraUsername = (await getConfig('jira_username')) || ''
      jiraApiToken = (await getConfig('jira_api_token')) || ''
      githubToken = (await getConfig('github_token')) || ''
    } catch (e) {
      console.error('Failed to load global settings:', e)
    }
  }

  async function save() {
    isSaving = true
    saved = false
    try {
      await setConfig('jira_base_url', jiraBaseUrl)
      await setConfig('jira_username', jiraUsername)
      await setConfig('jira_api_token', jiraApiToken)
      await setConfig('github_token', githubToken)
      saved = true
      setTimeout(() => { saved = false }, 2000)
    } catch (e) {
      console.error('Failed to save global settings:', e)
    } finally {
      isSaving = false
    }
  }

  function close() {
    onClose?.()
  }
</script>

<div class="settings">
  <div class="settings-header">
    <h2>Global Settings</h2>
    <button class="close-btn" onclick={close}>X</button>
  </div>

  <div class="settings-body">
    <section class="section">
      <h3>JIRA</h3>
      <label class="field">
        <span>Base URL</span>
        <input type="text" bind:value={jiraBaseUrl} placeholder="https://your-domain.atlassian.net" />
      </label>
      <label class="field">
        <span>Email / Username</span>
        <input type="text" bind:value={jiraUsername} placeholder="your@email.com" />
      </label>
      <label class="field">
        <span>API Token</span>
        <input type="password" bind:value={jiraApiToken} placeholder="Your JIRA API token" />
      </label>
    </section>

    <section class="section">
      <h3>GitHub</h3>
      <label class="field">
        <span>Personal Access Token</span>
        <input type="password" bind:value={githubToken} placeholder="ghp_..." />
      </label>
    </section>
  </div>

  <div class="settings-footer">
    <button class="btn btn-save" onclick={save} disabled={isSaving}>
      {#if isSaving}Saving...{:else if saved}Saved!{:else}Save Settings{/if}
    </button>
  </div>
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

</style>
