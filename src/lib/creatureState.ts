import type { Task, AgentSession } from './types'

export type CreatureState = 'egg' | 'idle' | 'active' | 'needs-input' | 'resting' | 'celebrating' | 'sad' | 'frozen'

export function computeCreatureState(task: Task, session: AgentSession | null): CreatureState {
  // Backlog tasks are always eggs
  if (task.status === 'backlog') {
    return 'egg'
  }

  // Doing tasks map to various states based on session
  if (task.status === 'doing') {
    // No session = idle
    if (session === null) {
      return 'idle'
    }

    // Map session status to creature state
    switch (session.status) {
      case 'running':
        return 'active'
      case 'paused':
        return session.checkpoint_data !== null ? 'needs-input' : 'resting'
      case 'completed':
        return 'celebrating'
      case 'failed':
        return 'sad'
      case 'interrupted':
        return 'frozen'
      default:
        return 'idle'
    }
  }

  // Fallback for any other task status
  return 'idle'
}
