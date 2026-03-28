import type { AgentSession } from './types'

export type OpenCodeSessionUpdate = Partial<Pick<AgentSession, 'status' | 'checkpoint_data' | 'error_message'>>

function isInputRequestedEvent(eventType: string): boolean {
  return eventType === 'permission.asked'
    || eventType === 'permission.updated'
    || eventType === 'question.asked'
}

function isInputResolvedEvent(eventType: string): boolean {
  return eventType === 'permission.replied'
    || eventType === 'question.replied'
    || eventType === 'question.rejected'
    || eventType === 'question.answered'
}

export function getOpenCodeSessionUpdate(eventType: string, data: string): OpenCodeSessionUpdate | null {
  if (eventType === 'session.idle') {
    return null
  }

  if (eventType === 'session.status') {
    try {
      const parsed = JSON.parse(data)
      const statusType = parsed.properties?.status?.type

      if (statusType === 'busy' || statusType === 'retry') {
        return {
          status: 'running',
          checkpoint_data: null,
        }
      }

      return null
    } catch {
      return null
    }
  }

  if (eventType === 'session.error') {
    return {
      status: 'failed',
      error_message: data,
    }
  }

  if (isInputRequestedEvent(eventType)) {
    return {
      status: 'paused',
      checkpoint_data: data,
    }
  }

  if (isInputResolvedEvent(eventType)) {
    return {
      status: 'running',
      checkpoint_data: null,
    }
  }

  return null
}
