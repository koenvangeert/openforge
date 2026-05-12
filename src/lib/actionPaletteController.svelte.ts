import { get } from 'svelte/store'
import { activeProjectId } from './stores'
import { getEnabledActions, loadActions } from './actions'
import type { Action, Task } from './types'
import type { RunActionData, TaskActionRunner } from './taskActionRunner'

interface ActionPaletteControllerOptions {
  getSelectedTask(): Task | null
  taskActions: TaskActionRunner
  goBack(): void
  showSearchTasks(): void
  showNewTask(): void
  showProjectSwitcher(): void
  triggerGithubSync(): Promise<void>
}

export function useActionPaletteController(options: ActionPaletteControllerOptions) {
  let showActionPalette = $state(false)
  let actionPaletteTask = $state<Task | null>(null)
  let actionPaletteActions = $state<Action[]>([])

  function closeActionPalette(): void {
    showActionPalette = false
    actionPaletteTask = null
  }

  async function openActionPalette(): Promise<void> {
    if (showActionPalette) {
      closeActionPalette()
      return
    }

    actionPaletteTask = options.getSelectedTask()

    const projectId = get(activeProjectId)
    if (projectId) {
      try {
        const all = await loadActions(projectId)
        actionPaletteActions = getEnabledActions(all)
      } catch {
        actionPaletteActions = []
      }
    } else {
      actionPaletteActions = []
    }

    showActionPalette = true
  }

  async function executeAction(actionId: string): Promise<void> {
    const task = actionPaletteTask
    closeActionPalette()

    switch (actionId) {
      case 'start-task':
        if (task) await options.taskActions.handleRunAction({ taskId: task.id, actionPrompt: '', agent: null })
        break
      case 'move-to-done':
        if (task) {
          await options.taskActions.moveTaskToDone(task.id)
        }
        break
      case 'delete-task':
        if (task) {
          await options.taskActions.deleteTaskAndReload(task.id)
        }
        break
      case 'merge-pr':
        if (task) {
          await options.taskActions.mergeReadyPullRequest(task)
        }
        break
      case 'go-back':
        options.goBack()
        break
      case 'search-tasks':
        options.showSearchTasks()
        break
      case 'new-task':
        options.showNewTask()
        break
      case 'switch-project':
        options.showProjectSwitcher()
        break
      case 'refresh-github':
        void options.triggerGithubSync()
        break
      default:
        if (actionId.startsWith('custom-action-') && task) {
          const realId = actionId.replace('custom-action-', '')
          const action = actionPaletteActions.find(a => a.id === realId)
          if (action) {
            const runActionData: RunActionData = { taskId: task.id, actionPrompt: action.prompt, agent: null }
            await options.taskActions.handleRunAction(runActionData)
          }
        }
        break
    }
  }

  return {
    get showActionPalette() {
      return showActionPalette
    },
    get actionPaletteTask() {
      return actionPaletteTask
    },
    get actionPaletteActions() {
      return actionPaletteActions
    },
    closeActionPalette,
    openActionPalette,
    executeAction,
  }
}

export type ActionPaletteController = ReturnType<typeof useActionPaletteController>
