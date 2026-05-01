import { getAppShortcutHelpLabel, getPrimaryAppShortcutKey } from './appShortcutDefinitions'
import { isQueuedForMerge, isReadyToMerge } from './types'
import type { Action, PullRequestInfo, Task } from './types'

export interface PaletteAction {
  id: string
  label: string
  shortcut: string | null
  category: 'task' | 'navigation' | 'general'
  keywords: string[]
}

export function getTaskActions(task: Task, customActions: Action[], taskPrs: PullRequestInfo[] = []): PaletteAction[] {
  const actions: PaletteAction[] = []

  if (task.status === 'backlog') {
    actions.push({
      id: 'start-task',
      label: 'Start Task',
      shortcut: null,
      category: 'task',
      keywords: ['run', 'execute', 'begin', 'agent'],
    })
  }

  if (task.status === 'doing') {
    actions.push({
      id: 'move-to-done',
      label: 'Move to Done',
      shortcut: null,
      category: 'task',
      keywords: ['complete', 'finish', 'close', 'done'],
    })
  }

  const readyToMergePrs = taskPrs.filter(pr => isReadyToMerge(pr) && !isQueuedForMerge(pr))
  if (readyToMergePrs.length === 1) {
    actions.push({
      id: 'merge-pr',
      label: 'Merge Pull Request',
      shortcut: null,
      category: 'task',
      keywords: ['merge', 'pull request', 'pr', 'github'],
    })
  }

  actions.push({
    id: 'delete-task',
    label: 'Delete Task',
    shortcut: null,
    category: 'task',
    keywords: ['remove', 'trash'],
  })

  for (const action of customActions) {
    actions.push({
      id: `custom-action-${action.id}`,
      label: action.name,
      shortcut: null,
      category: 'task',
      keywords: ['custom', 'action'],
    })
  }

  return actions
}

interface GlobalActionDefinition {
  id: string
  category: PaletteAction['category']
  keywords: string[]
}

const GLOBAL_ACTION_DEFINITIONS: readonly GlobalActionDefinition[] = [
  { id: 'go-back', category: 'navigation', keywords: ['back', 'previous', 'navigate'] },
  { id: 'search-tasks', category: 'general', keywords: ['find', 'search', 'lookup'] },
  { id: 'new-task', category: 'general', keywords: ['create', 'add', 'task'] },
  { id: 'switch-project', category: 'navigation', keywords: ['project', 'switch', 'change'] },
  { id: 'refresh-github', category: 'general', keywords: ['sync', 'github', 'refresh', 'pull'] },
]

function getShortcutBackedGlobalAction(definition: GlobalActionDefinition): PaletteAction {
  const label = getAppShortcutHelpLabel(definition.id)
  if (!label) {
    throw new Error(`Missing app shortcut help label for global action ${definition.id}`)
  }

  return {
    id: definition.id,
    label,
    shortcut: getPrimaryAppShortcutKey(definition.id),
    category: definition.category,
    keywords: definition.keywords,
  }
}

export function getGlobalActions(): PaletteAction[] {
  return GLOBAL_ACTION_DEFINITIONS.map(getShortcutBackedGlobalAction)
}

export function getAvailableActions(task: Task | null, customActions: Action[], taskPrs: PullRequestInfo[] = []): PaletteAction[] {
  const taskActions = task ? getTaskActions(task, customActions, taskPrs) : []
  return [...taskActions, ...getGlobalActions()]
}

export function filterActions(actions: PaletteAction[], query: string): PaletteAction[] {
  const q = query.trim().toLowerCase()
  if (!q) return actions
  return actions.filter(a =>
    a.label.toLowerCase().includes(q) ||
    a.keywords.some(k => k.toLowerCase().includes(q))
  )
}
