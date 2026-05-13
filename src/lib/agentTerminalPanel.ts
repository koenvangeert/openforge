import { abortImplementation, killPty, writePty } from './ipc'
import { getShellLifecycleState, updateShellLifecycleState } from './terminalPool'
import { getAgentPanelStatusFromSessionStatus, type AgentPanelStatus } from './agentPanelSessionSync'

export type AgentStageLabels = Record<string, string>
export type AgentSessionStatusBadgeVariant = 'soft' | 'badge'

interface SyncAgentPanelStatusOptions {
  taskId: string
  sessionStatus: string | null | undefined
  setStatus: (status: AgentPanelStatus) => void
  setTerminalActive?: (active: boolean) => void
}

interface AbortAgentTerminalSessionOptions {
  taskId: string
  logPrefix: string
  setStatus?: (status: AgentPanelStatus) => void
}

export function getAgentStatusText(status: AgentPanelStatus, runningText: string): string {
  switch (status) {
    case 'idle': return 'No active implementation'
    case 'running': return runningText
    case 'complete': return 'Implementation complete'
    case 'error': return 'Error occurred'
  }
}

export function getAgentStageLabel(stage: string, stageLabels: AgentStageLabels): string {
  return stageLabels[stage] || stage
}

export function getAgentSessionStatusBadgeClass(sessionStatus: string, variant: AgentSessionStatusBadgeVariant): string {
  switch (sessionStatus) {
    case 'running': return variant === 'soft' ? 'bg-success/10 text-success' : 'badge-success'
    case 'completed': return 'badge-primary'
    case 'failed': return 'badge-error'
    case 'interrupted': return 'badge-ghost'
    case 'paused': return 'badge-warning'
    default: return 'badge-ghost'
  }
}

export function syncAgentPanelStatusFromSession({
  taskId,
  sessionStatus,
  setStatus,
  setTerminalActive,
}: SyncAgentPanelStatusOptions): AgentPanelStatus {
  const nextStatus = getAgentPanelStatusFromSessionStatus(sessionStatus)
  setStatus(nextStatus)
  if (setTerminalActive) {
    setTerminalActive(getShellLifecycleState(taskId).ptyActive)
  }
  return nextStatus
}

export function markAgentTerminalExited(taskId: string, currentPtyInstance: number | null): void {
  updateShellLifecycleState(taskId, {
    ptyActive: false,
    shellExited: true,
    currentPtyInstance,
  })
}

export function hydrateAgentTerminalPtyInstance(taskId: string, currentPtyInstance: number): void {
  updateShellLifecycleState(taskId, {
    ...getShellLifecycleState(taskId),
    ptyActive: true,
    shellExited: false,
    currentPtyInstance,
  })
}

export async function abortAgentTerminalSession({
  taskId,
  logPrefix,
  setStatus,
}: AbortAgentTerminalSessionOptions): Promise<void> {
  try {
    const lifecycle = getShellLifecycleState(taskId)
    if (lifecycle.ptyActive) {
      await killPty(taskId).catch(e => {
        console.error(`[${logPrefix}] Failed to kill PTY on abort:`, e)
      })
      markAgentTerminalExited(taskId, lifecycle.currentPtyInstance)
    }
    await abortImplementation(taskId)
    setStatus?.('error')
  } catch (e) {
    console.error(`[${logPrefix}] Failed to abort implementation:`, e)
  }
}

export async function writeAgentTerminalTranscription(taskId: string, text: string, logPrefix: string): Promise<void> {
  if (!getShellLifecycleState(taskId).ptyActive) return

  await writePty(taskId, text).catch(e => {
    console.error(`[${logPrefix}] transcription write failed:`, e)
  })
}
