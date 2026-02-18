<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import { tasks, selectedTaskId, activeSessions, checkpointNotification, ticketPrs, error, isLoading, projects, activeProjectId } from './lib/stores'
  import { getProjects, getTasksForProject, getOpenCodeStatus, getPullRequests, startImplementation, getSessionStatus, getLatestSessions, persistSessionStatus } from './lib/ipc'
  import type { Task, PullRequestInfo, OpenCodeStatus, AgentEvent } from './lib/types'
  import KanbanBoard from './components/KanbanBoard.svelte'
  import TaskDetailView from './components/TaskDetailView.svelte'
  import AddTaskDialog from './components/AddTaskDialog.svelte'
import SettingsPanel from './components/SettingsPanel.svelte'
import GlobalSettingsPanel from './components/GlobalSettingsPanel.svelte'
import Toast from './components/Toast.svelte'
import CheckpointToast from './components/CheckpointToast.svelte'
import ProjectSwitcher from './components/ProjectSwitcher.svelte'
import ProjectSetupDialog from './components/ProjectSetupDialog.svelte'


  let openCodeStatus: OpenCodeStatus | null = null
  let unlisteners: UnlistenFn[] = []
  let showSettings = false
  let showGlobalSettings = false
  let showAddDialog = false
  let editingTask: Task | null = null
  let dialogMode: 'create' | 'edit' = 'create'
  let showProjectSetup = false

  $: selectedTask = $tasks.find(t => t.id === $selectedTaskId) || null

  // Close settings panels when a task is selected (includes toast click navigation)
  $: if ($selectedTaskId) { showSettings = false; showGlobalSettings = false }

  // Reload tasks when active project changes
  $: if ($activeProjectId) {
    loadTasks()
    loadPullRequests()
  }

  // Find active project
  $: activeProject = $projects.find(p => p.id === $activeProjectId) || null

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
        if (session.status === 'completed' || session.status === 'failed') {
          updated.set(session.ticket_id, session)
        }
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

  async function handleStartImplementation(event: CustomEvent<{ taskId: string }>) {
    if (!activeProject) {
      $error = 'No active project selected'
      return
    }
    const taskId = event.detail.taskId
    try {
      console.log('[session] Starting implementation for task:', taskId)
      const result = await startImplementation(taskId, activeProject.path)
      console.log('[session] Implementation started, session_id:', result.session_id)

      // Fetch the full session from DB and populate the activeSessions store
      try {
        const session = await getSessionStatus(result.session_id)
        console.log('[session] Fetched session status:', session.id, 'status:', session.status, 'stage:', session.stage)
        const updated = new Map($activeSessions)
        updated.set(taskId, session)
        $activeSessions = updated
      } catch (sessionErr) {
        console.error('[session] Failed to fetch session after start:', sessionErr)
      }

      await loadTasks()
    } catch (e) {
      console.error('[session] Failed to start implementation for task:', taskId, e)
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
      await listen<{ task_id: string }>('implementation-complete', (event) => {
        const taskId = event.payload.task_id
        console.log('[session] Implementation complete for task:', taskId)
        const session = $activeSessions.get(taskId)
        if (session) {
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'completed' })
          $activeSessions = updated
          console.log('[session] Updated session status to completed for task:', taskId)
        } else {
          console.warn('[session] No active session found for completed task:', taskId)
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
      await listen<{ task_id: string; error: string }>('implementation-failed', (event) => {
        const taskId = event.payload.task_id
        console.log('[session] Implementation failed for task:', taskId, 'error:', event.payload.error)
        const session = $activeSessions.get(taskId)
        if (session) {
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'failed', error_message: event.payload.error })
          $activeSessions = updated
          console.log('[session] Updated session status to failed for task:', taskId)
        } else {
          console.warn('[session] No active session found for failed task:', taskId)
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
      await listen<AgentEvent>('agent-event', (event) => {
        const { task_id: taskId, event_type: eventType } = event.payload
        const session = $activeSessions.get(taskId)
        if (!session) return

        if (eventType === 'session.idle' || eventType === 'session.status') {
          try {
            const parsed = JSON.parse(event.payload.data)
            const statusType = parsed.properties?.status?.type
            if (eventType === 'session.idle' || statusType === 'idle') {
              console.log('[session] SSE session idle for task:', taskId)
              const updated = new Map($activeSessions)
              updated.set(taskId, { ...session, status: 'completed' })
              $activeSessions = updated
              // Clear stale checkpoint notification for this task
              if ($checkpointNotification?.ticketId === taskId) {
                $checkpointNotification = null
              }
            }
          } catch {
            if (eventType === 'session.idle') {
              console.log('[session] SSE session.idle for task:', taskId)
              const updated = new Map($activeSessions)
              updated.set(taskId, { ...session, status: 'completed' })
              $activeSessions = updated
              if ($checkpointNotification?.ticketId === taskId) {
                $checkpointNotification = null
              }
            }
          }
        } else if (eventType === 'session.error') {
          console.log('[session] SSE session.error for task:', taskId, 'data:', event.payload.data)
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'failed', error_message: event.payload.data })
          $activeSessions = updated
          // Clear stale checkpoint notification for this task
          if ($checkpointNotification?.ticketId === taskId) {
            $checkpointNotification = null
          }
        } else if (eventType === 'permission.updated') {
          // Agent is blocked waiting for user approval
          console.log('[session] SSE permission.updated for task:', taskId)
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'paused', checkpoint_data: event.payload.data })
          $activeSessions = updated
          // Find the task to get ticketKey
          const task = $tasks.find(t => t.id === taskId)
          $checkpointNotification = {
            ticketId: taskId,
            ticketKey: task?.jira_key ?? null,
            sessionId: session.id,
            stage: session.stage,
            message: 'Agent needs approval',
            timestamp: Date.now(),
          }
        } else if (eventType === 'permission.replied') {
          // User responded to permission prompt — agent is no longer blocked
          console.log('[session] SSE permission.replied for task:', taskId)
          const updated = new Map($activeSessions)
          updated.set(taskId, { ...session, status: 'running', checkpoint_data: null })
          $activeSessions = updated
          if ($checkpointNotification?.ticketId === taskId) {
            $checkpointNotification = null
          }
        }
      })
    )

    unlisteners.push(
      await listen<{ ticket_id: string; session_id: string }>('session-aborted', (event) => {
        console.log('[session] Session aborted for task:', event.payload.ticket_id)
        const updated = new Map($activeSessions)
        updated.delete(event.payload.ticket_id)
        $activeSessions = updated
        if ($checkpointNotification?.ticketId === event.payload.ticket_id) {
          $checkpointNotification = null
        }
      })
    )
  })

  onDestroy(() => {
    unlisteners.forEach(fn => fn())
  })
</script>

<div class="app">
  <header class="top-bar">
    <h1 class="app-title">AI Command Center</h1>
    <ProjectSwitcher on:new-project={() => showProjectSetup = true} />
    <div class="status-bar">
      <button class="settings-btn" on:click={() => { showGlobalSettings = !showGlobalSettings; showSettings = false; $selectedTaskId = null }}>
        ⚙
      </button>
      <button class="settings-btn" on:click={() => { showSettings = !showSettings; showGlobalSettings = false; $selectedTaskId = null }}>
        {showSettings ? 'Board' : 'Settings'}
      </button>
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
    {#if showGlobalSettings}
      <GlobalSettingsPanel on:close={() => showGlobalSettings = false} />
    {:else if showSettings}
      <SettingsPanel on:close={() => showSettings = false} on:project-deleted={loadProjects} />
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
          <KanbanBoard on:start-implementation={handleStartImplementation} />
        {/if}
      </div>
    {/if}

    {#if showAddDialog}
      <AddTaskDialog mode={dialogMode} task={editingTask} on:close={() => { showAddDialog = false; editingTask = null }} on:task-saved={() => { showAddDialog = false; editingTask = null; loadTasks() }} />
    {/if}

    {#if showProjectSetup}
      <ProjectSetupDialog on:close={() => showProjectSetup = false} on:project-created={handleProjectCreated} />
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
    height: 48px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .app-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: 0.02em;
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

  .board-area {
    flex: 1;
    overflow: hidden;
  }

  .settings-btn {
    all: unset;
    padding: 4px 12px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }

  .settings-btn:hover {
    color: var(--text-primary);
    border-color: var(--accent);
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
