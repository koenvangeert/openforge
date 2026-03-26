<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn, Event } from '@tauri-apps/api/event'
  import { tasks, selectedTaskId, activeSessions, checkpointNotification, ciFailureNotification, ticketPrs, error, isLoading, projects, activeProjectId, currentView, reviewRequestCount, authoredPrCount, projectAttention, taskSpawned, startingTasks, codeCleanupTasksEnabled, rateLimitNotification, shepherdEnabled, shepherdMessages, shepherdStatus, actionItemCount, taskRuntimeInfo, focusBoardFilters } from './lib/stores'
  import { getProjects, getTasksForProject, getPullRequests, startImplementation, getSessionStatus, getLatestSession, getLatestSessions, forceGithubSync, createTask, updateTask, updateTaskStatus, deleteTask, getProjectAttention, getAppMode, finalizeClaudeSession, getConfig, getProjectConfig, listOpenCodeAgents, getReviewPrs, getAuthoredPrs, notifyShepherdEvent, getShepherdEnabled, getActionItemCount } from './lib/ipc'
  import { writePtyWithSubmit } from './lib/ptySubmit'
  import SearchableSelect from './components/SearchableSelect.svelte'
  import { hasMergeConflicts } from './lib/types'
  import type { Task, PullRequestInfo, AgentEvent, ProjectAttention, AppView, PermissionMode, AgentSession } from './lib/types'
  import KanbanBoard from './components/KanbanBoard.svelte'
  import FocusBoard from './components/FocusBoard.svelte'
  import TaskDetailView from './components/TaskDetailView.svelte'
   import PromptInput from './components/PromptInput.svelte'
  import Modal from './components/Modal.svelte'
   import SettingsView from './components/SettingsView.svelte'
   import PrReviewView from './components/PrReviewView.svelte'
   import WorkQueueView from './components/WorkQueueView.svelte'
   import Toast from './components/Toast.svelte'
  import CheckpointToast from './components/CheckpointToast.svelte'
  import CiFailureToast from './components/CiFailureToast.svelte'
  import TaskSpawnedToast from './components/TaskSpawnedToast.svelte'
  import RateLimitToast from './components/RateLimitToast.svelte'
  import AppSidebar from './components/AppSidebar.svelte'
  import ProjectSwitcherModal from './components/ProjectSwitcherModal.svelte'
  import ProjectSetupDialog from './components/ProjectSetupDialog.svelte'
  import IconRail from './components/IconRail.svelte'
  import CommandPalette from './components/CommandPalette.svelte'
  import ActionPalette from './components/ActionPalette.svelte'
  import ShepherdView from './components/ShepherdView.svelte'

  import { pushNavState, navigateBack, resetToBoard } from './lib/navigation'
  import { loadActions, getEnabledActions } from './lib/actions'
  import { getProjectColor } from './lib/projectColors'
  import { themeMode } from './lib/theme'
  import type { Action } from './lib/types'
  import { release as releaseTerminal, isPtyActive, focusTerminal } from './lib/terminalPool'
  import { isInputFocused } from './lib/domUtils'
  import { useCommandHeld } from './lib/useCommandHeld.svelte'
  import { getOpenCodeSessionUpdate } from './lib/opencodeSessionEvents'
  import SkillsView from './components/SkillsView.svelte'

  let unlisteners: UnlistenFn[] = []
  let showAddDialog = $state(false)
  let isSyncing = $state(false)
  let editingTask = $state<Task | null>(null)
  let dialogAiProvider = $state<string | null>(null)
  let dialogAgents = $state<string[]>([])
  let dialogSelectedAgent = $state('')
  let dialogSelectedPermissionMode = $state<PermissionMode>('default')
  let dialogActions = $state<Action[]>([])

  async function loadDialogAgentInfo() {
    dialogSelectedAgent = ''
    dialogSelectedPermissionMode = 'default'
    try {
      let provider: string | null = null
      if ($activeProjectId) {
        provider = await getProjectConfig($activeProjectId, 'ai_provider')
      }
      dialogAiProvider = provider ?? 'claude-code'
      if ($activeProjectId) {
        const agents = await listOpenCodeAgents($activeProjectId)
        dialogAgents = agents.filter(a => !a.hidden).map(a => a.name)
        const all = await loadActions($activeProjectId)
        dialogActions = getEnabledActions(all)
      } else {
        dialogAgents = []
        dialogActions = []
      }
    } catch {
      dialogAiProvider = null
      dialogAgents = []
      dialogActions = []
    }
  }
  let showProjectSetup = $state(false)
  let appMode = $state<string | null>(null)
  let showShortcutsDialog = $state(false)
  let showProjectSwitcher = $state(false)
  let appSidebarCollapsed = $state(localStorage.getItem('appSidebarCollapsed') === 'true')
  let showCommandPalette = $state(false)
  let showActionPalette = $state(false)
  let actionPaletteActions = $state<Action[]>([])
  let workQueueRefreshTrigger = $state(0)
  let boardLayout = $state<'kanban' | 'focus'>('kanban')

  useCommandHeld()

  let selectedTask = $derived($tasks.find(t => t.id === $selectedTaskId) || null)
  let previousActiveProjectId: string | null = $state(null)

  $effect(() => {
    const projectId = $activeProjectId
    if (projectId && projectId !== previousActiveProjectId) {
      const nextFilters = new Map($focusBoardFilters)
      nextFilters.delete(projectId)
      focusBoardFilters.set(nextFilters)
    }
    previousActiveProjectId = projectId
  })


  // Navigation logic - clear selected task when switching views
  $effect(() => {
    if ($currentView === 'pr_review') {
      $selectedTaskId = null
    }
  })

  $effect(() => {
    if ($currentView === 'settings') {
      $selectedTaskId = null
    }
  })
   $effect(() => {
     if ($currentView === 'workqueue') {
       $selectedTaskId = null
     }
   })
   $effect(() => {
     if ($currentView === 'shepherd') {
       $selectedTaskId = null
     }
   })

   $effect(() => {
     if ($currentView === 'global_settings') {
       $selectedTaskId = null
     }
   })

    // Reload tasks when active project changes
   $effect(() => {
     if ($activeProjectId) {
       $actionItemCount = 0
       loadTasks()
       loadPullRequests()
       refreshPrCounts()
       getShepherdEnabled($activeProjectId).then(enabled => {
         $shepherdEnabled = enabled
       }).catch(e => {
         console.error('[App] Failed to load shepherd enabled state:', e)
         $shepherdEnabled = false
       })
       getActionItemCount($activeProjectId).then(count => {
         $actionItemCount = count
       }).catch(e => {
         console.error('[App] Failed to load action item count:', e)
       })
     }
   })

  // Find active project
  let activeProject = $derived($projects.find(p => p.id === $activeProjectId) || null)

  let activeProjectColorId = $state<string | null>(null)
  $effect(() => {
    const pid = $activeProjectId
    void $currentView
    if (pid) {
      getProjectConfig(pid, 'project_color').then((val) => {
        activeProjectColorId = val
      })
    } else {
      activeProjectColorId = null
    }
  })

  $effect(() => {
    const pid = $activeProjectId
    if (pid) {
      getProjectConfig(pid, 'board_layout').then((val) => {
        boardLayout = (val === 'focus' ? 'focus' : 'kanban')
      })
    } else {
      boardLayout = 'kanban'
    }
  })
  let contentBg = $derived.by(() => {
    const color = getProjectColor(activeProjectColorId)
    return $themeMode === 'dark' ? color.dark : color.light
  })
  let contentBgAlt = $derived.by(() => {
    const color = getProjectColor(activeProjectColorId)
    return $themeMode === 'dark' ? color.darkAlt : color.lightAlt
  })
  let iconRailBg = $derived.by(() => {
    const color = getProjectColor(activeProjectColorId)
    if ($themeMode === 'dark') {
      return color.darkAlt
    }
    return color.lightAlt
  })

  async function loadProjects() {
    try {
      $projects = await getProjects()
      if ($activeProjectId && !$projects.find(p => p.id === $activeProjectId)) {
        $activeProjectId = $projects.length > 0 ? $projects[0].id : null
      } else if ($projects.length > 0 && !$activeProjectId) {
        $activeProjectId = $projects[0].id
      }
      if ($projects.length === 0) {
        showProjectSetup = true
      }
    } catch (e) {
      console.error('Failed to load projects:', e)
      $error = String(e)
    }
  }

  async function loadTasks() {
    if (!$activeProjectId) return
    $isLoading = true
    try {
      $tasks = await getTasksForProject($activeProjectId)
      await loadSessions()
    } catch (e) {
      console.error('Failed to load tasks:', e)
      $error = String(e)
    } finally {
      $isLoading = false
    }
  }

  async function loadSessions() {
    try {
      const taskIds = $tasks.map(t => t.id)
      if (taskIds.length === 0) return
      const sessions = await getLatestSessions(taskIds)
      const updated = new Map($activeSessions)
      for (const session of sessions) {
        updated.set(session.ticket_id, session)
      }
      $activeSessions = updated
    } catch (e) {
      console.error('Failed to load sessions:', e)
    }
  }

  async function getOrLoadActiveSession(taskId: string): Promise<AgentSession | null> {
    const existing = $activeSessions.get(taskId)
    if (existing) return existing

    try {
      const fetched = await getLatestSession(taskId)
      if (!fetched) return null

      const updated = new Map($activeSessions)
      updated.set(taskId, fetched)
      $activeSessions = updated
      return fetched
    } catch {
      return null
    }
  }

  function isSyntheticShepherdTask(taskId: string): boolean {
    return taskId.startsWith('shepherd-')
  }

  async function loadPullRequests() {
    try {
      const prs = await getPullRequests()
      const grouped = new Map<string, PullRequestInfo[]>()
      for (const pr of prs) {
        const existing = grouped.get(pr.ticket_id) || []
        existing.push(pr)
        grouped.set(pr.ticket_id, existing)
      }
      $ticketPrs = grouped
    } catch (e) {
      console.error('Failed to load pull requests:', e)
    }
  }

  async function refreshPrCounts() {
    if (!$activeProjectId) return
    try {
      let excludedRepos = new Set<string>()
      try {
        const val = await getProjectConfig($activeProjectId, 'pr_excluded_repos')
        if (val) {
          const parsed = JSON.parse(val)
          excludedRepos = new Set(Array.isArray(parsed) ? parsed : [])
        }
      } catch {
        // No exclusion config — count all
      }

      const isExcluded = (owner: string, name: string) => excludedRepos.has(`${owner}/${name}`)

      const reviewPrList = await getReviewPrs()
      const filtered = reviewPrList.filter(p => !isExcluded(p.repo_owner, p.repo_name))
      $reviewRequestCount = filtered.filter(p => p.viewed_at === null).length

      const authoredPrList = await getAuthoredPrs()
      const filteredAuthored = authoredPrList.filter(p => !isExcluded(p.repo_owner, p.repo_name))
      $authoredPrCount = filteredAuthored.filter(
        (p) => p.ci_status === 'failure' || p.review_status === 'changes_requested' || hasMergeConflicts(p),
      ).length
    } catch (e) {
      console.error('Failed to refresh PR counts:', e)
    }
  }

  async function loadProjectAttention() {
    try {
      const summaries = await getProjectAttention()
      const map = new Map<string, ProjectAttention>()
      for (const s of summaries) {
        map.set(s.project_id, s)
      }
      $projectAttention = map
    } catch (e) {
      console.error('Failed to load project attention:', e)
    }
  }

  async function triggerGithubSync() {
    if (isSyncing) return
    isSyncing = true
    try {
      await forceGithubSync()
      await loadPullRequests()
      await loadTasks()
    } catch (e) {
      console.error('Failed to sync GitHub:', e)
      $error = String(e)
    } finally {
      isSyncing = false
    }
  }

  async function handleRunAction(data: { taskId: string; actionPrompt: string; agent: string | null }) {
    if (!activeProject) {
      $error = 'No active project selected'
      return
    }
    const { taskId, actionPrompt } = data

    if (isPtyActive(taskId)) {
      try {
        await writePtyWithSubmit(taskId, actionPrompt)
        focusTerminal(taskId)
      } catch (e) {
        console.error('[session] Failed to write action to PTY:', taskId, e)
        $error = String(e)
      }
      return
    }

    $startingTasks = new Set($startingTasks).add(taskId)

    try {
      const result = await startImplementation(taskId, activeProject.path)

      const updatedRuntimeInfo = new Map($taskRuntimeInfo)
      updatedRuntimeInfo.set(taskId, {
        workspacePath: result.workspace_path,
        opencodePort: result.port,
      })
      $taskRuntimeInfo = updatedRuntimeInfo

      try {
        const session = await getSessionStatus(result.session_id)
        const updated = new Map($activeSessions)
        updated.set(taskId, session)
        $activeSessions = updated
      } catch (sessionErr) {
        console.error('[session] Failed to fetch session after start:', sessionErr)
      }

      await loadTasks()
      focusTerminal(taskId)
    } catch (e) {
      console.error('[session] Failed to start task:', taskId, e)
      $error = String(e)
    } finally {
      const next = new Set($startingTasks)
      next.delete(taskId)
      $startingTasks = next
    }
  }

  async function openActionPalette() {
    if (showActionPalette) {
      showActionPalette = false
      return
    }
    if ($activeProjectId) {
      try {
        const all = await loadActions($activeProjectId)
        actionPaletteActions = getEnabledActions(all)
      } catch {
        actionPaletteActions = []
      }
    }
    showActionPalette = true
  }

  async function executeAction(actionId: string) {
    showActionPalette = false
    const task = selectedTask

    switch (actionId) {
      case 'start-task':
        if (task) await handleRunAction({ taskId: task.id, actionPrompt: '', agent: null })
        break
      case 'move-to-done':
        if (task) {
          resetToBoard()
          void updateTaskStatus(task.id, 'done').catch((e) => {
            console.error('Failed to update task status:', e)
            $error = 'Task completion may have succeeded, but background cleanup failed.'
          })
        }
        break
      case 'delete-task':
        if (task) {
          await deleteTask(task.id)
          $selectedTaskId = null
          await loadTasks()
        }
        break
      case 'go-back':
        navigateBack()
        break
      case 'open-workqueue':
        pushNavState()
        $currentView = 'workqueue'
        break
      case 'search-tasks':
        showCommandPalette = true
        break
      case 'new-task':
        editingTask = null
        showAddDialog = true
        loadDialogAgentInfo()
        break
      case 'switch-project':
        showProjectSwitcher = true
        break
      case 'refresh-github':
        triggerGithubSync()
        break
      default:
        if (actionId.startsWith('custom-action-') && task) {
          const realId = actionId.replace('custom-action-', '')
          const action = actionPaletteActions.find(a => a.id === realId)
          if (action) {
            await handleRunAction({ taskId: task.id, actionPrompt: action.prompt, agent: null })
          }
        }
        break
    }
  }

  function handleProjectCreated() {
    showProjectSetup = false
    loadProjects()
  }

  function handleNavigate(view: AppView) {
    if (view === 'board') {
      resetToBoard()
      return
    }

    pushNavState()
    $currentView = view
  }

  function handleOpenTask(taskId: string) {
    pushNavState()
    $selectedTaskId = taskId
  }

  function handleKeydown(e: KeyboardEvent) {
    // ? — show keyboard shortcuts help (global, but not when typing in an input)
    if (e.key === '?' && !isInputFocused()) {
      e.preventDefault()
      showShortcutsDialog = true
      return
    }
    if (e.metaKey && !e.shiftKey && e.key === 'k') {
      e.preventDefault()
      openActionPalette()
      return
    }
    if (e.metaKey && !e.shiftKey && e.key === 'p') {
      e.preventDefault()
      showProjectSwitcher = !showProjectSwitcher
      return
    }
    if (e.metaKey && e.key === 'b') {
      e.preventDefault()
      appSidebarCollapsed = !appSidebarCollapsed
      localStorage.setItem('appSidebarCollapsed', String(appSidebarCollapsed))
      return
    }
    if (e.metaKey && e.key === 't') {
      e.preventDefault()
      if (!showAddDialog) {
        editingTask = null
        showAddDialog = true
        loadDialogAgentInfo()
      }
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === '[' || e.key === 'ArrowLeft')) {
      e.preventDefault()
      navigateBack()
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'R') {
      e.preventDefault()
      triggerGithubSync()
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'd') {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('toggle-voice-recording'))
    }
    if (e.metaKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault()
      showCommandPalette = !showCommandPalette
      return
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'r') {
      e.preventDefault()
      pushNavState()
      $currentView = 'workqueue'
      return
    }
    if (e.metaKey && !e.shiftKey && e.key === 'h') {
      e.preventDefault()
      resetToBoard()
      return
    }
    if (e.metaKey && !e.shiftKey && e.key === 'g') {
      e.preventDefault()
      handleNavigate('pr_review')
      return
    }
    if (e.metaKey && !e.shiftKey && e.key === 'l') {
      e.preventDefault()
      handleNavigate('skills')
      return
    }
    if (e.metaKey && e.key === ',') {
      e.preventDefault()
      handleNavigate('settings')
      return
    }

    // s — navigate to shepherd view (plain key, no modifier)
    if (e.key === 's' && !e.metaKey && !e.ctrlKey && !e.altKey && !isInputFocused() && $shepherdEnabled) {
      e.preventDefault()
      pushNavState()
      $currentView = 'shepherd'
      return
    }

    // 1/2 — cycle through projects (plain keys, no modifier)
    if ((e.key === '1' || e.key === '2') && !e.metaKey && !e.ctrlKey && !e.altKey && !isInputFocused()) {
      const projectList = $projects
      if (projectList.length === 0) return
      e.preventDefault()
      const currentIndex = projectList.findIndex((p) => p.id === $activeProjectId)
      let nextIndex: number
      if (e.key === '2') {
        // Next project
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % projectList.length
      } else {
        // Previous project
        nextIndex = currentIndex <= 0 ? projectList.length - 1 : currentIndex - 1
      }
      $activeProjectId = projectList[nextIndex].id
      resetToBoard()
      return
    }

    if (e.metaKey && e.key === 'a' && $shepherdEnabled) {
      e.preventDefault()
      pushNavState()
      $currentView = 'shepherd'
      return
    }
  }

  onMount(async () => {
    window.addEventListener('keydown', handleKeydown)
    unlisteners.push(() => window.removeEventListener('keydown', handleKeydown))

    // Phase 1: Register ALL event listeners
    unlisteners.push(
      await listen('jira-sync-complete', () => {
        loadTasks()
      })
    )

    unlisteners.push(
      await listen('github-sync-complete', () => {
        loadPullRequests()
        loadProjectAttention()
      })
    )

    unlisteners.push(
      await listen('review-status-changed', (event) => {
        loadPullRequests()
        if ($shepherdEnabled) {
          notifyShepherdEvent('review-status-changed', event.payload).catch(console.error)
        }
      })
    )

    unlisteners.push(
      await listen<{ task_id: string }>('action-complete', async (event: Event<{ task_id: string }>) => {
        const taskId = event.payload.task_id
        const session = await getOrLoadActiveSession(taskId)
        if (session && session.status !== 'completed') {
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'completed', checkpoint_data: null })
          $activeSessions = updated
        }
        if ($checkpointNotification?.ticketId === taskId) {
          $checkpointNotification = null
        }
        loadTasks()
        loadProjectAttention()
        workQueueRefreshTrigger++
        if ($shepherdEnabled && !isSyntheticShepherdTask(taskId)) {
          notifyShepherdEvent('action-complete', event.payload).catch(console.error)
        }
      })
    )

    unlisteners.push(
      await listen<{ task_id: string; error: string }>('implementation-failed', (event: Event<{ task_id: string; error: string }>) => {
        const taskId = event.payload.task_id
        const session = $activeSessions.get(taskId)
        if (session) {
          // Guard: only update if status is not already 'failed'
          if (session.status === 'failed') return
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'failed', error_message: event.payload.error })
          $activeSessions = updated
        }
        if ($checkpointNotification?.ticketId === taskId) {
          $checkpointNotification = null
        }
        loadTasks()
        loadProjectAttention()
      })
    )

    unlisteners.push(
      await listen<{ task_id: string; port: number; workspace_path: string }>('server-resumed', async (event: Event<{ task_id: string; port: number; workspace_path: string }>) => {
        const taskId = event.payload.task_id
        const updatedRuntimeInfo = new Map($taskRuntimeInfo)
        updatedRuntimeInfo.set(taskId, {
          workspacePath: event.payload.workspace_path,
          opencodePort: event.payload.port || null,
        })
        $taskRuntimeInfo = updatedRuntimeInfo

        try {
          const session = await getLatestSession(taskId)
          if (session) {
            const updated = new Map($activeSessions)
            updated.set(taskId, session)
            $activeSessions = updated
          }
        } catch (e) {
          console.error('[startup] Failed to load session after server resume for task:', taskId, e)
        }
      })
    )

    unlisteners.push(
      await listen('startup-resume-complete', () => {
        loadSessions()
      })
    )

    unlisteners.push(
      await listen('new-pr-comment', (event) => {
        loadTasks()
        loadPullRequests()
        loadProjectAttention()
        if ($shepherdEnabled) {
          notifyShepherdEvent('new-pr-comment', event.payload).catch(console.error)
        }
      })
    )

    unlisteners.push(
      await listen('comment-addressed', () => {
        loadPullRequests()
        loadProjectAttention()
      })
    )

    unlisteners.push(
      await listen<{ role: string; content: string; event_context: string | null; created_at: number }>('shepherd-message', (event) => {
        shepherdMessages.update(msgs => [...msgs, {
          id: Date.now(),
          project_id: $activeProjectId ?? '',
          role: event.payload.role as 'shepherd' | 'user' | 'system',
          content: event.payload.content,
          event_context: event.payload.event_context,
          created_at: event.payload.created_at,
        }])
        shepherdStatus.set('idle')
      })
    )

    unlisteners.push(
      await listen<string>('shepherd-status-changed', (event: Event<string>) => {
        const status = event.payload
        if (status === 'idle' || status === 'thinking' || status === 'disabled' || status === 'error') {
          shepherdStatus.set(status)
        }
      })
    )

    unlisteners.push(
      await listen('action-item-created', async () => {
        if ($shepherdEnabled && $activeProjectId) {
          $actionItemCount = await getActionItemCount($activeProjectId)
        }
      })
    )

    unlisteners.push(
      await listen('action-item-dismissed', async () => {
        if ($shepherdEnabled && $activeProjectId) {
          $actionItemCount = await getActionItemCount($activeProjectId)
        }
      })
    )

    unlisteners.push(
      await listen<{ task_id: string, pr_id: number, pr_title: string, ci_status: string, timestamp: number }>('ci-status-changed', (event) => {
        if (event.payload.ci_status === 'failure') {
          const session = $activeSessions.get(event.payload.task_id)
          if (!session || session.status !== 'running') {
            $ciFailureNotification = {
              task_id: event.payload.task_id,
              pr_id: event.payload.pr_id,
              pr_title: event.payload.pr_title,
              ci_status: event.payload.ci_status,
              timestamp: event.payload.timestamp,
            }
          }
        }
        loadPullRequests()
        loadProjectAttention()
        if ($shepherdEnabled) {
          notifyShepherdEvent('ci-status-changed', event.payload).catch(console.error)
        }
      })
    )

    unlisteners.push(
      await listen<AgentEvent>('agent-event', async (event: Event<AgentEvent>) => {
        const { task_id: taskId, event_type: eventType } = event.payload
        const session = await getOrLoadActiveSession(taskId)
        if (!session) return

        const sessionUpdate = getOpenCodeSessionUpdate(eventType, event.payload.data)
        if (!sessionUpdate) {
          loadProjectAttention()
          return
        }

        if (sessionUpdate.status === 'paused') {
          if (session.status === 'paused' && session.checkpoint_data === sessionUpdate.checkpoint_data) return

          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, ...sessionUpdate })
          $activeSessions = updated

          const task = $tasks.find(t => t.id === taskId)
          $checkpointNotification = {
            ticketId: taskId,
            ticketKey: task?.jira_key ?? null,
            sessionId: session.id,
            stage: session.stage,
            message: 'Agent needs input',
            timestamp: Date.now(),
          }
          if ($shepherdEnabled) {
            notifyShepherdEvent('agent-checkpoint', { task_id: taskId }).catch(console.error)
          }
        } else {
          if (
            session.status === sessionUpdate.status &&
            session.checkpoint_data === sessionUpdate.checkpoint_data &&
            session.error_message === sessionUpdate.error_message
          ) {
            loadProjectAttention()
            return
          }

          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, ...sessionUpdate })
          $activeSessions = updated

          if ($checkpointNotification?.ticketId === taskId) {
            $checkpointNotification = null
          }
        }

        loadProjectAttention()
      })
    )

    unlisteners.push(
      await listen<{ ticket_id: string; session_id: string }>('session-aborted', (event: Event<{ ticket_id: string; session_id: string }>) => {
        const updated = new Map($activeSessions)
        updated.delete(event.payload.ticket_id)
        $activeSessions = updated
        releaseTerminal(event.payload.ticket_id)
        if ($checkpointNotification?.ticketId === event.payload.ticket_id) {
          $checkpointNotification = null
        }
        loadProjectAttention()
      })
    )

    // Claude Code hooks → frontend status updates
    unlisteners.push(
      await listen<{ task_id: string; status: string }>('agent-status-changed', async (event: Event<{ task_id: string; status: string }>) => {
        const { task_id: taskId, status } = event.payload
        let session = $activeSessions.get(taskId)
        if (!session) {
          // Session not in store yet (e.g. resumed at startup before frontend loaded sessions)
          try {
            const fetched = await getLatestSession(taskId)
            if (fetched) {
              session = fetched
              const updated = new Map($activeSessions)
              updated.set(taskId, fetched)
              $activeSessions = updated
            } else {
              return
            }
          } catch {
            return
          }
        }

        if (status === 'completed') {
          if (session.status === 'completed') return
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'completed' })
          $activeSessions = updated
          if ($checkpointNotification?.ticketId === taskId) {
            $checkpointNotification = null
          }
          loadTasks()
        } else if (status === 'running') {
          if (session.status === 'running') return
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'running', checkpoint_data: null })
          $activeSessions = updated
          if ($checkpointNotification?.ticketId === taskId) {
            $checkpointNotification = null
          }
          if ($shepherdEnabled) {
            notifyShepherdEvent('agent-started', { task_id: taskId }).catch(console.error)
          }
        } else if (status === 'paused') {
          if (session.status === 'paused') return
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'paused' })
          $activeSessions = updated
          const task = $tasks.find(t => t.id === taskId)
          $checkpointNotification = {
            ticketId: taskId,
            ticketKey: task?.jira_key ?? null,
            sessionId: session.id,
            stage: session.stage,
            message: 'Agent needs permission',
            timestamp: Date.now(),
          }
          if ($shepherdEnabled) {
            notifyShepherdEvent('agent-checkpoint', { task_id: taskId }).catch(console.error)
          }
        } else if (status === 'interrupted') {
          if (session.status === 'interrupted') return
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'interrupted' })
          $activeSessions = updated
          if ($checkpointNotification?.ticketId === taskId) {
            $checkpointNotification = null
          }
          loadTasks()
          if ($shepherdEnabled) {
            notifyShepherdEvent('agent-errored', { task_id: taskId }).catch(console.error)
          }
        }
        loadProjectAttention()
      })
    )

    // Claude PTY exit fallback — if hooks didn't fire, mark session interrupted
    unlisteners.push(
      await listen<{ task_id: string }>('claude-pty-exited', (event: Event<{ task_id: string }>) => {
        const taskId = event.payload.task_id
        setTimeout(async () => {
          const session = $activeSessions.get(taskId)
          if (session && session.status === 'running') {
            try {
              await finalizeClaudeSession(taskId)
            } catch (e) {
              console.error('[pty-exit] Failed to finalize session for task:', taskId, e)
            }
          }
        }, 1500)
      })
    )

    unlisteners.push(
      await listen<number>('review-pr-count-changed', () => {
        refreshPrCounts()
      })
    )

    unlisteners.push(
      await listen('authored-prs-updated', () => {
        refreshPrCounts()
      })
    )

    unlisteners.push(
      await listen<{ reset_at: number | null }>('github-rate-limited', (event) => {
        $rateLimitNotification = {
          reset_at: event.payload.reset_at,
          timestamp: Date.now(),
        }
      })
    )

    unlisteners.push(
      await listen<{ action: string; task_id: string }>('task-changed', (event) => {
        if (event.payload.action === 'deleted') {
          const taskId = event.payload.task_id
          if ($selectedTaskId === taskId) {
            $selectedTaskId = null
          }
          const updated = new Map($activeSessions)
          updated.delete(taskId)
          $activeSessions = updated
          releaseTerminal(taskId)
          if ($checkpointNotification?.ticketId === taskId) {
            $checkpointNotification = null
          }
        } else if (event.payload.action === 'created') {
          // Trigger toast for newly created task (spawned by agent)
          $taskSpawned = { taskId: event.payload.task_id, initial_prompt: event.payload.task_id }
        }
        loadTasks()
        if ($shepherdEnabled) {
          if (event.payload.action === 'created') {
            notifyShepherdEvent('task-created', event.payload).catch(console.error)
          } else if (event.payload.action === 'updated') {
            notifyShepherdEvent('task-moved', event.payload).catch(console.error)
          } else if (event.payload.action === 'deleted') {
            notifyShepherdEvent('task-deleted', event.payload).catch(console.error)
          }
        }
      })
    )

    // Phase 2: Load data
    await loadProjects()

    try {
      appMode = await getAppMode()
    } catch (e) {
      console.error('[App] Failed to get app mode:', e)
      // Graceful degradation: no badge shown if call fails
    }

    try {
      const codeCleanupVal = await getConfig('code_cleanup_tasks_enabled')
      $codeCleanupTasksEnabled = codeCleanupVal === 'true'
    } catch (e) {
      console.error('[App] Failed to load code_cleanup_tasks_enabled config:', e)
    }
    loadProjectAttention()

    // PR counts are initialized by the $effect that calls refreshPrCounts()
    // when $activeProjectId is set — no separate unfiltered init needed.

    // Phase 3: Safety net
    await loadTasks()

  })

  onDestroy(() => {
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
  {#if $currentView !== 'workqueue' && $currentView !== 'global_settings'}
    <IconRail currentView={$currentView} onNavigate={handleNavigate} reviewRequestCount={$reviewRequestCount} authoredPrCount={$authoredPrCount} shepherdEnabled={$shepherdEnabled} actionItemCount={$actionItemCount} modalsOpen={showCommandPalette || showProjectSwitcher || showActionPalette || showAddDialog} railBg={iconRailBg} />
  {/if}

  <div class="flex flex-col flex-1 min-w-0 relative" style="background: linear-gradient(180deg, var(--project-bg-alt) 0%, var(--project-bg) 100%)">
    <main class="flex-1 overflow-hidden flex flex-col">
      {#if $currentView === 'settings'}
        <SettingsView mode="project" onClose={() => { pushNavState(); $currentView = 'board' }} onProjectDeleted={loadProjects} />
      {:else if $currentView === 'global_settings'}
        <SettingsView mode="global" onClose={() => { pushNavState(); $currentView = 'board' }} onProjectDeleted={loadProjects} />
      {:else if $currentView === 'pr_review'}
        <PrReviewView projectName={activeProject?.name ?? ''} />
       {:else if $currentView === 'skills'}
         <SkillsView projectName={activeProject?.name ?? ''} />
       {:else if $currentView === 'workqueue'}
         <WorkQueueView onRunAction={handleRunAction} />
       {:else if $currentView === 'shepherd'}
         <ShepherdView />
       {:else if selectedTask}
        <TaskDetailView task={selectedTask} onRunAction={handleRunAction} />
       {:else}
         <div class="flex-1 overflow-hidden">
           {#if $isLoading && $tasks.length === 0}
             <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm">
               <span class="loading loading-spinner loading-md text-primary"></span>
               <span>Loading tasks...</span>
             </div>
           {:else if boardLayout === 'focus'}
               <FocusBoard
                 projectId={$activeProjectId}
                 projectName={activeProject?.name ?? ''}
                 tasks={$tasks}
                 activeSessions={$activeSessions}
                ticketPrs={$ticketPrs}
                onOpenTask={handleOpenTask}
                onRunAction={handleRunAction}
              />
           {:else}
             <KanbanBoard onRunAction={handleRunAction} projectName={activeProject?.name ?? ''} />
           {/if}
         </div>
       {/if}

      {#if showAddDialog && $activeProjectId}
        <Modal onClose={() => { showAddDialog = false; editingTask = null }} maxWidth="640px" overflowVisible>
          {#snippet header()}
            <h2 class="text-[0.95rem] font-semibold text-base-content m-0">{editingTask ? 'Edit Task' : 'Create Task'}</h2>
          {/snippet}
          <div class="p-4 overflow-visible">
            <PromptInput
              projectId={$activeProjectId}
              value={editingTask ? editingTask.initial_prompt : ''}
              jiraKey={editingTask ? (editingTask.jira_key || '') : ''}
              autofocus={true}
              actions={editingTask ? [] : dialogActions}
              onSubmit={async (prompt, jiraKey) => {
                try {
                  if (editingTask) {
                    await updateTask(editingTask.id, prompt, jiraKey)
                  } else {
                    await createTask(prompt, 'backlog', jiraKey, $activeProjectId, dialogSelectedAgent || null, dialogSelectedPermissionMode)
                  }
                  showAddDialog = false
                  editingTask = null
                  await loadTasks()
                } catch (e) {
                  console.error('Failed to save task:', e)
                  $error = String(e)
                }
              }}
              onStartTask={editingTask ? undefined : async (prompt, jiraKey) => {
                try {
                  const agent = dialogSelectedAgent || null
                  const newTask = await createTask(prompt, 'backlog', jiraKey, $activeProjectId, agent, dialogSelectedPermissionMode)
                  showAddDialog = false
                  editingTask = null
                  await loadTasks()
                  await handleRunAction({ taskId: newTask.id, actionPrompt: '', agent })
                } catch (e) {
                  console.error('Failed to start task:', e)
                  $error = String(e)
                }
              }}
              onRunAction={editingTask ? undefined : async (prompt, jiraKey, actionPrompt) => {
                try {
                  const agent = dialogSelectedAgent || null
                  const newTask = await createTask(prompt, 'backlog', jiraKey, $activeProjectId, agent, dialogSelectedPermissionMode)
                  showAddDialog = false
                  editingTask = null
                  await loadTasks()
                  await handleRunAction({ taskId: newTask.id, actionPrompt, agent })
                } catch (e) {
                  console.error('Failed to run custom action:', e)
                  $error = String(e)
                }
              }}
              onCancel={() => { showAddDialog = false; editingTask = null }}
            >
              {#snippet extras()}
                {#if !editingTask && dialogAiProvider === 'claude-code'}
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-base-content/50 font-medium shrink-0">Mode</span>
                    <select
                      class="select select-bordered select-xs flex-1"
                      bind:value={dialogSelectedPermissionMode}
                    >
                      <option value="default">Default</option>
                      <option value="acceptEdits">Accept Edits</option>
                      <option value="plan">Plan</option>
                      <option value="bypassPermissions">Bypass Permissions</option>
                      <option value="dontAsk">Don't Ask (dangerous)</option>
                    </select>
                  </div>
                {/if}
                {#if !editingTask && dialogAgents.length > 0}
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-base-content/50 font-medium shrink-0">Agent</span>
                    <div class="flex-1">
                      <SearchableSelect
                        options={[{ value: '', label: 'Default' }, ...dialogAgents.map(a => ({ value: a, label: a }))]}
                        value={dialogSelectedAgent}
                        placeholder="Search agents..."
                        size="xs"
                        onSelect={(v) => { dialogSelectedAgent = v }}
                      />
                    </div>
                  </div>
                {/if}
              {/snippet}
            </PromptInput>
          </div>
        </Modal>
      {/if}

      {#if showProjectSetup}
        <ProjectSetupDialog onClose={() => showProjectSetup = false} onProjectCreated={handleProjectCreated} />
      {/if}
    </main>

    {#if $activeProjectId && $currentView !== 'global_settings'}
      <button
        type="button"
        class="absolute bottom-6 right-6 btn btn-primary btn-circle btn-lg shadow-lg font-mono text-lg z-10"
        aria-label="Create new task"
        onclick={() => {
          editingTask = null
          showAddDialog = true
          loadDialogAgentInfo()
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

{#if showActionPalette}
  <ActionPalette
    task={selectedTask}
    customActions={actionPaletteActions}
    onClose={() => showActionPalette = false}
    onExecute={executeAction}
  />
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
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Switch project</span>
            <kbd class="kbd kbd-sm">⌘P</kbd>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">New task</span>
            <kbd class="kbd kbd-sm">⌘T</kbd>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Go back</span>
            <kbd class="kbd kbd-sm">⌘[</kbd>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Refresh GitHub</span>
            <div class="flex gap-0.5"><kbd class="kbd kbd-sm">⌘</kbd><kbd class="kbd kbd-sm">⇧</kbd><kbd class="kbd kbd-sm">R</kbd></div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Voice input</span>
            <kbd class="kbd kbd-sm">⌘D</kbd>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Search tasks</span>
            <div class="flex gap-0.5"><kbd class="kbd kbd-sm">⌘</kbd><kbd class="kbd kbd-sm">⇧</kbd><kbd class="kbd kbd-sm">F</kbd></div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Action palette</span>
            <kbd class="kbd kbd-sm">⌘K</kbd>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Show shortcuts</span>
            <kbd class="kbd kbd-sm">?</kbd>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Work queue</span>
            <kbd class="kbd kbd-sm">⌘R</kbd>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Task Shepherd</span>
            <div class="flex gap-0.5"><kbd class="kbd kbd-sm">s</kbd><kbd class="kbd kbd-sm">⌘A</kbd></div>
          </div>
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
              <span class="text-sm text-base-content">Terminal panel</span>
              <kbd class="kbd kbd-sm">⌘J</kbd>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-base-content">Focus agent</span>
              <kbd class="kbd kbd-sm">⌘E</kbd>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-base-content">Code / Review view</span>
              <div class="flex gap-0.5"><kbd class="kbd kbd-sm">⌘1</kbd><kbd class="kbd kbd-sm">⌘2</kbd></div>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-base-content">Fullscreen terminal</span>
              <kbd class="kbd kbd-sm">⌘F</kbd>
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
