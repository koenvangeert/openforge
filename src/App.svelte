<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn, Event } from '@tauri-apps/api/event'
  import { tasks, selectedTaskId, activeSessions, checkpointNotification, ciFailureNotification, ticketPrs, error, isLoading, projects, activeProjectId, currentView, reviewRequestCount, projectAttention, taskSpawned, selectedSkillName, runningTerminals, startingTasks, creaturesEnabled } from './lib/stores'
  import { getProjects, getTasksForProject, getPullRequests, runAction, getSessionStatus, getLatestSession, getLatestSessions, forceGithubSync, createTask, updateTask, updateTaskStatus, deleteTask, getProjectAttention, getAppMode, finalizeClaudeSession, getRunningPtyTaskIds, getConfig, getAgents, writePty, getReviewPrs } from './lib/ipc'
  import SearchableSelect from './components/SearchableSelect.svelte'
  import type { Task, PullRequestInfo, AgentEvent, ProjectAttention, AppView } from './lib/types'
  import KanbanBoard from './components/KanbanBoard.svelte'
  import TaskDetailView from './components/TaskDetailView.svelte'
   import PromptInput from './components/PromptInput.svelte'
  import Modal from './components/Modal.svelte'
   import SettingsView from './components/SettingsView.svelte'
   import PrReviewView from './components/PrReviewView.svelte'
   import SkillsView from './components/SkillsView.svelte'
   import CreaturesView from './components/CreaturesView.svelte'
   import WorkQueueView from './components/WorkQueueView.svelte'
   import Toast from './components/Toast.svelte'
  import CheckpointToast from './components/CheckpointToast.svelte'
  import CiFailureToast from './components/CiFailureToast.svelte'
  import TaskSpawnedToast from './components/TaskSpawnedToast.svelte'
  import ProjectSwitcher from './components/ProjectSwitcher.svelte'
  import ProjectSwitcherModal from './components/ProjectSwitcherModal.svelte'
  import ProjectSetupDialog from './components/ProjectSetupDialog.svelte'
  import IconRail from './components/IconRail.svelte'
  import CommandPalette from './components/CommandPalette.svelte'
  import ActionPalette from './components/ActionPalette.svelte'

  import { pushNavState, navigateBack } from './lib/navigation'
  import { loadActions, getEnabledActions } from './lib/actions'
  import type { Action } from './lib/types'
  import { release as releaseTerminal, isPtyActive, focusTerminal } from './lib/terminalPool'
  import { isInputFocused } from './lib/domUtils'
  import { resolveGotoKey } from './lib/vimGoto'

  let unlisteners: UnlistenFn[] = []
  let showAddDialog = $state(false)
  let isSyncing = $state(false)
  let editingTask = $state<Task | null>(null)
  let dialogAiProvider = $state<string | null>(null)
  let dialogAgents = $state<string[]>([])
  let dialogSelectedAgent = $state('')

  async function loadDialogAgentInfo() {
    dialogSelectedAgent = ''
    try {
      const provider = await getConfig('ai_provider')
      dialogAiProvider = provider ?? 'claude-code'
      if (dialogAiProvider !== 'claude-code') {
        const agents = await getAgents()
        dialogAgents = agents.map(a => a.name)
      } else {
        dialogAgents = []
      }
    } catch {
      dialogAiProvider = null
      dialogAgents = []
    }
  }
  let showProjectSetup = $state(false)
  let appMode = $state<string | null>(null)
  let showShortcutsDialog = $state(false)
  let showProjectSwitcher = $state(false)
  let showCommandPalette = $state(false)
  let showActionPalette = $state(false)
  let actionPaletteActions = $state<Action[]>([])
  let workQueueRefreshTrigger = $state(0)
  let pendingGoto = $state(false)
  let gotoTimer: ReturnType<typeof setTimeout> | null = null

  function clearPendingGoto() {
    pendingGoto = false
    if (gotoTimer) {
      clearTimeout(gotoTimer)
      gotoTimer = null
    }
  }

  function isAnyModalOpen(): boolean {
    return showAddDialog || showShortcutsDialog || showProjectSwitcher || showCommandPalette || showActionPalette || showProjectSetup
  }

  let selectedTask = $derived($tasks.find(t => t.id === $selectedTaskId) || null)


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
     if ($currentView === 'skills') {
       $selectedTaskId = null
     }
   })
   
   $effect(() => {
     if ($currentView === 'creatures') {
       if (!$creaturesEnabled) {
         $currentView = 'board'
         return
       }
       $selectedTaskId = null
     }
   })
   $effect(() => {
     if ($currentView === 'workqueue') {
       $selectedTaskId = null
     }
   })

   // Reload tasks when active project changes
  $effect(() => {
    if ($activeProjectId) {
      loadTasks()
      loadPullRequests()
    }
  })

  // Find active project
  let activeProject = $derived($projects.find(p => p.id === $activeProjectId) || null)

  async function loadProjects() {
    try {
      $projects = await getProjects()
      if ($projects.length > 0 && !$activeProjectId) {
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
      loadRunningTerminals()
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

  async function loadRunningTerminals() {
    try {
      const ids = await getRunningPtyTaskIds()
      const shellTaskIds = new Set<string>()
      for (const id of ids) {
        if (id.endsWith('-shell')) {
          shellTaskIds.add(id.slice(0, -6))
        }
      }
      $runningTerminals = shellTaskIds
    } catch (e) {
      console.error('Failed to load running terminals:', e)
    }
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
    const { taskId, actionPrompt, agent } = data

    // If Claude PTY is active, send the prompt directly to the terminal
    // instead of starting a new session (like dictation does)
    if (isPtyActive(taskId)) {
      try {
        await writePty(taskId, actionPrompt + '\r')
        focusTerminal(taskId)
      } catch (e) {
        console.error('[session] Failed to write action to PTY:', taskId, e)
        $error = String(e)
      }
      return
    }

    // Mark task as starting (worktree creation + agent spawn in progress)
    $startingTasks = new Set($startingTasks).add(taskId)


    try {
      const result = await runAction(taskId, activeProject.path, actionPrompt, agent)

      try {
        const session = await getSessionStatus(result.session_id)
        const updated = new Map($activeSessions)
        updated.set(taskId, session)
        $activeSessions = updated
      } catch (sessionErr) {
        console.error('[session] Failed to fetch session after action:', sessionErr)
      }

      await loadTasks()
      focusTerminal(taskId)
    } catch (e) {
      console.error('[session] Failed to run action for task:', taskId, e)
      $error = String(e)
    } finally {
      // Clear the starting state
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
          await updateTaskStatus(task.id, 'done')
          await loadTasks()
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
          const customId = actionId.replace('custom-action-', '')
          const action = actionPaletteActions.find(a => a.id === customId)
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
    pushNavState()
    $currentView = view
  }

  function handleKeydown(e: KeyboardEvent) {
    // ? — show keyboard shortcuts help (global)
    if (e.key === '?') {
      e.preventDefault()
      showShortcutsDialog = true
      return
    }
    if (e.metaKey && e.shiftKey && e.key === 'p') {
      e.preventDefault()
      openActionPalette()
      return
    }
    if (e.metaKey && !e.shiftKey && e.key === 'p') {
      e.preventDefault()
      showProjectSwitcher = !showProjectSwitcher
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
    if (e.metaKey && e.key === 'k') {
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

    // Vim-style g-prefix view navigation (only when no input focused and no modals)
    if (!isInputFocused() && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (pendingGoto) {
        clearPendingGoto()
        // Don't resolve 'g' here — gg is handled by board's useVimNavigation
        if (e.key !== 'g') {
          const target = resolveGotoKey(e.key)
          if (target) {
            e.preventDefault()
            handleNavigate(target)
            return
          }
        }
        return
      }

      if (e.key === 'g' && !isAnyModalOpen()) {
        e.preventDefault()
        pendingGoto = true
        gotoTimer = setTimeout(clearPendingGoto, 500)
        return
      }
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
      await listen('ci-status-changed', () => {
        loadPullRequests()
      })
    )

    unlisteners.push(
      await listen('review-status-changed', () => {
        loadPullRequests()
      })
    )

    unlisteners.push(
      await listen<{ task_id: string }>('action-complete', (event: Event<{ task_id: string }>) => {
        const taskId = event.payload.task_id
        const session = $activeSessions.get(taskId)
        if (session) {
          // Guard: only update if status is not already 'completed'
          if (session.status === 'completed') return
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'completed' })
          $activeSessions = updated
        }
        if ($checkpointNotification?.ticketId === taskId) {
          $checkpointNotification = null
        }
        loadTasks()
        loadProjectAttention()
        workQueueRefreshTrigger++
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
      await listen<{ task_id: string; port: number }>('server-resumed', async (event: Event<{ task_id: string; port: number }>) => {
        const taskId = event.payload.task_id
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
      await listen('new-pr-comment', () => {
        loadTasks()
        loadPullRequests()
        loadProjectAttention()
      })
    )

    unlisteners.push(
      await listen('comment-addressed', () => {
        loadPullRequests()
        loadProjectAttention()
      })
    )

    unlisteners.push(
      await listen<{ task_id: string, pr_id: number, pr_title: string, ci_status: string, timestamp: number }>('ci-status-changed', (event) => {
        if (event.payload.ci_status === 'failure') {
          // Suppress CI failure toast when the task's agent is still running —
          // the agent may push more code that fixes CI.
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
        // Always refresh PR data to update CI dots on cards
        loadPullRequests()
        loadProjectAttention()
      })
    )

    unlisteners.push(
      await listen<AgentEvent>('agent-event', (event: Event<AgentEvent>) => {
        const { task_id: taskId, event_type: eventType } = event.payload
        const session = $activeSessions.get(taskId)
        if (!session) return

        if (eventType === 'session.idle' || eventType === 'session.status') {
          try {
            const parsed = JSON.parse(event.payload.data)
            const statusType = parsed.properties?.status?.type
            if (eventType === 'session.idle' || statusType === 'idle') {
              // Guard: only update if status is not already 'completed'
              if (session.status === 'completed') return
              const updated = new Map($activeSessions)
              updated.set(taskId, { ...session, status: 'completed' })
              $activeSessions = updated
              // Clear stale checkpoint notification for this task
              if ($checkpointNotification?.ticketId === taskId) {
                $checkpointNotification = null
              }
            } else if (statusType === 'busy') {
              // Guard: only update if status is not already 'running'
              if (session.status === 'running') return
              console.log('[session] SSE session busy for task:', taskId)
              const updated = new Map($activeSessions)
              updated.set(taskId, { ...session, status: 'running', checkpoint_data: null })
              $activeSessions = updated
              if ($checkpointNotification?.ticketId === taskId) {
                $checkpointNotification = null
              }
            } else if (statusType === 'retry') {
              // Guard: only update if status is not already 'running'
              if (session.status === 'running') return
              console.log('[session] SSE session retry for task:', taskId)
              const updated = new Map($activeSessions)
              updated.set(taskId, { ...session, status: 'running', checkpoint_data: null })
              $activeSessions = updated
              if ($checkpointNotification?.ticketId === taskId) {
                $checkpointNotification = null
              }
            }
          } catch {
            if (eventType === 'session.idle') {
              // Guard: only update if status is not already 'completed'
              if (session.status === 'completed') return
              const updated = new Map($activeSessions)
              updated.set(taskId, { ...session, status: 'completed' })
              $activeSessions = updated
              if ($checkpointNotification?.ticketId === taskId) {
                $checkpointNotification = null
              }
            }
          }
        } else if (eventType === 'session.error') {
          // Guard: only update if status is not already 'failed'
          if (session.status === 'failed') return
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'failed', error_message: event.payload.data })
          $activeSessions = updated
          // Clear stale checkpoint notification for this task
          if ($checkpointNotification?.ticketId === taskId) {
            $checkpointNotification = null
          }
        } else if (eventType === 'permission.updated' || eventType === 'question.asked') {
          // Guard: only update if status is not already 'paused'
          if (session.status === 'paused') return
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'paused', checkpoint_data: event.payload.data })
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
        } else if (eventType === 'permission.replied' || eventType === 'question.answered') {
          // Guard: only update if status is not already 'running'
          if (session.status === 'running') return
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'running', checkpoint_data: null })
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
        } else if (status === 'interrupted') {
          if (session.status === 'interrupted') return
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'interrupted' })
          $activeSessions = updated
          if ($checkpointNotification?.ticketId === taskId) {
            $checkpointNotification = null
          }
          loadTasks()
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
      await listen<number>('review-pr-count-changed', (event: Event<number>) => {
        $reviewRequestCount = event.payload
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
          $taskSpawned = { taskId: event.payload.task_id, title: event.payload.task_id }
        }
        loadTasks()
        workQueueRefreshTrigger++
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
      const creaturesVal = await getConfig('creatures_enabled')
      $creaturesEnabled = creaturesVal === 'true'
    } catch (e) {
      console.error('[App] Failed to load creatures_enabled config:', e)
    }
    loadProjectAttention()

    try {
      const reviewPrList = await getReviewPrs()
      $reviewRequestCount = reviewPrList.filter(p => p.viewed_at === null).length
    } catch (e) {
      console.error('[App] Failed to initialize review PR count:', e)
    }

    // Phase 3: Safety net
    await loadTasks()

    // Poll running terminals (PTY sessions start/stop outside task lifecycle)
    const terminalPollInterval = setInterval(loadRunningTerminals, 5000)
    unlisteners.push(() => clearInterval(terminalPollInterval))
  })

  onDestroy(() => {
    unlisteners.forEach(fn => fn())
  })
</script>

<div class="flex h-screen overflow-hidden bg-base-200">
  <IconRail currentView={$currentView} onNavigate={handleNavigate} reviewRequestCount={$reviewRequestCount} creaturesEnabled={$creaturesEnabled} />

  <div class="flex flex-col flex-1 min-w-0">
    <header class="bg-neutral text-neutral-content h-12 flex items-center justify-between px-6 shrink-0">
      <div class="flex items-center gap-4">
        <span class="flex items-center gap-1.5 font-mono text-sm">
          <span class="text-primary font-bold">&gt;</span>
          <span class="font-semibold">open_forge</span>
        </span>
        {#if appMode === 'dev'}
          <span class="badge badge-sm bg-primary text-black font-mono">DEV</span>
        {/if}
        <ProjectSwitcher onNewProject={() => showProjectSetup = true} />
        <button
          type="button"
          class="btn btn-sm bg-primary text-black hover:bg-primary/80 font-mono"
          onclick={() => {
            editingTask = null
            showAddDialog = true
            loadDialogAgentInfo()
          }}
        >
          + new_task <span class="text-[0.65rem] opacity-70 ml-1 font-normal">&#8984;T</span>
        </button>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-ghost btn-sm text-neutral-content/60 hover:text-neutral-content font-mono text-xs gap-1"
          onclick={() => showCommandPalette = true}
        >
          search <kbd class="kbd kbd-xs bg-neutral-content/10 text-neutral-content/50 border-neutral-content/20">&#8984;K</kbd>
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm text-neutral-content/60 hover:text-neutral-content font-mono text-xs gap-1"
          onclick={() => showProjectSwitcher = true}
        >
          {#if activeProject}
            <span class="text-neutral-content/80">{activeProject.name}</span>
          {:else}
            projects
          {/if}
          <kbd class="kbd kbd-xs bg-neutral-content/10 text-neutral-content/50 border-neutral-content/20">&#8984;P</kbd>
        </button>
      </div>
    </header>

    <main class="flex-1 overflow-hidden flex">
      {#if $currentView === 'settings'}
        <SettingsView onClose={() => { pushNavState(); $currentView = 'board' }} onProjectDeleted={loadProjects} />
      {:else if $currentView === 'pr_review'}
        <PrReviewView />
       {:else if $currentView === 'skills'}
         <SkillsView onRunAction={handleRunAction} />
       {:else if $currentView === 'creatures'}
         <CreaturesView
           onCreatureClick={(taskId) => {
             pushNavState()
             $currentView = 'board'
             $selectedTaskId = taskId
           }}
           onRunAction={handleRunAction}
         />
       {:else if $currentView === 'workqueue'}
         <WorkQueueView refreshTrigger={workQueueRefreshTrigger} />
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
            <KanbanBoard onRunAction={handleRunAction} />
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
              value={editingTask ? editingTask.title : ''}
              jiraKey={editingTask ? (editingTask.jira_key || '') : ''}
              autofocus={true}
              onSubmit={async (prompt, jiraKey) => {
                try {
                  if (editingTask) {
                    await updateTask(editingTask.id, prompt, jiraKey)
                  } else {
                    await createTask(prompt, 'backlog', jiraKey, $activeProjectId, dialogSelectedAgent || null, null)
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
                  const newTask = await createTask(prompt, 'backlog', jiraKey, $activeProjectId, agent, null)
                  showAddDialog = false
                  editingTask = null
                  await loadTasks()
                  await handleRunAction({ taskId: newTask.id, actionPrompt: '', agent })
                } catch (e) {
                  console.error('Failed to start task:', e)
                  $error = String(e)
                }
              }}
              onCancel={() => { showAddDialog = false; editingTask = null }}
            >
              {#snippet extras()}
                {#if !editingTask && dialogAiProvider !== 'claude-code' && dialogAgents.length > 0}
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
  </div>
</div>

<Toast />
<CheckpointToast />
<CiFailureToast />
<TaskSpawnedToast />

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
            <kbd class="kbd kbd-sm">⌘K</kbd>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Action palette</span>
            <div class="flex gap-0.5"><kbd class="kbd kbd-sm">⌘</kbd><kbd class="kbd kbd-sm">⇧</kbd><kbd class="kbd kbd-sm">P</kbd></div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Show shortcuts</span>
            <kbd class="kbd kbd-sm">?</kbd>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Work queue</span>
            <kbd class="kbd kbd-sm">⌘R</kbd>
          </div>
        </div>
      </div>

      <!-- Vim navigation -->
      <div>
        <div class="font-mono text-xs text-secondary mb-3">// vim navigation</div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Go to view</span>
            <div class="flex gap-0.5"><kbd class="kbd kbd-sm">g</kbd><kbd class="kbd kbd-sm">b/p/s/c/w/,</kbd></div>
          </div>
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
