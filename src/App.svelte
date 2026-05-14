<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import type { DesktopUnlistenFn } from './lib/desktopIpc'
  import { createDesktopWindow } from './lib/desktopWindow'
  import type { DesktopWindowTarget } from './lib/desktopWindow'
  import { tasks, pendingTask, selectedTaskId, activeSessions, ticketPrs, isLoading, projects, activeProjectId, activeProjectColorId, currentView, reviewRequestCount, authoredPrCount, codeCleanupTasksEnabled, focusBoardFilters } from './lib/stores'
  import { getAppMode, getConfig, getProjectConfig, resumeStartupSessions } from './lib/ipc'
  import type { Task, AppView } from './lib/types'
  import FocusBoard from './components/focus-board/FocusBoard.svelte'
  import TaskDetailView from './components/task-detail/TaskDetailView.svelte'
  import AddTaskDialog from './components/AddTaskDialog.svelte'
  import Modal from './components/shared/ui/Modal.svelte'
  import Toast from './components/feedback/toasts/Toast.svelte'
  import CheckpointToast from './components/feedback/toasts/CheckpointToast.svelte'
  import CiFailureToast from './components/feedback/toasts/CiFailureToast.svelte'
  import TaskSpawnedToast from './components/feedback/toasts/TaskSpawnedToast.svelte'
  import RateLimitToast from './components/feedback/toasts/RateLimitToast.svelte'
  import AppSidebar from './components/shell/AppSidebar.svelte'
  import ProjectSwitcherModal from './components/project/ProjectSwitcherModal.svelte'
  import ProjectSetupDialog from './components/project/ProjectSetupDialog.svelte'
  import IconRail from './components/shell/IconRail.svelte'
  import CommandPalette from './components/shell/CommandPalette.svelte'
  import ActionPalette from './components/shell/ActionPalette.svelte'
  import FileQuickOpen from './components/shell/FileQuickOpen.svelte'
  import PluginSlot from './components/plugin/PluginSlot.svelte'

  import { resolveContributions } from './lib/plugin/contributionResolver'
  import { enabledPluginIds, installedPlugins, loadEnabledForProject, runtimeContributionSources } from './lib/plugin/pluginStore'
  import { isPluginViewKey, makePluginViewKey } from './lib/plugin/types'
  import { activatePlugin, executePluginCommand, initializePluginRuntime } from './lib/plugin/pluginRegistry'
  import { useAppRouter } from './lib/router.svelte'
  import { getProjectColor } from './lib/projectColors'
  import { themeMode } from './lib/theme'
  import { useCommandHeld } from './lib/useCommandHeld.svelte'
  import { useShortcutRegistry } from './lib/shortcuts.svelte'
  import { ICON_RAIL_HIDDEN_VIEWS, getViews } from './lib/views'
  import { registerAppShortcuts } from './lib/appShortcuts'
  import { getGlobalShortcutHelpEntries } from './lib/appShortcutDefinitions'
  import { registerAppDesktopEventListeners } from './lib/appDesktopEventListeners'
  import { loadAppStartupData } from './lib/appStartup'
  import { useAppDataOrchestrator } from './lib/appDataOrchestrator.svelte'
  import { createTaskActionRunner } from './lib/taskActionRunner'
  import { useActionPaletteController } from './lib/actionPaletteController.svelte'
  
  let unlisteners: DesktopUnlistenFn[] = []
  let showAddDialog = $state(false)
  let editingTask = $state<Task | null>(null)
  let shortcuts: ReturnType<typeof useShortcutRegistry> | null = $state(null)

  let showProjectSetup = $state(false)
  let appMode = $state<string | null>(null)
  let showShortcutsDialog = $state(false)
  let showCloseConfirm = $state(false)
  let showProjectSwitcher = $state(false)
  let appSidebarCollapsed = $state(localStorage.getItem('appSidebarCollapsed') === 'true')
  let showCommandPalette = $state(false)
  let showFileQuickOpen = $state(false)
  let router = useAppRouter()
  let registeredPluginShortcuts = new Set<string>()
  const globalShortcutHelpEntries = getGlobalShortcutHelpEntries()
  let previousPluginProjectId = $state<string | null>(null)
  let appWindow: DesktopWindowTarget | null = null

  useCommandHeld()

  let selectedTask = $derived(
    $tasks.find(t => t.id === $selectedTaskId) ||
      ($pendingTask?.id === $selectedTaskId ? $pendingTask : null)
  )
  let previousActiveProjectId: string | null = $state(null)
  let enabledPluginContributionSources = $derived(
    Array.from($enabledPluginIds)
      .map((id) => $runtimeContributionSources.get(id))
      .filter((source) => source !== undefined)
  )
  let activeProject = $derived($projects.find(p => p.id === $activeProjectId) || null)
  const appData = useAppDataOrchestrator({
    setShowProjectSetup: (show) => { showProjectSetup = show },
  })
  const taskActions = createTaskActionRunner({
    getActiveProject: () => activeProject,
    loadTasks: appData.loadTasks,
    triggerGithubSync: appData.triggerGithubSync,
  })
  const actionPalette = useActionPaletteController({
    getSelectedTask: () => selectedTask,
    taskActions,
    goBack: () => { router.back() },
    showSearchTasks: () => { showCommandPalette = true },
    showNewTask: () => {
      editingTask = null
      showAddDialog = true
    },
    showProjectSwitcher: () => { showProjectSwitcher = true },
    triggerGithubSync: appData.triggerGithubSync,
  })
  const handleRunAction = taskActions.handleRunAction
  let resolvedPluginContributions = $derived(resolveContributions(enabledPluginContributionSources))
  let resolvedViews = $derived(getViews(enabledPluginContributionSources))
  let pluginNavItems = $derived(
    [...resolvedPluginContributions.views]
      .filter((view) => view.showInRail)
      .sort((a, b) => a.railOrder - b.railOrder || a.title.localeCompare(b.title))
      .map((view) => ({
        viewKey: makePluginViewKey(view.pluginId, view.contributionId),
        icon: view.icon,
        title: view.title,
        shortcut: view.shortcut,
      }))
  )
  let activeViewEntry = $derived($currentView === 'board' ? null : resolvedViews[$currentView] ?? null)
  let renderedActiveView = $derived.by(() => {
    if (activeViewEntry === null) {
      return null
    }

    return {
      component: activeViewEntry.component,
      props: activeViewEntry.getProps({
        projectId: $activeProjectId,
        projectName: activeProject?.name ?? '',
        projectPath: activeProject?.path ?? '',
        onCloseSettings: () => { router.navigate('board') },
        onProjectDeleted: appData.loadProjects,
      }),
    }
  })
  let pluginViewActive = $derived(isPluginViewKey($currentView) && activeViewEntry === null)

  $effect(() => {
    const pending = $pendingTask
    if (pending && $tasks.some(t => t.id === pending.id)) {
      pendingTask.set(null)
    }
  })

  $effect(() => {
    const taskId = $selectedTaskId
    if (taskId && !selectedTask) {
      $selectedTaskId = null
    }
  })

  $effect(() => {
    const projectId = $activeProjectId
    if (projectId && projectId !== previousActiveProjectId) {
      const nextFilters = new Map($focusBoardFilters)
      nextFilters.delete(projectId)
      focusBoardFilters.set(nextFilters)
    }
    previousActiveProjectId = projectId
  })

  $effect(() => {
    const projectId = $activeProjectId
    if (projectId && projectId !== previousPluginProjectId) {
      void loadEnabledForProject(projectId)
    } else if (!projectId && previousPluginProjectId !== null) {
      enabledPluginIds.set(new Set())
    }

    previousPluginProjectId = projectId
  })

  $effect(() => {
    if (!shortcuts) return

    const nextShortcutKeys = new Set<string>()

    for (const view of resolvedPluginContributions.views) {
      if (!view.shortcut) continue

      nextShortcutKeys.add(view.shortcut)
      shortcuts.register(view.shortcut, () => {
        handleNavigate(makePluginViewKey(view.pluginId, view.contributionId))
      })
    }

    for (const command of resolvedPluginContributions.commands) {
      if (!command.shortcut) continue

      nextShortcutKeys.add(command.shortcut)
      shortcuts.register(command.shortcut, () => {
        void executePluginCommand(command.pluginId, command.contributionId)
      })
    }

    for (const key of registeredPluginShortcuts) {
      if (!nextShortcutKeys.has(key)) {
        shortcuts.unregister(key)
      }
    }

    registeredPluginShortcuts = nextShortcutKeys
  })

  $effect(() => {
    for (const service of resolvedPluginContributions.backgroundServices) {
      void activatePlugin(service.pluginId)
    }
  })

  // Reload tasks when active project changes
  $effect(() => {
    if ($activeProjectId) {
      appData.loadTasks()
      appData.loadPullRequests()
      appData.refreshPrCounts()
    }
  })

  $effect(() => {
    const pid = $activeProjectId
    $activeProjectColorId = null
    if (pid) {
      getProjectConfig(pid, 'project_color').then((val) => {
        if (get(activeProjectId) === pid && get(activeProjectColorId) === null) {
          $activeProjectColorId = val
        }
      })
    }
  })

  let contentBg = $derived.by(() => {
    const color = getProjectColor($activeProjectColorId)
    return $themeMode === 'dark' ? color.dark : color.light
  })
  let contentBgAlt = $derived.by(() => {
    const color = getProjectColor($activeProjectColorId)
    return $themeMode === 'dark' ? color.darkAlt : color.lightAlt
  })
  let iconRailBg = $derived.by(() => {
    const color = getProjectColor($activeProjectColorId)
    if ($themeMode === 'dark') {
      return color.darkAlt
    }
    return color.lightAlt
  })

  function handleProjectCreated() {
    showProjectSetup = false
    appData.loadProjects()
  }

  function handleNavigate(view: AppView) {
    router.navigate(view)
  }

  function handleOpenTask(taskId: string) {
    router.navigateToTask(taskId)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (shortcuts) {
      shortcuts.handleKeydown(e)
    }
  }

  function handleCloseRequested(event: { preventDefault: () => void }) {
    event.preventDefault()
    showCloseConfirm = true
  }

  async function handleCloseConfirm() {
    if (!appWindow) return

    showCloseConfirm = false

    try {
      await appWindow.destroy()
    } catch (e) {
      showCloseConfirm = true
      console.error('[App] Failed to close window:', e)
    }
  }

  function handleCloseCancel() {
    showCloseConfirm = false
  }

  function cycleActiveProject(direction: 'previous' | 'next', options?: { boardOnly?: boolean }) {
    if (options?.boardOnly && ($currentView !== 'board' || selectedTask !== null)) {
      return
    }

    const projectList = $projects
    if (projectList.length === 0) return

    const currentIndex = projectList.findIndex((p) => p.id === $activeProjectId)
    const nextIndex = direction === 'next'
      ? (currentIndex < 0 ? 0 : (currentIndex + 1) % projectList.length)
      : (currentIndex <= 0 ? projectList.length - 1 : currentIndex - 1)

    $activeProjectId = projectList[nextIndex].id
    router.resetToBoard()
  }

  onMount(async () => {
    appWindow = createDesktopWindow()
    shortcuts = useShortcutRegistry()

    window.addEventListener('keydown', handleKeydown)
    unlisteners.push(() => window.removeEventListener('keydown', handleKeydown))

    registerAppShortcuts(shortcuts, {
      showShortcuts: () => { showShortcutsDialog = true },
      openActionPalette: actionPalette.openActionPalette,
      toggleProjectSwitcher: () => { showProjectSwitcher = !showProjectSwitcher },
      toggleSidebar: () => {
        appSidebarCollapsed = !appSidebarCollapsed
        localStorage.setItem('appSidebarCollapsed', String(appSidebarCollapsed))
      },
      openNewTaskDialog: () => {
        if (!showAddDialog) {
          editingTask = null
          showAddDialog = true
        }
      },
      goBack: () => { router.back() },
      toggleVoiceRecording: () => { window.dispatchEvent(new CustomEvent('toggle-voice-recording')) },
      toggleCommandPalette: () => { showCommandPalette = !showCommandPalette },
      toggleFileQuickOpen: () => { showFileQuickOpen = !showFileQuickOpen },
      canToggleFileQuickOpen: () => selectedTask === null && !showCommandPalette && !showProjectSwitcher && !actionPalette.showActionPalette && !showShortcutsDialog,
      resetToBoard: () => { router.resetToBoard() },
      navigateToSettings: () => { handleNavigate('settings') },
      cycleActiveProject,
    })

    unlisteners.push(...await registerAppDesktopEventListeners({
      appWindow,
      onCloseRequested: handleCloseRequested,
      loadTasks: appData.loadTasks,
      loadSessions: appData.loadSessions,
      loadPullRequests: appData.loadPullRequests,
      loadProjectAttention: appData.loadProjectAttention,
      refreshPrCounts: appData.refreshPrCounts,
    }))

    try {
      await resumeStartupSessions()
    } catch (e) {
      console.error('[App] Failed to resume startup sessions:', e)
    }

    await loadAppStartupData({
      initializePluginRuntime,
      loadProjects: appData.loadProjects,
      getAppMode,
      getConfig,
      setAppMode: (mode) => { appMode = mode },
      setCodeCleanupTasksEnabled: (enabled) => { $codeCleanupTasksEnabled = enabled },
      loadProjectAttention: appData.loadProjectAttention,
      loadTasks: appData.loadTasks,
    })
  })

  onDestroy(() => {
    if (shortcuts) {
      for (const key of registeredPluginShortcuts) {
        shortcuts.unregister(key)
      }
    }

    unlisteners.forEach((fn) => {
      fn()
    })
  })
</script>

<div class="flex h-screen overflow-hidden bg-base-100" style="--project-bg: {contentBg}; --project-bg-alt: {contentBgAlt}">
  <AppSidebar
    collapsed={appSidebarCollapsed}
    currentView={$currentView}
    {appMode}
    onToggleCollapse={() => { appSidebarCollapsed = !appSidebarCollapsed; localStorage.setItem('appSidebarCollapsed', String(appSidebarCollapsed)) }}
    onNewProject={() => showProjectSetup = true}
    onNavigate={handleNavigate}
  />
  {#if !ICON_RAIL_HIDDEN_VIEWS.has($currentView)}
    <IconRail currentView={$currentView} onNavigate={handleNavigate} reviewRequestCount={$reviewRequestCount} authoredPrCount={$authoredPrCount} pluginNavItems={pluginNavItems} modalsOpen={showCommandPalette || showProjectSwitcher || actionPalette.showActionPalette || showAddDialog || showFileQuickOpen} railBg={iconRailBg} />
  {/if}

  <div class="flex flex-col flex-1 min-w-0 relative" style="background: linear-gradient(180deg, var(--project-bg-alt) 0%, var(--project-bg) 100%)">
    <main class="flex-1 overflow-hidden flex">
      <PluginSlot slotType="sidebarPanels" panelSide="left" projectId={$activeProjectId} projectName={activeProject?.name ?? ''} />
      <div class="flex-1 overflow-hidden flex flex-col">
        {#if renderedActiveView !== null}
          <renderedActiveView.component {...(renderedActiveView?.props ?? {})} />
        {:else if pluginViewActive}
          <PluginSlot slotType="views" slotId={$currentView} />
        {:else if selectedTask}
          <TaskDetailView task={selectedTask} onRunAction={handleRunAction} />
        {:else}
          <div class="flex-1 overflow-hidden">
            {#if $isLoading && $tasks.length === 0}
              <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm">
                <span class="loading loading-spinner loading-md text-primary"></span>
                <span>Loading tasks...</span>
              </div>
            {:else}
              <FocusBoard
                projectId={$activeProjectId}
                projectName={activeProject?.name ?? ''}
                tasks={$tasks}
                activeSessions={$activeSessions}
                ticketPrs={$ticketPrs}
                onOpenTask={handleOpenTask}
                onRunAction={handleRunAction}
              />
            {/if}
          </div>
        {/if}

        {#if showAddDialog && $activeProjectId}
          <AddTaskDialog
            mode={editingTask ? 'edit' : 'create'}
            task={editingTask}
            onClose={() => { showAddDialog = false; editingTask = null }}
            onTaskSaved={async () => { await appData.loadTasks() }}
            onRunAction={async (taskId, actionPrompt, agent) => {
              await appData.loadTasks()
              await handleRunAction({ taskId, actionPrompt, agent })
            }}
          />
        {/if}

        {#if showProjectSetup}
          <ProjectSetupDialog onClose={() => showProjectSetup = false} onProjectCreated={handleProjectCreated} />
        {/if}
      </div>
      <PluginSlot slotType="sidebarPanels" panelSide="right" projectId={$activeProjectId} projectName={activeProject?.name ?? ''} />

    </main>

    {#if $activeProjectId && $currentView !== 'global_settings'}
      <button
        type="button"
        class="absolute bottom-6 right-6 btn btn-primary btn-circle btn-lg shadow-lg font-mono text-lg z-10"
        aria-label="Create new task"
        onclick={() => {
          editingTask = null
          showAddDialog = true
        }}
      >
        +
      </button>
    {/if}
  </div>
</div>

<Toast />
<CheckpointToast />
<CiFailureToast />
<TaskSpawnedToast />
<RateLimitToast />

{#if showProjectSwitcher}
  <ProjectSwitcherModal onClose={() => showProjectSwitcher = false} />
{/if}

{#if showCommandPalette}
  <CommandPalette onClose={() => showCommandPalette = false} />
{/if}

{#if actionPalette.showActionPalette}
  <ActionPalette
    task={actionPalette.actionPaletteTask}
    customActions={actionPalette.actionPaletteActions}
    taskPrs={actionPalette.actionPaletteTask ? ($ticketPrs.get(actionPalette.actionPaletteTask.id) || []) : []}
    onClose={actionPalette.closeActionPalette}
    onExecute={actionPalette.executeAction}
  />
{/if}

{#if showFileQuickOpen}
  <FileQuickOpen onClose={() => { showFileQuickOpen = false }} />
{/if}

{#if showCloseConfirm}
  <Modal onClose={handleCloseCancel} maxWidth="360px" initialFocus="[data-close-confirm-action='quit']">
    {#snippet header()}
      <h2 class="text-[0.95rem] font-semibold text-base-content m-0">Quit Open Forge?</h2>
    {/snippet}
    <div class="p-5 flex flex-col gap-4">
      <p class="text-sm text-base-content/70 m-0">Are you sure you want to quit Open Forge?</p>
      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" type="button" onclick={handleCloseCancel}>Cancel</button>
        <button data-close-confirm-action="quit" class="btn btn-error btn-sm" type="button" onclick={handleCloseConfirm}>Quit</button>
      </div>
    </div>
  </Modal>
{/if}

<!-- Keyboard shortcuts help dialog (global) -->
{#if showShortcutsDialog}
  <Modal onClose={() => showShortcutsDialog = false} maxWidth="420px">
    {#snippet header()}
      <h2 class="text-[0.95rem] font-semibold text-base-content m-0">Keyboard Shortcuts</h2>
    {/snippet}
    <div class="p-5 flex flex-col gap-4">
      <!-- Global shortcuts -->
      <div>
        <div class="font-mono text-xs text-secondary mb-3">// global</div>
        <div class="flex flex-col gap-2">
          {#each globalShortcutHelpEntries as shortcut}
            <div class="flex items-center justify-between">
              <span class="text-sm text-base-content">{shortcut.label}</span>
              <div class="flex gap-0.5">
                {#each shortcut.keys as keySequence}
                  {#each keySequence as key}
                    <kbd class="kbd kbd-sm">{key}</kbd>
                  {/each}
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>

      <!-- Vim navigation -->
      <div>
        <div class="font-mono text-xs text-secondary mb-3">// vim navigation</div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Move down / up</span>
            <div class="flex gap-0.5"><kbd class="kbd kbd-sm">j</kbd><kbd class="kbd kbd-sm">k</kbd></div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Left / right column</span>
            <div class="flex gap-0.5"><kbd class="kbd kbd-sm">h</kbd><kbd class="kbd kbd-sm">l</kbd></div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Select / open</span>
            <kbd class="kbd kbd-sm">Enter</kbd>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Action on task</span>
            <kbd class="kbd kbd-sm">x</kbd>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">First / last item</span>
            <div class="flex gap-0.5"><kbd class="kbd kbd-sm">gg</kbd><kbd class="kbd kbd-sm">G</kbd></div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Back</span>
            <div class="flex gap-0.5"><kbd class="kbd kbd-sm">Esc</kbd><kbd class="kbd kbd-sm">q</kbd></div>
          </div>
        </div>
      </div>

      <!-- Task view shortcuts -->
      {#if selectedTask}
        <div>
          <div class="font-mono text-xs text-secondary mb-3">// task view</div>
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="text-sm text-base-content">Info panel</span>
              <kbd class="kbd kbd-sm">⌘I</kbd>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-base-content">Focus agent</span>
              <kbd class="kbd kbd-sm">⌘E</kbd>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-base-content">Code / Review / Terminal</span>
              <div class="flex gap-0.5"><kbd class="kbd kbd-sm">⌘1</kbd><kbd class="kbd kbd-sm">⌘2</kbd><kbd class="kbd kbd-sm">⌘3</kbd></div>
            </div>
             <div class="flex items-center justify-between">
               <span class="text-sm text-base-content">New terminal tab</span>
               <kbd class="kbd kbd-sm">⌘T</kbd>
             </div>
            </div>
          </div>
       {/if}

      <!-- Board-specific shortcuts -->
      {#if $currentView === 'board' && !selectedTask}
        <div>
          <div class="font-mono text-xs text-secondary mb-3">// board</div>
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="text-sm text-base-content">Toggle backlog</span>
              <kbd class="kbd kbd-sm">b</kbd>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-base-content">Toggle done drawer</span>
              <kbd class="kbd kbd-sm">c</kbd>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </Modal>
{/if}
