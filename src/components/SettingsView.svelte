<script lang="ts">
  import { onMount } from 'svelte'
  import { activeProjectId, projects, codeCleanupTasksEnabled, error } from '../lib/stores'
  import {
    getProjectConfig,
    setProjectConfig,
    updateProject,
    deleteProject,
    getConfig,
    setConfig,
    checkOpenCodeInstalled,
    checkClaudeInstalled,
    getAllWhisperModelStatuses,
    setWhisperModel,
  } from '../lib/ipc'
  import { loadActions, saveActions, createAction, DEFAULT_ACTIONS } from '../lib/actions'
  import { loadBoardColumns, saveBoardColumns } from '../lib/boardColumns'
  import { themeMode, applyTheme } from '../lib/theme'
  import type { ThemeMode } from '../lib/theme'
  import type { Action, WhisperModelStatus, WhisperModelSizeId, BoardColumnConfig } from '../lib/types'
  import SettingsSidebar from './SettingsSidebar.svelte'
  import SettingsGeneralCard from './SettingsGeneralCard.svelte'
  import SettingsBoardCard from './SettingsBoardCard.svelte'
  import SettingsIntegrationsCard from './SettingsIntegrationsCard.svelte'
  import SettingsPreferencesCard from './SettingsPreferencesCard.svelte'
  import SettingsAICard from './SettingsAICard.svelte'
  import SettingsInstructionsCard from './SettingsInstructionsCard.svelte'
  import SettingsCredentialsCard from './SettingsCredentialsCard.svelte'
  import SettingsActionsCard from './SettingsActionsCard.svelte'
  import SettingsExperimentalCard from './SettingsExperimentalCard.svelte'

  interface Props {
    onClose: () => void
    onProjectDeleted: () => void
    mode: 'project' | 'global'
  }

  let { onClose, onProjectDeleted, mode }: Props = $props()

  // Project state
  let projectName = $state('')
  let projectPath = $state('')
  let jiraBoardId = $state('')
  let githubDefaultRepo = $state('')
  let agentInstructions = $state('')
  let aiProvider = $state('claude-code')
  let useWorktrees = $state(true)

  // Global state
  let taskIdPrefix = $state('')
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
  // Board state
  let boardColumns = $state<BoardColumnConfig[]>([])

  // Feature flag state
  let isCodeCleanupTasksEnabled = $state($codeCleanupTasksEnabled)

  // Theme state
  let isDarkMode = $state($themeMode === 'dark')

  $effect(() => {
    isDarkMode = $themeMode === 'dark'
  })

  function handleThemeToggle() {
    const next: ThemeMode = isDarkMode ? 'light' : 'dark'
    applyTheme(next)
  }

  function handleCodeCleanupTasksToggle() {
    isCodeCleanupTasksEnabled = !isCodeCleanupTasksEnabled
    $codeCleanupTasksEnabled = isCodeCleanupTasksEnabled
  }

  // UI state
  let isSaving = $state(false)
  let saved = $state(false)
  let activeSection = $state(mode === 'global' ? 'preferences' : 'general')
  let isDeleting = $state(false)

  // Scroll spy
  let scrollContainer = $state<HTMLDivElement | null>(null)
  let isNavigating = false
  const projectSections = ['general', 'board', 'integrations', 'instructions', 'actions']
  const globalSections = ['preferences', 'ai', 'credentials', 'experimental']

  // Derived state
  const hasProject = $derived(!!$activeProjectId)
  const activePage = $derived(mode === 'global' ? 'global' : mode === 'project' ? 'project' : (globalSections.includes(activeSection) ? 'global' : 'project'))

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
        getProjectConfig(pid, 'ai_provider'),
        getProjectConfig(pid, 'use_worktrees'),
      ]).then(([boardId, repo, instructions, provider, worktrees]) => {
        jiraBoardId = boardId ?? ''
        githubDefaultRepo = repo ?? ''
        agentInstructions = instructions ?? ''
        aiProvider = provider ?? 'claude-code'
        useWorktrees = worktrees !== 'false'
      })

      // Load actions
      loadActions(pid).then((loaded) => {
        actions = loaded
      })

      // Load board columns
      loadBoardColumns(pid).then((cols) => {
        boardColumns = cols
      })
    } else {
      projectName = ''
      projectPath = ''
      jiraBoardId = ''
      githubDefaultRepo = ''
      agentInstructions = ''
      aiProvider = 'claude-code'
      useWorktrees = true
      actions = []
      boardColumns = []
    }
  })

  // Default to global page when no project is active, or when in global mode
  $effect(() => {
    if (mode === 'global' && projectSections.includes(activeSection)) {
      activeSection = 'preferences'
    } else if (mode === 'project' && globalSections.includes(activeSection)) {
      activeSection = 'general'
    } else if (!hasProject && projectSections.includes(activeSection)) {
      activeSection = 'preferences'
    }
  })

  // Load global config once on mount
  onMount(async () => {
    // Global config
    const [taskIdPrefixVal, jiraBaseUrlVal, jiraUsernameVal, jiraApiTokenVal, githubTokenVal, codeCleanupTasksEnabledVal] =
      await Promise.all([
        getConfig('task_id_prefix'),
        getConfig('jira_base_url'),
        getConfig('jira_username'),
        getConfig('jira_api_token'),
        getConfig('github_token'),
        getConfig('code_cleanup_tasks_enabled'),
      ])

    if (taskIdPrefixVal) taskIdPrefix = taskIdPrefixVal
    if (jiraBaseUrlVal) jiraBaseUrl = jiraBaseUrlVal
    if (jiraUsernameVal) jiraUsername = jiraUsernameVal
    if (jiraApiTokenVal) jiraApiToken = jiraApiTokenVal
    if (githubTokenVal) githubToken = githubTokenVal
    isCodeCleanupTasksEnabled = codeCleanupTasksEnabledVal === 'true'
    $codeCleanupTasksEnabled = isCodeCleanupTasksEnabled

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

  })

  // Scroll spy: re-observe whenever conditional sections mount/unmount
  $effect(() => {
    const container = scrollContainer
    void hasProject
    const sections = activePage === 'project' ? projectSections : globalSections

    if (!container || typeof IntersectionObserver === 'undefined') return

    const visible = new Set<string>()

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace('section-', '')
          if (entry.isIntersecting) {
            visible.add(id)
          } else {
            visible.delete(id)
          }
        }
        if (isNavigating) return
        for (const id of sections) {
          if (visible.has(id)) {
            activeSection = id
            return
          }
        }
      },
      {
        root: container,
        rootMargin: '0px 0px -50% 0px',
        threshold: 0,
      }
    )

    container.querySelectorAll('[id^="section-"]').forEach((s) => {
      obs.observe(s)
    })

    return () => obs.disconnect()
  })

  function handleNavigate(sectionId: string) {
    isNavigating = true
    activeSection = sectionId
    document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth' })
    setTimeout(() => {
      isNavigating = false
    }, 800)
  }

  async function save() {
    isSaving = true
    try {
      if (hasProject && $activeProjectId) {
        await updateProject($activeProjectId, projectName, projectPath)
        await setProjectConfig($activeProjectId, 'jira_board_id', jiraBoardId)
        await setProjectConfig($activeProjectId, 'github_default_repo', githubDefaultRepo)
        await setProjectConfig($activeProjectId, 'additional_instructions', agentInstructions)
        await setProjectConfig($activeProjectId, 'ai_provider', aiProvider)
        await setProjectConfig($activeProjectId, 'use_worktrees', useWorktrees ? 'true' : 'false')
        await saveActions($activeProjectId, actions)
        await saveBoardColumns($activeProjectId, boardColumns)
      }
      await setConfig('task_id_prefix', taskIdPrefix)
      await setConfig('jira_base_url', jiraBaseUrl)
      await setConfig('jira_username', jiraUsername)
      await setConfig('jira_api_token', jiraApiToken)
      await setConfig('github_token', githubToken)
      await setConfig('code_cleanup_tasks_enabled', isCodeCleanupTasksEnabled ? 'true' : 'false')
      saved = true
      setTimeout(() => {
        saved = false
      }, 2000)
    } catch (e) {
      console.error('Failed to save settings:', e)
      $error = e instanceof Error ? e.message : String(e)
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
    actions = actions.filter((a) => a.id !== actionId)
    if ($activeProjectId) saveActions($activeProjectId, actions)
  }

  function toggleAction(actionId: string) {
    actions = actions.map((a) => (a.id === actionId ? { ...a, enabled: !a.enabled } : a))
  }

  function updateAction(actionId: string, field: string, value: string) {
    actions = actions.map((a) =>
      a.id === actionId ? { ...a, [field]: value } : a
    )
  }

  function resetActions() {
    actions = [...DEFAULT_ACTIONS]
    if ($activeProjectId) saveActions($activeProjectId, actions)
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

<div class="flex h-full w-full">
  <SettingsSidebar {activeSection} onNavigate={handleNavigate} {hasProject} {mode} />

  <div bind:this={scrollContainer} class="flex-1 overflow-y-auto bg-base-200">
    <div class="px-6 py-6 flex flex-col gap-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-lg font-semibold text-base-content m-0">
            {activePage === 'project' ? 'Project Settings' : 'Global Settings'}
          </h1>
          <p class="text-xs text-base-content/50 mt-1">
            {activePage === 'project'
              ? 'Configure project-specific options'
              : 'Configure global preferences and credentials'}
          </p>
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

      {#if activePage === 'project'}
        <SettingsGeneralCard
          {projectName}
          {projectPath}
          {aiProvider}
          {useWorktrees}
          disabled={!hasProject}
          {opencodeInstalled}
          {opencodeVersion}
          {claudeInstalled}
          {claudeVersion}
          {claudeAuthenticated}
          onProjectNameChange={(v) => (projectName = v)}
          onProjectPathChange={(v) => (projectPath = v)}
          onAiProviderChange={(v) => (aiProvider = v)}
          onUseWorktreesChange={() => (useWorktrees = !useWorktrees)}
        />

        <SettingsBoardCard
          columns={boardColumns}
          onColumnsChange={(cols) => (boardColumns = cols)}
          disabled={!hasProject}
        />

        <SettingsIntegrationsCard
          {jiraBoardId}
          {githubDefaultRepo}
          disabled={!hasProject}
          onJiraBoardIdChange={(v) => (jiraBoardId = v)}
          onGithubDefaultRepoChange={(v) => (githubDefaultRepo = v)}
        />

        <SettingsInstructionsCard
          {agentInstructions}
          disabled={!hasProject}
          onInstructionsChange={(v) => (agentInstructions = v)}
        />

        <SettingsActionsCard
          {actions}
          disabled={!hasProject}
          onAddAction={addAction}
          onDeleteAction={removeAction}
          onToggleAction={toggleAction}
          onUpdateAction={updateAction}
          onResetActions={resetActions}
        />

        {#if hasProject}
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
      {:else}
        <SettingsPreferencesCard
          {taskIdPrefix}
          onTaskIdPrefixChange={(v) => (taskIdPrefix = v)}
          {isDarkMode}
          onThemeToggle={handleThemeToggle}
        />

        <SettingsAICard
          {modelStatuses}
          activeModelSize={modelStatuses.find((m) => m.is_active)?.size ?? null}
          {downloadingModel}
          onWhisperModelSelect={handleModelChange}
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

        <SettingsExperimentalCard
          codeCleanupTasksEnabled={isCodeCleanupTasksEnabled}
          onCodeCleanupTasksToggle={handleCodeCleanupTasksToggle}
        />
      {/if}
    </div>
  </div>
</div>
