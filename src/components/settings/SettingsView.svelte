<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { activeProjectId, projects, codeCleanupTasksEnabled, error } from '../../lib/stores'
  import {
    deleteProject,
    setWhisperModel,
  } from '../../lib/ipc'
  import { createAction, DEFAULT_ACTIONS } from '../../lib/actions'
  import { DEFAULT_FOCUS_STATES } from '../../lib/boardFilters'
  import { createTrackedDebouncedSave } from '../../lib/createTrackedDebouncedSave'
  import {
    DEFAULT_GITHUB_POLL_INTERVAL_SECONDS,
    loadGlobalSettings,
    loadInstallationStatus,
    loadProjectSettings,
    loadWhisperModelStatuses,
  } from '../../lib/settingsConfig'
  import { mergeUpdatedProject, getProjectIdentity } from '../../lib/settingsProjectSync'
  import { saveGlobalSettings, saveProjectSettings } from '../../lib/settingsSaver'
  import { themeMode, applyTheme } from '../../lib/theme'
  import type { ThemeMode } from '../../lib/theme'
  import type { Action, WhisperModelStatus, WhisperModelSizeId } from '../../lib/types'
  import type { TaskState } from '../../lib/taskState'
  import SettingsGeneralCard from './SettingsGeneralCard.svelte'
  import SettingsFocusFilterCard from './SettingsFocusFilterCard.svelte'
  import SettingsIntegrationsCard from './SettingsIntegrationsCard.svelte'
  import SettingsPreferencesCard from './SettingsPreferencesCard.svelte'
  import SettingsAICard from './SettingsAICard.svelte'
  import SettingsInstructionsCard from './SettingsInstructionsCard.svelte'
  import SettingsCredentialsCard from './SettingsCredentialsCard.svelte'
  import SettingsActionsCard from './SettingsActionsCard.svelte'
  import SettingsExperimentalCard from './SettingsExperimentalCard.svelte'
  import ProjectPageHeader from '../project/ProjectPageHeader.svelte'
  import PluginSettingsPanel from '../plugin/PluginSettingsPanel.svelte'

  interface Props {
    onClose: () => void
    onProjectDeleted: () => void
    mode: 'project' | 'global'
  }

  let { onClose, onProjectDeleted, mode }: Props = $props()

  // Project state
  let projectName = $state('')
  let projectPath = $state('')
  let githubDefaultRepo = $state('')
  let agentInstructions = $state('')
  let aiProvider = $state('claude-code')
  let useWorktrees = $state(true)
  let projectColor = $state('')

  // Global state
  let taskIdPrefix = $state('')
  let githubToken = $state('')
  let githubPollInterval = $state(DEFAULT_GITHUB_POLL_INTERVAL_SECONDS)

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
  // Focus filter state
  let focusFilterStates = $state<TaskState[]>([...DEFAULT_FOCUS_STATES])

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
  const SAVE_DEBOUNCE_MS = 500
  const saveController = createTrackedDebouncedSave({
    delayMs: SAVE_DEBOUNCE_MS,
    save,
  })
  const getInitialActiveSection = () => mode === 'global' ? 'preferences' : 'general'

  let activeSection = $state(getInitialActiveSection())
  let isDeleting = $state(false)
  let confirmingDelete = $state(false)
  let deleteError = $state<string | null>(null)

  // Scroll spy
  let scrollContainer = $state<HTMLDivElement | null>(null)
  let isNavigating = false
  const projectSections = ['general', 'integrations', 'instructions', 'plugins', 'actions']
  const globalSections = ['preferences', 'ai', 'credentials', 'experimental']

  // Derived state
  const hasProject = $derived(!!$activeProjectId)
  const activePage = $derived(mode === 'global' ? 'global' : mode === 'project' ? 'project' : (globalSections.includes(activeSection) ? 'global' : 'project'))

  // Sync project name/path from project list
  $effect(() => {
    const { projectName: nextProjectName, projectPath: nextProjectPath } = getProjectIdentity($activeProjectId, $projects)
    projectName = nextProjectName
    projectPath = nextProjectPath
  })

  // Load project config on activeProjectId change
  $effect(() => {
    const pid = $activeProjectId
    if (pid) {
      loadProjectSettings(pid).then((settings) => {
        githubDefaultRepo = settings.githubDefaultRepo
        agentInstructions = settings.agentInstructions
        aiProvider = settings.aiProvider
        useWorktrees = settings.useWorktrees
        projectColor = settings.projectColor
        actions = settings.actions
        focusFilterStates = settings.focusFilterStates
      })
    } else {
      githubDefaultRepo = ''
      agentInstructions = ''
      aiProvider = 'claude-code'
      useWorktrees = true
      projectColor = ''
      actions = []
      focusFilterStates = [...DEFAULT_FOCUS_STATES]
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
    const [globalSettings, installationStatus, whisperStatuses] = await Promise.all([
      loadGlobalSettings(),
      loadInstallationStatus(),
      loadWhisperModelStatuses(),
    ])

    taskIdPrefix = globalSettings.taskIdPrefix
    githubToken = globalSettings.githubToken
    isCodeCleanupTasksEnabled = globalSettings.codeCleanupTasksEnabled
    $codeCleanupTasksEnabled = isCodeCleanupTasksEnabled
    githubPollInterval = globalSettings.githubPollInterval

    opencodeInstalled = installationStatus.opencodeInstalled
    opencodeVersion = installationStatus.opencodeVersion
    claudeInstalled = installationStatus.claudeInstalled
    claudeVersion = installationStatus.claudeVersion
    claudeAuthenticated = installationStatus.claudeAuthenticated

    modelStatuses = whisperStatuses

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
        await saveProjectSettings({
          projectId: $activeProjectId,
          projectName,
          projectPath,
          githubDefaultRepo,
          agentInstructions,
          aiProvider,
          useWorktrees,
          projectColor,
          actions,
          focusFilterStates,
        })
        $projects = mergeUpdatedProject($projects, {
          id: $activeProjectId,
          name: projectName,
          path: projectPath,
        })
      }
      await saveGlobalSettings({
        taskIdPrefix,
        githubToken,
        codeCleanupTasksEnabled: isCodeCleanupTasksEnabled,
        githubPollInterval,
      })
      saved = true
      setTimeout(() => {
        saved = false
      }, 2000)
    } catch (e) {
      console.error('Failed to save settings:', e)
      $error = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      isSaving = false
    }
  }

  function scheduleSave() {
    void saveController.schedule().catch(() => {})
  }

  function flushPendingSave() {
    return saveController.flush()
  }

  onDestroy(() => {
    void flushPendingSave().catch(() => {})
  })

  function runImmediateSave() {
    return saveController.runImmediately()
  }

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

  async function removeAction(actionId: string) {
    actions = actions.filter((a) => a.id !== actionId)
    if ($activeProjectId) {
      await tick()
      await runImmediateSave()
    }
  }

  function toggleAction(actionId: string) {
    actions = actions.map((a) => (a.id === actionId ? { ...a, enabled: !a.enabled } : a))
  }

  function updateAction(actionId: string, field: string, value: string) {
    actions = actions.map((a) =>
      a.id === actionId ? { ...a, [field]: value } : a
    )
  }

  async function resetActions() {
    actions = [...DEFAULT_ACTIONS]
    if ($activeProjectId) {
      await tick()
      await runImmediateSave()
    }
  }

  async function handleModelChange(newSize: string) {
    await setWhisperModel(newSize as WhisperModelSizeId)
    modelStatuses = await loadWhisperModelStatuses()
  }

  function handleDownloadModel(modelSize: string) {
    downloadingModel = modelSize as WhisperModelSizeId
  }

  async function refreshModelStatuses() {
    downloadingModel = null
    modelStatuses = await loadWhisperModelStatuses()
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

        <SettingsFocusFilterCard
          focusStates={focusFilterStates}
          onFocusStatesChange={(states) => { focusFilterStates = states; scheduleSave() }}
          disabled={!hasProject}
        />

        <SettingsIntegrationsCard
          {githubDefaultRepo}
          disabled={!hasProject}
          onGithubDefaultRepoChange={(v) => { githubDefaultRepo = v; scheduleSave() }}
        />

        <SettingsInstructionsCard
          {agentInstructions}
          disabled={!hasProject}
          onInstructionsChange={(v) => { agentInstructions = v; scheduleSave() }}
        />

        <PluginSettingsPanel
          projectId={$activeProjectId || ''}
          disabled={!hasProject}
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
          {githubToken}
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
