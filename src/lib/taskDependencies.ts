import { getTaskTitle } from './taskTitle'
import type { BoardStatus, Task } from './types'

export interface TaskDependencySummary {
  id: string
  status: BoardStatus | null
  title: string
  displayTitle: string | null
  tooltipTitle: string
}

export function getTaskDependencySummaries(task: Task, allTasks: Task[]): TaskDependencySummary[] {
  const tasksById = new Map(allTasks.map((knownTask) => [knownTask.id, knownTask]))
  return task.depends_on.map((dependencyId) => {
    const dependencyTask = tasksById.get(dependencyId)
    const displayTitle = dependencyTask ? getTaskTitle(dependencyTask) : null
    return {
      id: dependencyId,
      status: dependencyTask?.status ?? null,
      title: displayTitle ?? dependencyId,
      displayTitle,
      tooltipTitle: displayTitle ?? dependencyId,
    }
  })
}

export function getWaitingDependencyCount(task: Task, allTasks: Task[]): number {
  return getTaskDependencySummaries(task, allTasks).filter((dependency) => dependency.status !== 'done').length
}

export function getDependencyWaitLabel(task: Task, allTasks: Task[]): string | null {
  const waitingCount = getWaitingDependencyCount(task, allTasks)
  if (waitingCount === 0) return null
  return `Waiting on ${waitingCount} ${waitingCount === 1 ? 'dep' : 'deps'}`
}
