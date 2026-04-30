import { listen } from '@tauri-apps/api/event'
import type { UnlistenFn } from '@tauri-apps/api/event'

export type AgentPanelStatus = 'idle' | 'running' | 'complete' | 'error'

interface AgentStatusChangedPayload {
  task_id: string
  status: string
}

interface AgentStatusChangedEvent {
  payload: unknown
}

interface AgentStatusChangedHandlerOptions {
  taskId: string
  setStatus: (status: AgentPanelStatus) => void
  onRunning?: () => void
}

export function getAgentPanelStatusFromSessionStatus(sessionStatus: string | null | undefined): AgentPanelStatus {
  switch (sessionStatus) {
    case 'running':
    case 'paused':
      return 'running'
    case 'completed':
      return 'complete'
    case 'failed':
    case 'interrupted':
      return 'error'
    default:
      return 'idle'
  }
}

function isAgentStatusChangedPayload(payload: unknown): payload is AgentStatusChangedPayload {
  if (!payload || typeof payload !== 'object') return false
  const maybePayload = payload as Partial<AgentStatusChangedPayload>
  return typeof maybePayload.task_id === 'string' && typeof maybePayload.status === 'string'
}

export function createAgentStatusChangedHandler({
  taskId,
  setStatus,
  onRunning,
}: AgentStatusChangedHandlerOptions): (event: AgentStatusChangedEvent) => void {
  return (event) => {
    if (!isAgentStatusChangedPayload(event.payload)) return
    if (event.payload.task_id !== taskId) return

    const nextStatus = getAgentPanelStatusFromSessionStatus(event.payload.status)
    if (nextStatus === 'idle') return

    setStatus(nextStatus)
    if (nextStatus === 'running') {
      onRunning?.()
    }
  }
}

export async function listenToAgentStatusChanged(options: AgentStatusChangedHandlerOptions): Promise<UnlistenFn> {
  return listen<AgentStatusChangedPayload>('agent-status-changed', createAgentStatusChangedHandler(options))
}
