<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { activeProjectId, projects, codeCleanupTasksEnabled, shepherdEnabled, actionItemCount, error } from '../lib/stores'
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
    getShepherdEnabled,
    setShepherdEnabled,
    startShepherd,
    stopShepherd,
    getActionItemCount,
  } from '../lib/ipc'
  import { loadActions, saveActions, createAction, DEFAULT_ACTIONS } from '../lib/actions'
  import { loadBoardColumns, saveBoardColumns } from '../lib/boardColumns'
  import { themeMode, applyTheme } from '../lib/theme'
  import type { ThemeMode } from '../lib/theme'
  import type { Action, WhisperModelStatus, WhisperModelSizeId, BoardColumnConfig } from '../lib/types'
  import SettingsGeneralCard from './SettingsGeneralCard.svelte'
  import SettingsBoardCard from './SettingsBoardCard.svelte'
  import SettingsIntegrationsCard from './SettingsIntegrationsCard.svelte'
  import SettingsPreferencesCard from './SettingsPreferencesCard.svelte'
  import SettingsAICard from './SettingsAICard.svelte'
  import SettingsInstructionsCard from './SettingsInstructionsCard.svelte'
  import SettingsCredentialsCard from './SettingsCredentialsCard.svelte'
  import SettingsActionsCard from './SettingsActionsCard.svelte'
  import SettingsExperimentalCard from './SettingsExperimentalCard.svelte'
  import ProjectPageHeader from './ProjectPageHeader.svelte'
  import SettingsShepherdCard from './SettingsShepherdCard.svelte'

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
  let projectColor = $state('')

  // Global state
  let taskIdPrefix = $state('')
  let jiraBaseUrl = $state('')
  let jiraUsername = $state('')
  let jiraApiToken = $state('')
  let githubToken = $state('')
  let githubPollInterval = $state(30)

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
  let isShepherdEnabled = $state(false)

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

  async function handleShepherdToggle() {
    isShepherdEnabled = !isShepherdEnabled
    $shepherdEnabled = isShepherdEnabled
    if ($activeProjectId) {
      await setShepherdEnabled($activeProjectId, isShepherdEnabled)
      if (isShepherdEnabled) {
        startShepherd($activeProjectId).catch(console.error)
        getActionItemCount($activeProjectId).then((count: number) => {
          $actionItemCount = count
        }).catch(console.error)
      } else {
        stopShepherd().catch(console.error)
        $actionItemCount = 0
      }
    }
  }

  // UI state
  let isSaving = $state(false)
  let saved = $state(false)
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const SAVE_DEBOUNCE_MS = 500

  let activeSection = $state(mode === 'global' ? 'preferences' : 'general')
  let isDeleting = $state(false)
  let confirmingDelete = $state(false)
  let deleteError = $state<string | null>(null)

  // Scroll spy
  let scrollContainer = $state<HTMLDivElement | null>(null)
  let isNavigating = false
  const projectSections = ['general', 'board', 'integrations', 'instructions', 'actions', 'shepherd']
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
        getProjectConfig(pid, 'project_color'),
      ]).then(([boardId, repo, instructions, provider, worktrees, color]) => {
        jiraBoardId = boardId ?? ''
        githubDefaultRepo = repo ?? ''
        agentInstructions = instructions ?? ''
        aiProvider = provider ?? 'claude-code'
        useWorktrees = worktrees !== 'false'
        projectColor = color ?? ''
      })

      getShepherdEnabled(pid).then((enabled) => { isShepherdEnabled = enabled })

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
      projectColor = ''
      actions = []
      boardColumns = []
    }
  })

  // Default to correct page based on mode
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
    const [taskIdPrefixVal, jiraBaseUrlVal, jiraUsernameVal, jiraApiTokenVal, githubTokenVal, codeCleanupTasksEnabledVal, githubPollIntervalVal] =
      await Promise.all([
        getConfig('task_id_prefix'),
        getConfig('jira_base_url'),
        getConfig('jira_username'),
        getConfig('jira_api_token'),
        getConfig('github_token'),
        getConfig('code_cleanup_tasks_enabled'),
        getConfig('github_poll_interval'),
      ])

    if (taskIdPrefixVal) taskIdPrefix = taskIdPrefixVal
    if (jiraBaseUrlVal) jiraBaseUrl = jiraBaseUrlVal
    if (jiraUsernameVal) jiraUsername = jiraUsernameVal
    if (jiraApiTokenVal) jiraApiToken = jiraApiTokenVal
    if (githubTokenVal) githubToken = githubTokenVal
    isCodeCleanupTasksEnabled = codeCleanupTasksEnabledVal === 'true'
    $codeCleanupTasksEnabled = isCodeCleanupTasksEnabled
    githubPollInterval = parseInt(githubPollIntervalVal ?? '30', 10) || 30

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
        await setProjectConfig($activeProjectId, 'project_color', projectColor)
        await saveActions($activeProjectId, actions)
        await saveBoardColumns($activeProjectId, boardColumns)
      }
       await setConfig('task_id_prefix', taskIdPrefix)
       await setConfig('jira_base_url', jiraBaseUrl)
       await setConfig('jira_username', jiraUsername)
       await setConfig('jira_api_token', jiraApiToken)
       await setConfig('github_token', githubToken)
       await setConfig('code_cleanup_tasks_enabled', isCodeCleanupTasksEnabled ? 'true' : 'false')
       await setConfig('github_poll_interval', String(githubPollInterval))
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

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      save()
    }, SAVE_DEBOUNCE_MS)
  }

  function flushPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
      save()
    }
  }

  onDestroy(flushPendingSave)

  async function handleDelete() {
    if (!$activeProjectId) return
    isDeleting = true
    deleteError = null
    try {
      await deleteProject($activeProjectId)
      onProjectDeleted()
      onClose()
    } catch (e) {
      console.error('Failed to delete project:', e)
      deleteError = e instanceof Error ? e.message : String(e)
    } finally {
      isDeleting = false
      confirmingDelete = false
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
  <div bind:this={scrollContainer} class="flex-1 overflow-y-auto" style="background: linear-gradient(180deg, var(--project-bg-alt, oklch(var(--b2))) 0%, var(--project-bg, oklch(var(--b1))) 100%)">
    <div class="px-6 py-6 flex flex-col gap-6">
      <ProjectPageHeader
        title={activePage === 'project'
          ? `${projectName || 'Project'} — Settings`
          : 'Global Settings'}
        subtitle={activePage === 'project'
          ? 'Configure project-specific options'
          : 'Configure global preferences and credentials'}
      >
        {#snippet actions()}
          {#if isSaving}
            <span class="text-xs text-base-content/50">Saving…</span>
          {:else if saved}
            <span class="text-xs text-success">Saved</span>
          {/if}
        {/snippet}
      </ProjectPageHeader>

      {#if activePage === 'project'}
        <SettingsGeneralCard
          {projectName}
          {projectPath}
          {aiProvider}
          {useWorktrees}
          {projectColor}
          disabled={!hasProject}
          {opencodeInstalled}
          {opencodeVersion}
          {claudeInstalled}
          {claudeVersion}
          {claudeAuthenticated}
          onProjectNameChange={(v) => { projectName = v; scheduleSave() }}
          onProjectPathChange={(v) => { projectPath = v; scheduleSave() }}
          onAiProviderChange={(v) => { aiProvider = v; scheduleSave() }}
          onUseWorktreesChange={() => { useWorktrees = !useWorktrees; scheduleSave() }}
          onProjectColorChange={(v) => { projectColor = v; scheduleSave() }}
        />

        <SettingsBoardCard
          columns={boardColumns}
          onColumnsChange={(cols) => { boardColumns = cols; scheduleSave() }}
          disabled={!hasProject}
        />

        <SettingsIntegrationsCard
          {jiraBoardId}
          {githubDefaultRepo}
          disabled={!hasProject}
          onJiraBoardIdChange={(v) => { jiraBoardId = v; scheduleSave() }}
          onGithubDefaultRepoChange={(v) => { githubDefaultRepo = v; scheduleSave() }}
        />

        <SettingsInstructionsCard
          {agentInstructions}
          disabled={!hasProject}
          onInstructionsChange={(v) => { agentInstructions = v; scheduleSave() }}
        />

        <SettingsActionsCard
          {actions}
          disabled={!hasProject}
          onAddAction={() => { addAction(); scheduleSave() }}
          onDeleteAction={removeAction}
          onToggleAction={(id: string) => { toggleAction(id); scheduleSave() }}
          onUpdateAction={(id: string, field: string, value: string) => { updateAction(id, field, value); scheduleSave() }}
          onResetActions={resetActions}
        />

        {#if hasProject}
          <SettingsShepherdCard
            shepherdEnabled={isShepherdEnabled}
            onShepherdToggle={handleShepherdToggle}
          />

          <div class="bg-base-100 rounded-lg border border-error/30 overflow-hidden">
            <div class="px-5 py-3 border-b border-error/30">
              <h3 class="text-sm font-semibold text-error m-0">Danger Zone</h3>
            </div>
            <div class="p-5 flex flex-col gap-3">
              <div class="flex items-center gap-3">
                {#if confirmingDelete}
                  <span class="text-sm text-error">Delete "{projectName}"? This cannot be undone.</span>
                  <button class="btn btn-error btn-sm" onclick={handleDelete} disabled={isDeleting}>
                    {isDeleting ? 'Deleting...' : 'Yes, delete'}
                  </button>
                  <button class="btn btn-ghost btn-sm" onclick={() => { confirmingDelete = false; deleteError = null }} disabled={isDeleting}>
                    Cancel
                  </button>
                {:else}
                  <button class="btn btn-error btn-sm" onclick={() => { confirmingDelete = true; deleteError = null }}>
                    Delete Project
                  </button>
                {/if}
              </div>
              {#if deleteError}
                <p class="text-sm text-error font-mono break-all">{deleteError}</p>
              {/if}
            </div>
          </div>
        {/if}
      {:else}
        <SettingsPreferencesCard
          {taskIdPrefix}
          onTaskIdPrefixChange={(v) => { taskIdPrefix = v; scheduleSave() }}
          {isDarkMode}
          onThemeToggle={() => { handleThemeToggle(); scheduleSave() }}
          {githubPollInterval}
          onGithubPollIntervalChange={(v) => { githubPollInterval = v; scheduleSave() }}
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
          onJiraBaseUrlChange={(v: string) => { jiraBaseUrl = v; scheduleSave() }}
          onJiraUsernameChange={(v: string) => { jiraUsername = v; scheduleSave() }}
          onJiraApiTokenChange={(v: string) => { jiraApiToken = v; scheduleSave() }}
          onGithubTokenChange={(v: string) => { githubToken = v; scheduleSave() }}
        />

        <SettingsExperimentalCard
          codeCleanupTasksEnabled={isCodeCleanupTasksEnabled}
          onCodeCleanupTasksToggle={() => { handleCodeCleanupTasksToggle(); scheduleSave() }}
        />
      {/if}
    </div>
  </div>
</div>
