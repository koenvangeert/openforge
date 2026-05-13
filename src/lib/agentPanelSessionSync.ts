import { listenDesktopEvent, type DesktopUnlistenFn } from './desktopIpc'

export type AgentPanelStatus = 'idle' | 'running' | 'complete' | 'error'

interface AgentStatusChangedPayload {
  task_id: string
  status: string
  provider?: string
  kind?: 'started' | 'became_busy' | 'became_idle' | 'requested_permission' | 'failed' | 'ended'
  pty_instance_id?: number | null
  raw_event_type?: string | null
  raw_status_type?: string | null
}

interface AgentStatusChangedEvent {
  payload: unknown
}

interface AgentStatusChangedHandlerOptions {
  taskId: string
  setStatus: (status: AgentPanelStatus) => void
  onRunning?: () => void
  onPtyInstanceId?: (ptyInstanceId: number) => void
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
  onPtyInstanceId,
}: AgentStatusChangedHandlerOptions): (event: AgentStatusChangedEvent) => void {
  return (event) => {
    if (!isAgentStatusChangedPayload(event.payload)) return
    if (event.payload.task_id !== taskId) return

    const nextStatus = getAgentPanelStatusFromSessionStatus(event.payload.status)
    if (nextStatus === 'idle') return

    setStatus(nextStatus)
    if (typeof event.payload.pty_instance_id === 'number') {
      onPtyInstanceId?.(event.payload.pty_instance_id)
    }
    if (nextStatus === 'running') {
      onRunning?.()
    }
  }
}

export async function listenToAgentStatusChanged(options: AgentStatusChangedHandlerOptions): Promise<DesktopUnlistenFn> {
  return listenDesktopEvent<AgentStatusChangedPayload>('agent-status-changed', createAgentStatusChangedHandler(options))
}
