import { listenDesktopEvent, type DesktopUnlistenFn } from './desktopIpc'
import { getTaskWorkspace, killPty as killPtyIpc, spawnPty, writePty } from './ipc'
import type { PtyEvent } from './types'

export interface AttachPtyContext {
  provider?: string
  opencodeSessionId?: string | null
}

export interface PtyBridgeHandle {
  readonly ptySpawned: boolean
  attachPty(context: AttachPtyContext): Promise<void>
  writeToPty(data: string): void
  killPty(): Promise<void>
  dispose(): void
}

export function createPtyBridge(deps: {
  taskId: string
  getTerminal: () => { cols: number; rows: number; write: (data: string) => void; focus: () => void } | null
  setOpencodePort: (port: number) => void
  onAttached: (sessionStatus?: string) => void
}): PtyBridgeHandle {
  let ptySpawned = false
  let expectedPtyInstance: number | null = null
  let awaitingSpawnInstance = false
  const pendingExitInstances = new Set<number>()
  let ptyOutputUnlisten: DesktopUnlistenFn | null = null
  let ptyExitUnlisten: DesktopUnlistenFn | null = null

  function markExited(): void {
    ptySpawned = false
    expectedPtyInstance = null
    awaitingSpawnInstance = false
    pendingExitInstances.clear()
  }

  async function setupListeners(): Promise<void> {
    // Clean up old listeners before registering new ones (prevents listener leak)
    if (ptyOutputUnlisten) { ptyOutputUnlisten(); ptyOutputUnlisten = null }
    if (ptyExitUnlisten) { ptyExitUnlisten(); ptyExitUnlisten = null }

    ptyOutputUnlisten = await listenDesktopEvent<PtyEvent>(`pty-output-${deps.taskId}`, (event) => {
      const term = deps.getTerminal()
      if (term && event.payload.data) {
        term.write(event.payload.data)
      }
    })

    ptyExitUnlisten = await listenDesktopEvent<PtyEvent>(`pty-exit-${deps.taskId}`, (event) => {
      const exitInstance = event.payload?.instance_id
      if (exitInstance == null) {
        console.warn('[usePtyBridge] Ignoring pty-exit without instance_id')
        return
      }
      if (expectedPtyInstance == null) {
        if (ptySpawned && awaitingSpawnInstance) {
          pendingExitInstances.add(exitInstance)
        }
        return
      }
      if (exitInstance !== expectedPtyInstance) {
        console.warn(`[usePtyBridge] Ignoring stale pty-exit (instance ${exitInstance}, expected ${expectedPtyInstance})`)
        return
      }
      markExited()
    })
  }

  async function attachPty(context: AttachPtyContext): Promise<void> {
    if (ptySpawned) return
    ptySpawned = true
    awaitingSpawnInstance = true

    try {
      await setupListeners()
      const term = deps.getTerminal()
      const cols = term?.cols ?? 80
      const rows = term?.rows ?? 24

      // OpenCode path: existing logic unchanged
      const workspace = await getTaskWorkspace(deps.taskId)
      const port = workspace?.opencode_port
      if (!port) {
        console.error('[usePtyBridge] No opencode_port found for task:', deps.taskId)
        ptySpawned = false
        awaitingSpawnInstance = false
        return
      }
      deps.setOpencodePort(port)
      const sessionId = context.opencodeSessionId
      if (!sessionId) {
        console.error('[usePtyBridge] Missing opencodeSessionId for OpenCode PTY')
        ptySpawned = false
        awaitingSpawnInstance = false
        return
      }
      const spawnedInstance = await spawnPty(deps.taskId, port, sessionId, cols, rows)
      awaitingSpawnInstance = false
      expectedPtyInstance = spawnedInstance

      if (pendingExitInstances.has(spawnedInstance)) {
        markExited()
      } else {
        pendingExitInstances.clear()
      }

      if (!ptySpawned || expectedPtyInstance !== spawnedInstance) {
        return
      }

      term?.focus()
      deps.onAttached()
    } catch (e) {
      console.error('[usePtyBridge] Failed to attach PTY:', e)
      ptySpawned = false
      expectedPtyInstance = null
      awaitingSpawnInstance = false
      pendingExitInstances.clear()
    }
  }

  function writeToPty(data: string): void {
    writePty(deps.taskId, data).catch((e) => {
      console.error('[usePtyBridge] Failed to write to PTY:', e)
    })
  }

  async function killPty(): Promise<void> {
    await killPtyIpc(deps.taskId)
    markExited()
  }

  function dispose(): void {
    if (ptyOutputUnlisten) { ptyOutputUnlisten(); ptyOutputUnlisten = null }
    if (ptyExitUnlisten) { ptyExitUnlisten(); ptyExitUnlisten = null }
    pendingExitInstances.clear()
  }

  return {
    get ptySpawned() { return ptySpawned },
    attachPty,
    writeToPty,
    killPty,
    dispose,
  }
}
