import { get } from 'svelte/store'
import type { Task, AgentSession, Project } from './types'
import { pendingTask, activeProjectId, currentView, selectedTaskId } from './stores'
import { pushNavState } from './router.svelte'

export function matchesSearch(task: Task, query: string, projectMap?: Map<string, Project>): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const projectName = task.project_id ? projectMap?.get(task.project_id)?.name : undefined
  return (
    task.id.toLowerCase().includes(q) ||
    task.initial_prompt.toLowerCase().includes(q) ||
    (task.jira_key?.toLowerCase().includes(q) ?? false) ||
    (task.jira_title?.toLowerCase().includes(q) ?? false) ||
    (task.jira_assignee?.toLowerCase().includes(q) ?? false) ||
    (projectName?.toLowerCase().includes(q) ?? false)
  )
}

export function filterActiveTasks(tasks: Task[]): Task[] {
  return tasks.filter(t => t.status !== 'done')
}

function getTaskSortPriority(task: Task, sessionStatus: string | null): number {
  if (sessionStatus === 'paused' || sessionStatus === 'interrupted') return 0
  if (task.status === 'doing') return 1
  if (task.status === 'backlog') return 2
  return 3
}

export function sortTasks(taskList: Task[], sessions: Map<string, AgentSession>): Task[] {
  return [...taskList].sort((a, b) => {
    const sessionA = sessions.get(a.id)
    const sessionB = sessions.get(b.id)
    const priorityA = getTaskSortPriority(a, sessionA?.status ?? null)
    const priorityB = getTaskSortPriority(b, sessionB?.status ?? null)
    if (priorityA !== priorityB) return priorityA - priorityB
    return b.updated_at - a.updated_at
  })
}

export function navigateToTask(task: Task): void {
  pushNavState()
  const currentProjectId = get(activeProjectId)
  if (task.project_id && task.project_id !== currentProjectId) {
    activeProjectId.set(task.project_id)
    pendingTask.set(task)
  }
  currentView.set('board')
  selectedTaskId.set(task.id)
}
