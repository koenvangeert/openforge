import { listen } from '@tauri-apps/api/event'
import type { UnlistenFn } from '@tauri-apps/api/event'
import type { PtyEvent } from './types'
import { getWorktreeForTask, spawnPty, writePty, killPty as killPtyIpc } from './ipc'

export interface PtyBridgeHandle {
  readonly ptySpawned: boolean
  attachPty(sessionId: string): Promise<void>
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
  let ptyOutputUnlisten: UnlistenFn | null = null
  let ptyExitUnlisten: UnlistenFn | null = null

  async function setupListeners(): Promise<void> {
    // Clean up old listeners before registering new ones (prevents listener leak)
    if (ptyOutputUnlisten) { ptyOutputUnlisten(); ptyOutputUnlisten = null }
    if (ptyExitUnlisten) { ptyExitUnlisten(); ptyExitUnlisten = null }

    ptyOutputUnlisten = await listen<PtyEvent>(`pty-output-${deps.taskId}`, (event) => {
      const term = deps.getTerminal()
      if (term && event.payload.data) {
        term.write(event.payload.data)
      }
    })

    ptyExitUnlisten = await listen<PtyEvent>(`pty-exit-${deps.taskId}`, (event) => {
      const exitInstance = event.payload?.instance_id
      if (exitInstance != null && exitInstance !== expectedPtyInstance) {
        console.warn(`[usePtyBridge] Ignoring stale pty-exit (instance ${exitInstance}, expected ${expectedPtyInstance})`)
        return
      }
      ptySpawned = false
      expectedPtyInstance = null
    })
  }

  async function attachPty(sessionId: string): Promise<void> {
    if (ptySpawned) return

    ptySpawned = true  // Set synchronously before any await to prevent duplicate calls

    try {
      const worktree = await getWorktreeForTask(deps.taskId)
      const port = worktree?.opencode_port
      if (!port) {
        console.error('[usePtyBridge] No opencode_port found for task:', deps.taskId)
        ptySpawned = false
        return
      }
      deps.setOpencodePort(port)

      await setupListeners()
      const term = deps.getTerminal()
      const cols = term?.cols ?? 80
      const rows = term?.rows ?? 24
      expectedPtyInstance = await spawnPty(deps.taskId, port, sessionId, cols, rows)
      term?.focus()

      deps.onAttached()
    } catch (e) {
      console.error('[usePtyBridge] Failed to attach PTY:', e)
      ptySpawned = false
    }
  }

  function writeToPty(data: string): void {
    writePty(deps.taskId, data).catch((e) => {
      console.error('[usePtyBridge] Failed to write to PTY:', e)
    })
  }

  async function killPty(): Promise<void> {
    await killPtyIpc(deps.taskId)
    ptySpawned = false
  }

  function dispose(): void {
    if (ptyOutputUnlisten) { ptyOutputUnlisten(); ptyOutputUnlisten = null }
    if (ptyExitUnlisten) { ptyExitUnlisten(); ptyExitUnlisten = null }
  }

  return {
    get ptySpawned() { return ptySpawned },
    attachPty,
    writeToPty,
    killPty,
    dispose,
  }
}
