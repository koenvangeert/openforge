import { get } from 'svelte/store'
import { activeSessions } from './stores'
import { getLatestSession, getWorktreeForTask } from './ipc'

export interface SessionHistoryHandle {
  readonly loadingHistory: boolean
  loadSessionHistory(): Promise<void>
}

export function createSessionHistory(deps: {
  taskId: string
  getOpencodePort: () => number | null
  setOpencodePort: (port: number) => void
  onStatusUpdate: (status: 'complete' | 'error' | 'idle', errorMessage?: string | null) => void
}): SessionHistoryHandle {
  let loadingHistory = $state(false)

  async function loadSessionHistory(): Promise<void> {
    loadingHistory = true
    try {
      let existingSession = get(activeSessions).get(deps.taskId) ?? null

      if (!existingSession) {
        const dbSession = await getLatestSession(deps.taskId)
        if (dbSession && (
          dbSession.status === 'completed' ||
          dbSession.status === 'failed' ||
          dbSession.status === 'paused' ||
          dbSession.status === 'interrupted'
        )) {
          const updated = new Map(get(activeSessions))
          updated.set(deps.taskId, dbSession)
          activeSessions.set(updated)
          existingSession = dbSession
        }
      }

      if (!existingSession) return

      if (!deps.getOpencodePort()) {
        const worktree = await getWorktreeForTask(deps.taskId)
        if (worktree?.opencode_port) deps.setOpencodePort(worktree.opencode_port)
      }

      if (
        existingSession.status !== 'completed' &&
        existingSession.status !== 'failed' &&
        existingSession.status !== 'paused' &&
        existingSession.status !== 'interrupted'
      ) return

      if (existingSession.status === 'completed') {
        deps.onStatusUpdate('complete')
      } else if (existingSession.status === 'paused') {
        deps.onStatusUpdate('idle')
      } else {
        deps.onStatusUpdate('error', existingSession.error_message)
      }
    } catch (e) {
      console.error('[useSessionHistory] Failed to load session history:', e)
    } finally {
      loadingHistory = false
    }
  }

  return {
    get loadingHistory() { return loadingHistory },
    loadSessionHistory,
  }
}
