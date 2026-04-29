import { listen as tauriListen } from '@tauri-apps/api/event'
import type { Event, UnlistenFn } from '@tauri-apps/api/event'
import { get } from 'svelte/store'
import {
  activeSessions,
  checkpointNotification,
  ciFailureNotification,
  rateLimitNotification,
  taskRuntimeInfo,
  taskSpawned,
  tasks,
} from './stores'
import { finalizeClaudeSession, getLatestSession, getTaskDetail } from './ipc'
import { release as releaseTerminal } from './terminalPool'
import { getOpenCodeSessionUpdate } from './opencodeSessionEvents'
import { getTaskPromptText } from './taskPrompt'
import type { AgentEvent, AgentSession } from './types'

export type AppEventListen = <T>(
  event: string,
  handler: (event: Event<T>) => void | Promise<void>,
) => Promise<UnlistenFn>

export interface AppWindowCloseTarget {
  onCloseRequested(handler: (event: { preventDefault: () => void }) => void): Promise<UnlistenFn>
}

export interface AppTauriEventDeps {
  appWindow: AppWindowCloseTarget
  onCloseRequested(event: { preventDefault: () => void }): void
  loadTasks(): Promise<void> | void
  loadSessions(): Promise<void> | void
  loadPullRequests(): Promise<void> | void
  loadProjectAttention(): Promise<void> | void
  refreshPrCounts(): Promise<void> | void
  listen?: AppEventListen
}

function setActiveSession(taskId: string, session: AgentSession): void {
  const updated = new Map(get(activeSessions))
  updated.set(taskId, session)
  activeSessions.set(updated)
}

function deleteActiveSession(taskId: string): void {
  const updated = new Map(get(activeSessions))
  updated.delete(taskId)
  activeSessions.set(updated)
}

function clearCheckpointForTask(taskId: string): void {
  if (get(checkpointNotification)?.ticketId === taskId) {
    checkpointNotification.set(null)
  }
}

async function getOrLoadActiveSession(taskId: string): Promise<AgentSession | null> {
  const existing = get(activeSessions).get(taskId)
  if (existing) return existing

  try {
    const fetched = await getLatestSession(taskId)
    if (!fetched) return null

    setActiveSession(taskId, fetched)
    return fetched
  } catch {
    return null
  }
}

export async function registerAppTauriEventListeners(deps: AppTauriEventDeps): Promise<UnlistenFn[]> {
  const listen = deps.listen ?? tauriListen
  const unlisteners: UnlistenFn[] = []

  unlisteners.push(await deps.appWindow.onCloseRequested(deps.onCloseRequested))

  unlisteners.push(
    await listen('github-sync-complete', () => {
      void deps.loadPullRequests()
      void deps.loadProjectAttention()
    }),
  )

  unlisteners.push(
    await listen('review-status-changed', () => {
      void deps.loadPullRequests()
    }),
  )

  unlisteners.push(
    await listen<{ task_id: string }>('action-complete', async (event) => {
      const taskId = event.payload.task_id
      const session = await getOrLoadActiveSession(taskId)
      if (session && session.status !== 'completed') {
        setActiveSession(taskId, { ...session, status: 'completed', checkpoint_data: null })
      }
      clearCheckpointForTask(taskId)
      void deps.loadTasks()
      void deps.loadProjectAttention()
    }),
  )

  unlisteners.push(
    await listen<{ task_id: string; error: string }>('implementation-failed', (event) => {
      const taskId = event.payload.task_id
      const session = get(activeSessions).get(taskId)
      if (session) {
        if (session.status === 'failed') return
        setActiveSession(taskId, { ...session, status: 'failed', error_message: event.payload.error })
      }
      clearCheckpointForTask(taskId)
      void deps.loadTasks()
      void deps.loadProjectAttention()
    }),
  )

  unlisteners.push(
    await listen<{ task_id: string; port: number; workspace_path: string }>('server-resumed', async (event) => {
      const taskId = event.payload.task_id
      const updatedRuntimeInfo = new Map(get(taskRuntimeInfo))
      updatedRuntimeInfo.set(taskId, {
        workspacePath: event.payload.workspace_path,
        opencodePort: event.payload.port || null,
      })
      taskRuntimeInfo.set(updatedRuntimeInfo)

      try {
        const session = await getLatestSession(taskId)
        if (session) {
          setActiveSession(taskId, session)
        }
      } catch (e) {
        console.error('[startup] Failed to load session after server resume for task:', taskId, e)
      }
    }),
  )

  unlisteners.push(
    await listen('startup-resume-complete', () => {
      void deps.loadSessions()
    }),
  )

  unlisteners.push(
    await listen('new-pr-comment', () => {
      void deps.loadTasks()
      void deps.loadPullRequests()
      void deps.loadProjectAttention()
    }),
  )

  unlisteners.push(
    await listen('comment-addressed', () => {
      void deps.loadPullRequests()
      void deps.loadProjectAttention()
    }),
  )

  unlisteners.push(
    await listen<{ task_id: string; pr_id: number; pr_title: string; ci_status: string; timestamp: number }>('ci-status-changed', (event) => {
      if (event.payload.ci_status === 'failure') {
        const session = get(activeSessions).get(event.payload.task_id)
        if (!session || session.status !== 'running') {
          ciFailureNotification.set({
            task_id: event.payload.task_id,
            pr_id: event.payload.pr_id,
            pr_title: event.payload.pr_title,
            ci_status: event.payload.ci_status,
            timestamp: event.payload.timestamp,
          })
        }
      }
      void deps.loadPullRequests()
      void deps.loadProjectAttention()
    }),
  )

  unlisteners.push(
    await listen<AgentEvent>('agent-event', async (event) => {
      const { task_id: taskId, event_type: eventType } = event.payload
      const session = await getOrLoadActiveSession(taskId)
      if (!session) return

      const sessionUpdate = getOpenCodeSessionUpdate(eventType, event.payload.data)
      if (!sessionUpdate) {
        void deps.loadProjectAttention()
        return
      }

      if (sessionUpdate.status === 'paused') {
        if (session.status === 'paused' && session.checkpoint_data === sessionUpdate.checkpoint_data) return

        setActiveSession(taskId, { ...session, ...sessionUpdate })

        const task = get(tasks).find(t => t.id === taskId)
        checkpointNotification.set({
          ticketId: taskId,
          ticketKey: task?.id ?? null,
          sessionId: session.id,
          stage: session.stage,
          message: 'Agent needs input',
          timestamp: Date.now(),
        })
      } else {
        if (
          session.status === sessionUpdate.status &&
          session.checkpoint_data === sessionUpdate.checkpoint_data &&
          session.error_message === sessionUpdate.error_message
        ) {
          void deps.loadProjectAttention()
          return
        }

        setActiveSession(taskId, { ...session, ...sessionUpdate })
        clearCheckpointForTask(taskId)
      }

      void deps.loadProjectAttention()
    }),
  )

  unlisteners.push(
    await listen<{ ticket_id: string; session_id: string }>('session-aborted', (event) => {
      deleteActiveSession(event.payload.ticket_id)
      releaseTerminal(event.payload.ticket_id)
      clearCheckpointForTask(event.payload.ticket_id)
      void deps.loadProjectAttention()
    }),
  )

  unlisteners.push(
    await listen<{ task_id: string; status: string }>('agent-status-changed', async (event) => {
      const { task_id: taskId, status } = event.payload
      let session = get(activeSessions).get(taskId)
      if (!session) {
        try {
          const fetched = await getLatestSession(taskId)
          if (fetched) {
            session = fetched
            setActiveSession(taskId, fetched)
          } else {
            return
          }
        } catch {
          return
        }
      }

      if (status === 'completed') {
        if (session.status === 'completed') return
        setActiveSession(taskId, { ...session, status: 'completed' })
        clearCheckpointForTask(taskId)
        void deps.loadTasks()
      } else if (status === 'running') {
        if (session.status === 'running') return
        setActiveSession(taskId, { ...session, status: 'running', checkpoint_data: null })
        clearCheckpointForTask(taskId)
      } else if (status === 'paused') {
        if (session.status === 'paused') return
        setActiveSession(taskId, { ...session, status: 'paused' })
        const task = get(tasks).find(t => t.id === taskId)
        checkpointNotification.set({
          ticketId: taskId,
          ticketKey: task?.id ?? null,
          sessionId: session.id,
          stage: session.stage,
          message: 'Agent needs permission',
          timestamp: Date.now(),
        })
      } else if (status === 'interrupted') {
        if (session.status === 'interrupted') return
        setActiveSession(taskId, { ...session, status: 'interrupted' })
        clearCheckpointForTask(taskId)
        void deps.loadTasks()
      }
      void deps.loadProjectAttention()
    }),
  )

  unlisteners.push(
    await listen<{ task_id: string; success: boolean }>('agent-pty-exited', (event) => {
      const taskId = event.payload.task_id
      const success = event.payload.success
      setTimeout(async () => {
        try {
          await finalizeClaudeSession(taskId, success)
        } catch (e) {
          console.error('[pty-exit] Failed to finalize session for task:', taskId, e)
        }
      }, 1500)
    }),
  )

  unlisteners.push(
    await listen<number>('review-pr-count-changed', () => {
      void deps.refreshPrCounts()
    }),
  )

  unlisteners.push(
    await listen('authored-prs-updated', () => {
      void deps.refreshPrCounts()
    }),
  )

  unlisteners.push(
    await listen<{ reset_at: number | null }>('github-rate-limited', (event) => {
      rateLimitNotification.set({
        reset_at: event.payload.reset_at,
        timestamp: Date.now(),
      })
    }),
  )

  unlisteners.push(
    await listen<{ action: string; task_id: string }>('task-changed', async (event) => {
      if (event.payload.action === 'deleted') {
        const taskId = event.payload.task_id
        deleteActiveSession(taskId)
        releaseTerminal(taskId)
        clearCheckpointForTask(taskId)
      } else if (event.payload.action === 'created') {
        try {
          const task = await getTaskDetail(event.payload.task_id)
          taskSpawned.set({ taskId: task.id, promptText: getTaskPromptText(task) })
        } catch (e) {
          console.error('Failed to load created task for toast:', e)
        }
      }
      await deps.loadTasks()
    }),
  )

  return unlisteners
}
