<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn, Event } from '@tauri-apps/api/event'
  import { tasks, selectedTaskId, activeSessions, checkpointNotification, ticketPrs, error, isLoading, projects, activeProjectId, currentView, reviewRequestCount } from './lib/stores'
  import { getProjects, getTasksForProject, getOpenCodeStatus, getPullRequests, runAction, getSessionStatus, getLatestSessions, persistSessionStatus } from './lib/ipc'
  import type { Task, PullRequestInfo, OpenCodeStatus, AgentEvent } from './lib/types'
  import KanbanBoard from './components/KanbanBoard.svelte'
  import TaskDetailView from './components/TaskDetailView.svelte'
  import AddTaskDialog from './components/AddTaskDialog.svelte'
  import SettingsPanel from './components/SettingsPanel.svelte'
  import GlobalSettingsPanel from './components/GlobalSettingsPanel.svelte'
  import PrReviewView from './components/PrReviewView.svelte'
  import Toast from './components/Toast.svelte'
  import CheckpointToast from './components/CheckpointToast.svelte'
  import ProjectSwitcher from './components/ProjectSwitcher.svelte'
  import ProjectSetupDialog from './components/ProjectSetupDialog.svelte'


  let openCodeStatus = $state<OpenCodeStatus | null>(null)
  let unlisteners: UnlistenFn[] = []
  let showAddDialog = $state(false)
  let editingTask = $state<Task | null>(null)
  let dialogMode = $state<'create' | 'edit'>('create')
  let showProjectSetup = $state(false)

  let selectedTask = $derived($tasks.find(t => t.id === $selectedTaskId) || null)

  // Navigation logic - clear selected task when switching views
  $effect(() => {
    if ($currentView === 'pr_review') {
      $selectedTaskId = null
    }
  })
  
  $effect(() => {
    if ($currentView === 'settings' || $currentView === 'global_settings') {
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

  async function checkOpenCode() {
    try {
      openCodeStatus = await getOpenCodeStatus()
    } catch (e) {
      openCodeStatus = null
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

  onMount(async () => {
    await loadProjects()
    await checkOpenCode()

    unlisteners.push(
      await listen('jira-sync-complete', () => {
        loadTasks()
      })
    )

    unlisteners.push(
      await listen<{ task_id: string }>('action-complete', (event: Event<{ task_id: string }>) => {
        const taskId = event.payload.task_id
        const session = $activeSessions.get(taskId)
        if (session) {
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'completed' })
          $activeSessions = updated
        }
        persistSessionStatus(taskId, 'completed', null).catch(e =>
          console.error('[session] Failed to persist completed status:', e)
        )
        if ($checkpointNotification?.ticketId === taskId) {
          $checkpointNotification = null
        }
        loadTasks()
      })
    )

    unlisteners.push(
      await listen<{ task_id: string; error: string }>('implementation-failed', (event: Event<{ task_id: string; error: string }>) => {
        const taskId = event.payload.task_id
        const session = $activeSessions.get(taskId)
        if (session) {
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'failed', error_message: event.payload.error })
          $activeSessions = updated
        }
        persistSessionStatus(taskId, 'failed', event.payload.error).catch(e =>
          console.error('[session] Failed to persist failed status:', e)
        )
        if ($checkpointNotification?.ticketId === taskId) {
          $checkpointNotification = null
        }
        loadTasks()
      })
    )

    unlisteners.push(
      await listen('worktree-cleaned', () => {
        loadTasks()
      })
    )

    unlisteners.push(
      await listen('new-pr-comment', () => {
        loadTasks()
        loadPullRequests()
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
              const updated = new Map($activeSessions)
              updated.set(taskId, { ...session, status: 'completed' })
              $activeSessions = updated
              // Clear stale checkpoint notification for this task
              if ($checkpointNotification?.ticketId === taskId) {
                $checkpointNotification = null
              }
            } else if (statusType === 'busy') {
              console.log('[session] SSE session busy for task:', taskId)
              const updated = new Map($activeSessions)
              updated.set(taskId, { ...session, status: 'running', checkpoint_data: null })
              $activeSessions = updated
              persistSessionStatus(taskId, 'running', null, null).catch(e =>
                console.error('[session] Failed to persist running status:', e)
              )
              if ($checkpointNotification?.ticketId === taskId) {
                $checkpointNotification = null
              }
            } else if (statusType === 'retry') {
              console.log('[session] SSE session retry for task:', taskId)
              const updated = new Map($activeSessions)
              updated.set(taskId, { ...session, status: 'running', checkpoint_data: null })
              $activeSessions = updated
              persistSessionStatus(taskId, 'running', null, null).catch(e =>
                console.error('[session] Failed to persist running status:', e)
              )
              if ($checkpointNotification?.ticketId === taskId) {
                $checkpointNotification = null
              }
            }
          } catch {
            if (eventType === 'session.idle') {
              const updated = new Map($activeSessions)
              updated.set(taskId, { ...session, status: 'completed' })
              $activeSessions = updated
              if ($checkpointNotification?.ticketId === taskId) {
                $checkpointNotification = null
              }
            }
          }
        } else if (eventType === 'session.error') {
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'failed', error_message: event.payload.data })
          $activeSessions = updated
          // Clear stale checkpoint notification for this task
          if ($checkpointNotification?.ticketId === taskId) {
            $checkpointNotification = null
          }
        } else if (eventType === 'permission.updated' || eventType === 'question.asked') {
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'paused', checkpoint_data: event.payload.data })
          $activeSessions = updated
          persistSessionStatus(taskId, 'paused', null, event.payload.data).catch(e =>
            console.error('[session] Failed to persist paused status:', e)
          )
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
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'running', checkpoint_data: null })
          $activeSessions = updated
          persistSessionStatus(taskId, 'running', null, null).catch(e =>
            console.error('[session] Failed to persist running status:', e)
          )
          if ($checkpointNotification?.ticketId === taskId) {
            $checkpointNotification = null
          }
        }
      })
    )

    unlisteners.push(
      await listen<{ ticket_id: string; session_id: string }>('session-aborted', (event: Event<{ ticket_id: string; session_id: string }>) => {
        const updated = new Map($activeSessions)
        updated.delete(event.payload.ticket_id)
        $activeSessions = updated
        if ($checkpointNotification?.ticketId === event.payload.ticket_id) {
          $checkpointNotification = null
        }
      })
    )

    unlisteners.push(
      await listen<number>('review-pr-count-changed', (event: Event<number>) => {
        $reviewRequestCount = event.payload
      })
    )
  })

  onDestroy(() => {
    unlisteners.forEach(fn => fn())
  })
</script>

<div class="app">
  <header class="top-bar">
    <div class="top-bar-left">
      <h1 class="app-title">AI Command Center</h1>
      <ProjectSwitcher onNewProject={() => showProjectSetup = true} />
    </div>
    
    <nav class="view-switcher">
      <button 
        class="view-tab" 
        class:active={$currentView === 'board'} 
        onclick={() => $currentView = 'board'}
      >
        Board
      </button>
      <button 
        class="view-tab" 
        class:active={$currentView === 'pr_review'} 
        onclick={() => $currentView = 'pr_review'}
      >
        PR Review
        {#if $reviewRequestCount > 0}
          <span class="badge">{$reviewRequestCount}</span>
        {/if}
      </button>
      <button 
        class="view-tab" 
        class:active={$currentView === 'settings' || $currentView === 'global_settings'} 
        onclick={() => { if ($currentView !== 'settings' && $currentView !== 'global_settings') $currentView = 'settings' }}
      >
        Settings
      </button>
    </nav>

    <div class="status-bar">
      {#if openCodeStatus}
        <span class="status-indicator" class:healthy={openCodeStatus.healthy} class:unhealthy={!openCodeStatus.healthy}>
          <span class="dot"></span>
          OpenCode {openCodeStatus.healthy ? 'Connected' : 'Disconnected'}
        </span>
      {:else}
        <span class="status-indicator unhealthy">
          <span class="dot"></span>
          OpenCode Unavailable
        </span>
      {/if}
    </div>
  </header>

  <main class="main-content">
    {#if $currentView === 'settings' || $currentView === 'global_settings'}
      <div class="settings-view">
        <div class="settings-sub-tabs">
          <button
            class="sub-tab"
            class:active={$currentView === 'settings'}
            onclick={() => $currentView = 'settings'}
          >
            Project
          </button>
          <button
            class="sub-tab"
            class:active={$currentView === 'global_settings'}
            onclick={() => $currentView = 'global_settings'}
          >
            Global
          </button>
        </div>
        <div class="settings-panel-content">
          {#if $currentView === 'settings'}
            <SettingsPanel onClose={() => $currentView = 'board'} onProjectDeleted={loadProjects} />
          {:else}
            <GlobalSettingsPanel onClose={() => $currentView = 'board'} />
          {/if}
        </div>
      </div>
    {:else if $currentView === 'pr_review'}
      <PrReviewView />
    {:else if selectedTask}
      <TaskDetailView task={selectedTask} />
    {:else}
      <div class="board-area">
        {#if $isLoading && $tasks.length === 0}
          <div class="loading-overlay">
            <div class="spinner"></div>
            <span>Loading tasks...</span>
          </div>
        {:else}
          <KanbanBoard onRunAction={handleRunAction} />
        {/if}
      </div>
    {/if}

    {#if showAddDialog}
      <AddTaskDialog mode={dialogMode} task={editingTask} onClose={() => { showAddDialog = false; editingTask = null }} onTaskSaved={() => { showAddDialog = false; editingTask = null; loadTasks() }} />
    {/if}

    {#if showProjectSetup}
      <ProjectSetupDialog onClose={() => showProjectSetup = false} onProjectCreated={handleProjectCreated} />
    {/if}
  </main>
</div>

<Toast />
<CheckpointToast />

<style>
  :global(:root) {
    --bg-primary: #1a1b26;
    --bg-secondary: #24283b;
    --bg-card: #2f3349;
    --text-primary: #c0caf5;
    --text-secondary: #565f89;
    --accent: #7aa2f7;
    --success: #9ece6a;
    --warning: #e0af68;
    --error: #f7768e;
    --border: #3b4261;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
      'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
      sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  :global(*) {
    box-sizing: border-box;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    height: 56px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    gap: 20px;
  }

  .top-bar-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .app-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: 0.02em;
  }

  .view-switcher {
    display: flex;
    gap: 4px;
    background: var(--bg-primary);
    padding: 4px;
    border-radius: 8px;
  }

  .view-tab {
    all: unset;
    position: relative;
    padding: 8px 16px;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-secondary);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .view-tab:hover {
    color: var(--text-primary);
    background: rgba(122, 162, 247, 0.1);
  }

  .view-tab.active {
    color: var(--accent);
    background: var(--bg-card);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .badge {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--bg-primary);
    background: var(--accent);
    border-radius: 9px;
  }

  .status-bar {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-secondary);
  }

  .healthy .dot {
    background: var(--success);
  }

  .unhealthy .dot {
    background: var(--error);
  }

  .main-content {
    flex: 1;
    overflow: hidden;
    display: flex;
  }

  .settings-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    width: 100%;
  }

  .settings-sub-tabs {
    display: flex;
    gap: 0;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    padding: 0 20px;
    flex-shrink: 0;
  }

  .sub-tab {
    all: unset;
    padding: 10px 20px;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
  }

  .sub-tab:hover {
    color: var(--text-primary);
  }

  .sub-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .settings-panel-content {
    flex: 1;
    overflow: hidden;
  }

  .board-area {
    flex: 1;
    overflow: hidden;
  }

  .loading-overlay {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
