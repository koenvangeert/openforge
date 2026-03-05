<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { activeProjectId, projects } from '../lib/stores'
  import {
    getProjectConfig,
    setProjectConfig,
    updateProject,
    deleteProject,
    getAgents,
    getConfig,
    setConfig,
    checkOpenCodeInstalled,
    checkClaudeInstalled,
    getAllWhisperModelStatuses,
    setWhisperModel,
  } from '../lib/ipc'
  import { loadActions, saveActions, createAction, DEFAULT_ACTIONS } from '../lib/actions'
  import type { Action, AgentInfo, WhisperModelStatus, WhisperModelSizeId } from '../lib/types'
  import SettingsSidebar from './SettingsSidebar.svelte'
  import SettingsGeneralCard from './SettingsGeneralCard.svelte'
  import SettingsIntegrationsCard from './SettingsIntegrationsCard.svelte'
  import SettingsAICard from './SettingsAICard.svelte'
  import SettingsCredentialsCard from './SettingsCredentialsCard.svelte'
  import SettingsActionsCard from './SettingsActionsCard.svelte'

  interface Props {
    onClose: () => void
    onProjectDeleted: () => void
  }

  let { onClose, onProjectDeleted }: Props = $props()

  // Project state
  let projectName = $state('')
  let projectPath = $state('')
  let jiraBoardId = $state('')
  let githubDefaultRepo = $state('')
  let agentInstructions = $state('')

  // Global state
  let aiProvider = $state('claude-code')
  let jiraBaseUrl = $state('')
  let jiraUsername = $state('')
  let jiraApiToken = $state('')
  let githubToken = $state('')

  // AI state
  let modelStatuses = $state<WhisperModelStatus[]>([])
  let downloadingModel = $state<WhisperModelSizeId | null>(null)
  let opencodeInstalled = $state(false)
  let opencodeVersion = $state<string | null>(null)
  let claudeInstalled = $state(false)
  let claudeVersion = $state<string | null>(null)
  let claudeAuthenticated = $state(false)

  // Actions state
  let actions = $state<Action[]>([])
  let availableAgents = $state<AgentInfo[]>([])

  // UI state
  let isSaving = $state(false)
  let saved = $state(false)
  let activeSection = $state('general')
  let isDeleting = $state(false)

  // Scroll spy
  let observer: IntersectionObserver | null = null

  // Derived state
  const hasProject = $derived(!!$activeProjectId)
  const aiProviderInstalled = $derived(
    aiProvider === 'claude-code' ? claudeInstalled : opencodeInstalled
  )
  const aiProviderVersion = $derived(
    aiProvider === 'claude-code' ? claudeVersion : opencodeVersion
  )

  // Load project config on activeProjectId change
  $effect(() => {
    const pid = $activeProjectId
    if (pid) {
      // Sync name/path from project list
      const proj = $projects.find((p) => p.id === pid)
      if (proj) {
        projectName = proj.name
        projectPath = proj.path
      }

      // Load project-level config keys
      Promise.all([
        getProjectConfig(pid, 'jira_board_id'),
        getProjectConfig(pid, 'github_default_repo'),
        getProjectConfig(pid, 'additional_instructions'),
      ]).then(([boardId, repo, instructions]) => {
        jiraBoardId = boardId ?? ''
        githubDefaultRepo = repo ?? ''
        agentInstructions = instructions ?? ''
      })

      // Load actions
      loadActions(pid).then((loaded) => {
        actions = loaded
      })
    } else {
      projectName = ''
      projectPath = ''
      jiraBoardId = ''
      githubDefaultRepo = ''
      agentInstructions = ''
      actions = []
    }
  })

  // Load global config once on mount
  onMount(async () => {
    // Global config
    const [aiProviderVal, jiraBaseUrlVal, jiraUsernameVal, jiraApiTokenVal, githubTokenVal] =
      await Promise.all([
        getConfig('ai_provider'),
        getConfig('jira_base_url'),
        getConfig('jira_username'),
        getConfig('jira_api_token'),
        getConfig('github_token'),
      ])

    if (aiProviderVal) aiProvider = aiProviderVal
    if (jiraBaseUrlVal) jiraBaseUrl = jiraBaseUrlVal
    if (jiraUsernameVal) jiraUsername = jiraUsernameVal
    if (jiraApiTokenVal) jiraApiToken = jiraApiTokenVal
    if (githubTokenVal) githubToken = githubTokenVal

    // Check installations
    const [opencodeResult, claudeResult] = await Promise.all([
      checkOpenCodeInstalled().catch(() => ({ installed: false, path: null, version: null })),
      checkClaudeInstalled().catch(() => ({
        installed: false,
        path: null,
        version: null,
        authenticated: false,
      })),
    ])

    opencodeInstalled = opencodeResult.installed
    opencodeVersion = opencodeResult.version
    claudeInstalled = claudeResult.installed
    claudeVersion = claudeResult.version
    claudeAuthenticated = (claudeResult as { authenticated: boolean }).authenticated ?? false

    // Load model statuses
    modelStatuses = await getAllWhisperModelStatuses().catch(() => [])

    // Load agents
    availableAgents = await getAgents().catch(() => [])

    if (typeof IntersectionObserver !== 'undefined') {
      const sections = document.querySelectorAll('[id^="section-"]')
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              activeSection = entry.target.id.replace('section-', '')
            }
          }
        },
        { threshold: 0.3 }
      )
      sections.forEach((s) => observer?.observe(s))
    }
  })

  onDestroy(() => {
    observer?.disconnect()
  })

  function handleNavigate(sectionId: string) {
    document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth' })
  }

  async function save() {
    isSaving = true
    try {
      if (hasProject && $activeProjectId) {
        await updateProject($activeProjectId, projectName, projectPath)
        await setProjectConfig($activeProjectId, 'jira_board_id', jiraBoardId)
        await setProjectConfig($activeProjectId, 'github_default_repo', githubDefaultRepo)
        await setProjectConfig($activeProjectId, 'additional_instructions', agentInstructions)
        await saveActions($activeProjectId, actions)
      }
      await setConfig('ai_provider', aiProvider)
      await setConfig('jira_base_url', jiraBaseUrl)
      await setConfig('jira_username', jiraUsername)
      await setConfig('jira_api_token', jiraApiToken)
      await setConfig('github_token', githubToken)
      saved = true
      setTimeout(() => {
        saved = false
      }, 2000)
    } finally {
      isSaving = false
    }
  }

  async function handleDelete() {
    if (!$activeProjectId) return
    const confirmed = confirm(
      `Are you sure you want to delete project "${projectName}"? This action cannot be undone.`
    )
    if (!confirmed) return
    isDeleting = true
    try {
      await deleteProject($activeProjectId)
      onProjectDeleted()
      onClose()
    } catch (e) {
      console.error('Failed to delete project:', e)
    } finally {
      isDeleting = false
    }
  }

  function addAction() {
    actions = [...actions, createAction('New Action', '')]
  }

  function removeAction(actionId: string) {
    const action = actions.find((a) => a.id === actionId)
    if (action?.builtin) {
      if (!confirm(`Delete built-in action "${action.name}"?`)) return
    }
    actions = actions.filter((a) => a.id !== actionId)
  }

  function toggleAction(actionId: string) {
    actions = actions.map((a) => (a.id === actionId ? { ...a, enabled: !a.enabled } : a))
  }

  function updateAction(actionId: string, field: string, value: string) {
    actions = actions.map((a) =>
      a.id === actionId ? { ...a, [field]: field === 'agent' ? value || null : value } : a
    )
  }

  function resetActions() {
    if (!confirm('Reset all actions to defaults?')) return
    actions = [...DEFAULT_ACTIONS]
  }

  async function handleModelChange(newSize: string) {
    await setWhisperModel(newSize as WhisperModelSizeId)
    modelStatuses = await getAllWhisperModelStatuses().catch(() => [])
  }

  function handleDownloadModel(modelSize: string) {
    downloadingModel = modelSize as WhisperModelSizeId
  }

  async function refreshModelStatuses() {
    downloadingModel = null
    modelStatuses = await getAllWhisperModelStatuses().catch(() => [])
  }
</script>

<div class="flex h-full">
  <SettingsSidebar {activeSection} onNavigate={handleNavigate} {hasProject} />

  <div class="flex-1 overflow-y-auto bg-base-200">
    <div class="max-w-4xl mx-auto px-6 py-6 flex flex-col gap-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-lg font-semibold text-base-content m-0">Settings</h1>
          <p class="text-xs text-base-content/50 mt-1">Manage project and global configuration</p>
        </div>
        <button class="btn btn-primary btn-sm" onclick={save} disabled={isSaving}>
          {#if isSaving}
            Saving...
          {:else if saved}
            Saved!
          {:else}
            Save Settings
          {/if}
        </button>
      </div>

      {#if hasProject}
        <SettingsGeneralCard
          {projectName}
          {projectPath}
          disabled={!hasProject}
          onProjectNameChange={(v) => (projectName = v)}
          onProjectPathChange={(v) => (projectPath = v)}
        />

        <SettingsIntegrationsCard
          {jiraBoardId}
          {githubDefaultRepo}
          disabled={!hasProject}
          onJiraBoardIdChange={(v) => (jiraBoardId = v)}
          onGithubDefaultRepoChange={(v) => (githubDefaultRepo = v)}
        />
      {/if}

      <SettingsAICard
        {aiProvider}
        {aiProviderInstalled}
        aiProviderVersion={aiProviderVersion}
        {claudeAuthenticated}
        {opencodeInstalled}
        {opencodeVersion}
        {claudeInstalled}
        {claudeVersion}
        {modelStatuses}
        activeModelSize={modelStatuses.find((m) => m.is_active)?.size ?? null}
        {downloadingModel}
        {agentInstructions}
        disabled={!hasProject}
        onAiProviderChange={(v) => (aiProvider = v)}
        onWhisperModelSelect={handleModelChange}
        onInstructionsChange={(v) => (agentInstructions = v)}
        onDownloadModel={handleDownloadModel}
        onDownloadComplete={refreshModelStatuses}
        onDownloadError={() => {
          downloadingModel = null
        }}
      />

      <SettingsCredentialsCard
        {jiraBaseUrl}
        {jiraUsername}
        {jiraApiToken}
        {githubToken}
        onJiraBaseUrlChange={(v: string) => (jiraBaseUrl = v)}
        onJiraUsernameChange={(v: string) => (jiraUsername = v)}
        onJiraApiTokenChange={(v: string) => (jiraApiToken = v)}
        onGithubTokenChange={(v: string) => (githubToken = v)}
      />

      {#if hasProject}
        <SettingsActionsCard
          {actions}
          availableAgents={availableAgents.map((a) => a.name)}
          {aiProvider}
          disabled={!hasProject}
          onAddAction={addAction}
          onDeleteAction={removeAction}
          onToggleAction={toggleAction}
          onUpdateAction={updateAction}
          onResetActions={resetActions}
        />

        <div class="bg-base-100 rounded-lg border border-error/30 overflow-hidden">
          <div class="px-5 py-3 border-b border-error/30">
            <h3 class="text-sm font-semibold text-error m-0">Danger Zone</h3>
          </div>
          <div class="p-5">
            <button class="btn btn-error btn-sm" onclick={handleDelete} disabled={isDeleting}>
              {#if isDeleting}
                Deleting...
              {:else}
                Delete Project
              {/if}
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
