import { get } from 'svelte/store'
import {
  activeSessions,
  error,
  startingTasks,
  taskRuntimeInfo,
  ticketPrs,
  setTaskMerging,
} from './stores'
import {
  deleteTask,
  getSessionStatus,
  mergePullRequest,
  startImplementation,
} from './ipc'
import { writePtyWithSubmit } from './ptySubmit'
import { focusTerminal, isPtyActive } from './terminalPool'
import { moveTaskToComplete } from './moveToComplete'
import { isQueuedForMerge, isReadyToMerge } from './types'
import type { Project, Task } from './types'

export interface RunActionData {
  taskId: string
  actionPrompt: string
  agent: string | null
}

interface TaskActionRunnerOptions {
  getActiveProject(): Project | null
  loadTasks(): Promise<void>
  triggerGithubSync(): Promise<void>
  logError?: (message: string, error: unknown) => void
}

function defaultLogError(message: string, errorValue: unknown): void {
  console.error(message, errorValue)
}

function setError(errorValue: unknown): void {
  error.set(String(errorValue))
}

export function createTaskActionRunner(options: TaskActionRunnerOptions) {
  const logError = options.logError ?? defaultLogError

  async function handleRunAction(data: RunActionData): Promise<void> {
    const activeProject = options.getActiveProject()
    if (!activeProject) {
      error.set('No active project selected')
      return
    }

    const { taskId, actionPrompt } = data

    if (isPtyActive(taskId)) {
      try {
        await writePtyWithSubmit(taskId, actionPrompt)
        focusTerminal(taskId)
      } catch (e) {
        logError('[session] Failed to write action to PTY:', e)
        setError(e)
      }
      return
    }

    const starting = new Set(get(startingTasks))
    starting.add(taskId)
    startingTasks.set(starting)

    try {
      const result = await startImplementation(taskId, activeProject.path)

      const updatedRuntimeInfo = new Map(get(taskRuntimeInfo))
      updatedRuntimeInfo.set(taskId, {
        workspacePath: result.workspace_path,
      })
      taskRuntimeInfo.set(updatedRuntimeInfo)

      try {
        const session = await getSessionStatus(result.session_id)
        const updated = new Map(get(activeSessions))
        updated.set(taskId, session)
        activeSessions.set(updated)
      } catch (sessionErr) {
        logError('[session] Failed to fetch session after start:', sessionErr)
      }

      await options.loadTasks()
      focusTerminal(taskId)
    } catch (e) {
      logError('[session] Failed to start task:', e)
      setError(e)
    } finally {
      const next = new Set(get(startingTasks))
      next.delete(taskId)
      startingTasks.set(next)
    }
  }

  async function moveTaskToDone(taskId: string): Promise<void> {
    await moveTaskToComplete(taskId)
  }

  async function deleteTaskAndReload(taskId: string): Promise<void> {
    await deleteTask(taskId)
    await options.loadTasks()
  }

  async function mergeReadyPullRequest(task: Task): Promise<void> {
    const prs = get(ticketPrs).get(task.id) || []
    const readyPrs = prs.filter(candidate => isReadyToMerge(candidate) && !isQueuedForMerge(candidate))

    if (readyPrs.length === 1) {
      const pr = readyPrs[0]
      try {
        setTaskMerging(task.id, true)
        await mergePullRequest(pr.repo_owner, pr.repo_name, pr.id)
        const nextMap = new Map(get(ticketPrs))
        const taskPrs = nextMap.get(task.id) || []
        nextMap.set(task.id, taskPrs.map(p =>
          p.id === pr.id ? { ...p, state: 'merged', merged_at: Math.floor(Date.now() / 1000) } : p,
        ))
        ticketPrs.set(nextMap)
        await options.triggerGithubSync()
      } catch (e) {
        logError('Failed to merge PR:', e)
        setError(e)
      } finally {
        setTaskMerging(task.id, false)
      }
    } else if (readyPrs.length > 1) {
      error.set('Multiple pull requests are ready to merge. Open the task details to choose the correct PR.')
    }
  }

  return {
    handleRunAction,
    moveTaskToDone,
    deleteTaskAndReload,
    mergeReadyPullRequest,
  }
}

export type TaskActionRunner = ReturnType<typeof createTaskActionRunner>
