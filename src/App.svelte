<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn, Event } from '@tauri-apps/api/event'
  import { tasks, selectedTaskId, activeSessions, checkpointNotification, ciFailureNotification, ticketPrs, error, isLoading, projects, activeProjectId, currentView, reviewRequestCount, projectAttention, taskSpawned, searchQuery, selectedSkillName } from './lib/stores'
  import { getProjects, getTasksForProject, getPullRequests, runAction, getSessionStatus, getLatestSession, getLatestSessions, forceGithubSync, createTask, updateTask, getProjectAttention, getAppMode, finalizeClaudeSession } from './lib/ipc'
  import type { Task, PullRequestInfo, AgentEvent, ProjectAttention, AppView } from './lib/types'
  import KanbanBoard from './components/KanbanBoard.svelte'
  import TaskDetailView from './components/TaskDetailView.svelte'
   import PromptInput from './components/PromptInput.svelte'
  import Modal from './components/Modal.svelte'
   import SettingsView from './components/SettingsView.svelte'
   import PrReviewView from './components/PrReviewView.svelte'
   import SkillsView from './components/SkillsView.svelte'
   import CreaturesView from './components/CreaturesView.svelte'
   import Toast from './components/Toast.svelte'
  import CheckpointToast from './components/CheckpointToast.svelte'
  import CiFailureToast from './components/CiFailureToast.svelte'
  import TaskSpawnedToast from './components/TaskSpawnedToast.svelte'
  import ProjectSwitcher from './components/ProjectSwitcher.svelte'
  import ProjectSetupDialog from './components/ProjectSetupDialog.svelte'
  import IconRail from './components/IconRail.svelte'
  import { RefreshCw } from 'lucide-svelte'

  import { pushNavState, navigateBack } from './lib/navigation'
  import { release as releaseTerminal } from './lib/terminalPool'

  let unlisteners: UnlistenFn[] = []
  let showAddDialog = $state(false)
  let isSyncing = $state(false)
  let editingTask = $state<Task | null>(null)
  let showProjectSetup = $state(false)
  let appMode = $state<string | null>(null)

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
    } catch (e) {
      console.error('[session] Failed to run action for task:', taskId, e)
      $error = String(e)
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
    if (e.metaKey && e.key === 't') {
      e.preventDefault()
      if (!showAddDialog) {
        editingTask = null
        showAddDialog = true
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
    if ((e.metaKey || e.ctrlKey) && e.key === '/') {
      e.preventDefault()
      const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement
      searchInput?.focus()
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
    loadProjectAttention()

    // Phase 3: Safety net
    await loadTasks()
  })

  onDestroy(() => {
    unlisteners.forEach(fn => fn())
  })
</script>

<div class="flex h-screen overflow-hidden bg-base-200">
  <IconRail currentView={$currentView} onNavigate={handleNavigate} reviewRequestCount={$reviewRequestCount} />

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
          }}
        >
          + new_task <span class="text-[0.65rem] opacity-70 ml-1 font-normal">&#8984;T</span>
        </button>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-primary"></span>
        <span class="text-xs text-secondary font-mono">connected</span>
      </div>
    </header>

    {#if $currentView === 'board' && !selectedTask}
      <div class="flex items-center gap-3 px-6 py-2 border-b border-base-300 shrink-0">
        <label class="input input-bordered input-sm flex items-center gap-2 w-72 font-mono text-xs">
          <span class="text-secondary">$</span>
          <input
            type="text"
            class="grow bg-transparent border-none outline-none text-sm font-mono"
            placeholder="search"
            data-search-input
            bind:value={$searchQuery}
          />
        </label>
        <button
          class="btn btn-ghost btn-sm btn-square"
          onclick={triggerGithubSync}
          disabled={isSyncing}
          title="Refresh GitHub data (⌘⇧R)"
        >
          {#if isSyncing}
            <span class="loading loading-spinner loading-xs"></span>
          {:else}
            <RefreshCw size={16} />
          {/if}
        </button>
      </div>
    {/if}

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
         />
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
                    await createTask(prompt, 'backlog', jiraKey, $activeProjectId)
                  }
                  showAddDialog = false
                  editingTask = null
                  await loadTasks()
                } catch (e) {
                  console.error('Failed to save task:', e)
                  $error = String(e)
                }
              }}
              onCancel={() => { showAddDialog = false; editingTask = null }}
            />
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
