import { getTaskTitle } from './taskTitle'
import type { BoardStatus, Task } from './types'

export interface TaskDependencySummary {
  id: string
  status: BoardStatus | null
  title: string
  displayTitle: string | null
  tooltipTitle: string
}

export interface TaskDependentSummary extends TaskDependencySummary {
  remainingDependencyCountAfterCurrentDone: number
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

export function getTaskDependentSummaries(task: Task, allTasks: Task[]): TaskDependentSummary[] {
  const tasksById = new Map(allTasks.map((knownTask) => [knownTask.id, knownTask]))

  return allTasks
    .filter((knownTask) => knownTask.id !== task.id && knownTask.depends_on.includes(task.id))
    .map((dependentTask) => {
      const displayTitle = getTaskTitle(dependentTask)
      const remainingDependencyCountAfterCurrentDone = dependentTask.depends_on
        .filter((dependencyId) => dependencyId !== task.id)
        .filter((dependencyId) => tasksById.get(dependencyId)?.status !== 'done')
        .length

      return {
        id: dependentTask.id,
        status: dependentTask.status,
        title: displayTitle,
        displayTitle,
        tooltipTitle: displayTitle,
        remainingDependencyCountAfterCurrentDone,
      }
    })
}

export function getWaitingDependencyCount(task: Task, allTasks: Task[]): number {
  return getTaskDependencySummaries(task, allTasks).filter((dependency) => dependency.status !== 'done').length
}

export function getDependentReadinessLabel(dependent: TaskDependentSummary, longForm = false): string {
  const dependencyLabel = longForm ? 'dependency' : 'dep'
  if (dependent.remainingDependencyCountAfterCurrentDone === 0) return 'ready after this'
  return `still waits on ${dependent.remainingDependencyCountAfterCurrentDone} ${dependencyLabel}${dependent.remainingDependencyCountAfterCurrentDone === 1 ? '' : 's'}`
}

export function getDependencyWaitLabel(task: Task, allTasks: Task[]): string | null {
  const waitingCount = getWaitingDependencyCount(task, allTasks)
  if (waitingCount === 0) return null
  return `Waiting on ${waitingCount} ${waitingCount === 1 ? 'dep' : 'deps'}`
}
