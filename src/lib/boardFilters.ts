import type { Task, AgentSession, PullRequestInfo } from './types'
import type { TaskState } from './taskState'
import { computeTaskState } from './taskState'
import { ALL_TASK_STATES } from './boardColumns'
import { getProjectConfig, setProjectConfig } from './ipc'

export type BoardFilter = 'focus' | 'in-progress' | 'backlog'

export const DEFAULT_FOCUS_STATES: TaskState[] = [
  'idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted',
  'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments',
  'ready-to-merge', 'pr-merged',
]

const FOCUS_FILTER_CONFIG_KEY = 'focus_filter_states'

export function isFocusTask(_task: Task, state: TaskState, prs: PullRequestInfo[], focusStates: TaskState[] = DEFAULT_FOCUS_STATES): boolean {
  if (state === 'done') {
    return false
  }

  if (focusStates.includes(state)) {
    return true
  }

  return prs.some(pr => pr.unaddressed_comment_count > 0)
}

export function filterTasks(
  tasks: Task[],
  filter: BoardFilter,
  sessions: Map<string, AgentSession>,
  prs: Map<string, PullRequestInfo[]>,
  focusStates: TaskState[] = DEFAULT_FOCUS_STATES
): Task[] {
  if (filter === 'focus') {
    return tasks.filter(task => {
      const session = sessions.get(task.id) ?? null
      const taskPrs = prs.get(task.id) ?? []
      const state = computeTaskState(task, session, taskPrs)
      return isFocusTask(task, state, taskPrs, focusStates)
    })
  }

  if (filter === 'in-progress') {
    return tasks.filter(task => {
      if (task.status === 'done' || task.status === 'backlog') return false
      const session = sessions.get(task.id) ?? null
      const taskPrs = prs.get(task.id) ?? []
      const state = computeTaskState(task, session, taskPrs)
      return !isFocusTask(task, state, taskPrs, focusStates)
    })
  }

  if (filter === 'backlog') {
    return tasks.filter(task => task.status === 'backlog')
  }

  return []
}

export function getFilterCounts(
  tasks: Task[],
  sessions: Map<string, AgentSession>,
  prs: Map<string, PullRequestInfo[]>,
  focusStates: TaskState[] = DEFAULT_FOCUS_STATES
): Record<BoardFilter, number> {
  const counts: Record<BoardFilter, number> = {
    focus: 0,
    'in-progress': 0,
    backlog: 0,
  }

  for (const task of tasks) {
    if (task.status === 'backlog') {
      counts.backlog++
      continue
    }
    if (task.status === 'done') {
      continue
    }
    // task is doing — check if it's a focus task
    const session = sessions.get(task.id) ?? null
    const taskPrs = prs.get(task.id) ?? []
    const state = computeTaskState(task, session, taskPrs)
    if (isFocusTask(task, state, taskPrs, focusStates)) {
      counts.focus++
    } else {
      counts['in-progress']++
    }
  }

  return counts
}

export async function loadFocusFilterStates(projectId: string): Promise<TaskState[]> {
  const stored = await getProjectConfig(projectId, FOCUS_FILTER_CONFIG_KEY)
  if (!stored) return DEFAULT_FOCUS_STATES
  try {
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed) && parsed.every((s: string) => ALL_TASK_STATES.includes(s as TaskState))) {
      return parsed as TaskState[]
    }
  } catch { /* ignore */ }
  return DEFAULT_FOCUS_STATES
}

export async function saveFocusFilterStates(projectId: string, states: TaskState[]): Promise<void> {
  await setProjectConfig(projectId, FOCUS_FILTER_CONFIG_KEY, JSON.stringify(states))
}
