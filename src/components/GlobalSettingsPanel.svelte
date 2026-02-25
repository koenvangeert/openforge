<script lang="ts">
  import { onMount } from 'svelte'
  import { getConfig, setConfig, checkOpenCodeInstalled, checkClaudeInstalled } from '../lib/ipc'

  interface Props {
    onClose?: () => void
  }

  let { onClose }: Props = $props()

  let aiProvider = $state('opencode')
  let opencodeInstalled = $state(false)
  let opencodeVersion = $state<string | null>(null)
  let claudeInstalled = $state(false)
  let claudeVersion = $state<string | null>(null)
  let claudeAuthenticated = $state(false)
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
      aiProvider = (await getConfig('ai_provider')) || 'opencode'
      jiraBaseUrl = (await getConfig('jira_base_url')) || ''
      jiraUsername = (await getConfig('jira_username')) || ''
      jiraApiToken = (await getConfig('jira_api_token')) || ''
      githubToken = (await getConfig('github_token')) || ''
    } catch (e) {
      console.error('Failed to load global settings:', e)
    }
    try {
      const ocStatus = await checkOpenCodeInstalled()
      opencodeInstalled = ocStatus.installed
      opencodeVersion = ocStatus.version
    } catch { /* silent */ }
    try {
      const ccStatus = await checkClaudeInstalled()
      claudeInstalled = ccStatus.installed
      claudeVersion = ccStatus.version
      claudeAuthenticated = ccStatus.authenticated
    } catch { /* silent */ }
  }

  async function save() {
    isSaving = true
    saved = false
    try {
      await setConfig('ai_provider', aiProvider)
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

<div class="flex flex-col h-full w-full bg-base-200">
  <div class="flex items-center justify-between px-6 py-4 border-b border-base-300">
    <h2 class="text-[0.9rem] font-semibold text-base-content m-0">Global Settings</h2>
    <button class="btn btn-ghost btn-xs text-base-content/50 hover:bg-error hover:text-error-content" onclick={close}>✕</button>
  </div>

  <div class="flex-1 overflow-y-auto">
    <div class="py-5 flex flex-col gap-6 max-w-4xl mx-auto w-full px-6">
    <section class="flex flex-col gap-2">
      <h3 class="text-xs font-semibold text-primary uppercase tracking-wider mb-3 mt-0">AI Provider</h3>
      <label class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50">Provider</span>
        <select bind:value={aiProvider} class="select select-bordered select-sm w-full">
          <option value="opencode">OpenCode</option>
          <option value="claude-code">Claude Code</option>
        </select>
      </label>
      <!-- Install status indicators -->
      <div class="flex flex-col gap-1 text-xs">
        <div class="flex items-center gap-2">
          {#if opencodeInstalled}
            <span class="text-success">✓</span>
            <span>OpenCode {opencodeVersion || ''}</span>
          {:else}
            <span class="text-error">✗</span>
            <span class="text-base-content/50">OpenCode not installed</span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          {#if claudeInstalled}
            <span class="text-success">✓</span>
            <span>Claude Code {claudeVersion || ''}</span>
            {#if claudeAuthenticated}
              <span class="badge badge-xs badge-success">Authenticated</span>
            {:else}
              <span class="badge badge-xs badge-warning">Not authenticated</span>
            {/if}
          {:else}
            <span class="text-error">✗</span>
            <span class="text-base-content/50">Claude Code not installed</span>
          {/if}
        </div>
      </div>
      <!-- Warning if selected provider not installed -->
      {#if (aiProvider === 'opencode' && !opencodeInstalled) || (aiProvider === 'claude-code' && !claudeInstalled)}
        <div class="alert alert-warning text-xs py-2">
          <span>⚠ Selected provider is not installed</span>
        </div>
      {/if}
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="text-xs font-semibold text-primary uppercase tracking-wider mb-3 mt-0">JIRA</h3>
      <label class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50">Base URL</span>
        <input type="text" bind:value={jiraBaseUrl} placeholder="https://your-domain.atlassian.net" class="input input-bordered input-sm w-full" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50">Email / Username</span>
        <input type="text" bind:value={jiraUsername} placeholder="your@email.com" class="input input-bordered input-sm w-full" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50">API Token</span>
        <input type="password" bind:value={jiraApiToken} placeholder="Your JIRA API token" class="input input-bordered input-sm w-full" />
      </label>
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="text-xs font-semibold text-primary uppercase tracking-wider mb-3 mt-0">GitHub</h3>
      <label class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50">Personal Access Token</span>
        <input type="password" bind:value={githubToken} placeholder="ghp_..." class="input input-bordered input-sm w-full" />
      </label>
    </section>
    </div>
  </div>

  <div class="border-t border-base-300">
    <div class="py-4 max-w-4xl mx-auto w-full px-6">
      <button class="btn btn-primary btn-block" onclick={save} disabled={isSaving}>
        {#if isSaving}Saving...{:else if saved}Saved!{:else}Save Settings{/if}
      </button>
    </div>
  </div>

</div>
