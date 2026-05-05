export interface ProjectTerminalTab {
  key: string
}

export interface ProjectTerminalTabsSession {
  tabs: ProjectTerminalTab[]
}

export interface CleanupProjectTerminalTaskDeps {
  getTaskTerminalTabsSession(taskId: string): ProjectTerminalTabsSession
  killPty(taskId: string): Promise<void>
  releaseAllForTask(taskId: string): number
  clearTaskTerminalTabsSession(taskId: string): void
}

export interface ProjectTerminalKillFailure {
  key: string
  error: string
}

export interface ProjectTerminalCleanupResult {
  killed: number
  released: number
  killFailures: ProjectTerminalKillFailure[]
}

export function getProjectTerminalTaskId(projectId: string): string {
  return `project-${projectId}`
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function cleanupProjectTerminalTask(
  taskId: string,
  deps: CleanupProjectTerminalTaskDeps,
): Promise<ProjectTerminalCleanupResult> {
  const session = deps.getTaskTerminalTabsSession(taskId)
  const killFailures: ProjectTerminalKillFailure[] = []
  let killed = 0

  for (const tab of session.tabs) {
    try {
      await deps.killPty(tab.key)
      killed += 1
    } catch (error) {
      killFailures.push({ key: tab.key, error: normalizeError(error) })
    }
  }

  const released = deps.releaseAllForTask(taskId)
  deps.clearTaskTerminalTabsSession(taskId)

  return { killed, released, killFailures }
}
