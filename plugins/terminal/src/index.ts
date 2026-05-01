import type { PluginActivationResult, PluginContext } from '@openforge/plugin-sdk'
import TerminalTaskPane from './TerminalTaskPane.svelte'
import TerminalProjectView from './TerminalProjectView.svelte'
import { killPty } from './lib/ipc'
import { cleanupProjectTerminalTask, getProjectTerminalTaskId, releaseInactiveProjectTerminalTask } from './lib/projectTerminal'
import { clearTaskTerminalTabsSession, getTaskTerminalTabsSession, releaseAllForTask } from './lib/terminalPool'

function cleanupTerminalTask(taskId: string) {
  void cleanupProjectTerminalTask(taskId, {
    getTaskTerminalTabsSession,
    killPty,
    releaseAllForTask,
    clearTaskTerminalTabsSession,
  }).then((result) => {
    for (const failure of result.killFailures) {
      console.error(`[terminal plugin] Failed to kill project terminal ${failure.key}:`, failure.error)
    }
  })
}

function getNavigationProjectId(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null

  const activeProjectId = (payload as { activeProjectId?: unknown }).activeProjectId
  return typeof activeProjectId === 'string' ? activeProjectId : null
}

function cleanupInactiveProjectTerminal(projectId: string | null): void {
  const activeTaskId = projectId ? getProjectTerminalTaskId(projectId) : null
  const taskIdToCleanup = releaseInactiveProjectTerminalTask(activeTaskId)

  if (taskIdToCleanup !== null) {
    cleanupTerminalTask(taskIdToCleanup)
  }
}

let stopProjectNavigationTracking: (() => void) | null = null

export async function activate(context: PluginContext): Promise<PluginActivationResult> {
  return {
    contributions: {
      views: [
        {
          id: 'terminal',
          component: TerminalProjectView,
        },
      ],
      taskPaneTabs: [
        {
          id: 'terminal',
          component: TerminalTaskPane,
        },
      ],
      backgroundServices: [
        {
          id: 'pty-manager',
          start: async () => {
            stopProjectNavigationTracking?.()

            const navigation = await context.invokeHost('getNavigation')
            cleanupInactiveProjectTerminal(getNavigationProjectId(navigation))

            stopProjectNavigationTracking = context.onEvent('navigation-changed', (payload) => {
              cleanupInactiveProjectTerminal(getNavigationProjectId(payload))
            })
          },
          stop: async () => {
            stopProjectNavigationTracking?.()
            stopProjectNavigationTracking = null
          },
        },
      ],
    }
  }
}

export async function deactivate(): Promise<void> {}
