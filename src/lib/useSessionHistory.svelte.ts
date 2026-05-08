import { get } from 'svelte/store'
import { activeSessions } from './stores'
import { getLatestSession, getSessionOutput } from './ipc'

export interface SessionHistoryHandle {
  readonly loadingHistory: boolean
  loadSessionHistory(): Promise<void>
}

export function createSessionHistory(deps: {
  taskId: string
  onStatusUpdate: (status: 'complete' | 'error' | 'idle', errorMessage?: string | null) => void
  onOutputLoaded?: (output: string) => void
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

      if (existingSession.provider === 'opencode' && deps.onOutputLoaded) {
        try {
          const output = await getSessionOutput(deps.taskId)
          if (output) deps.onOutputLoaded(output)
        } catch (e) {
          console.error('[useSessionHistory] Failed to load legacy OpenCode session output:', e)
        }
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
