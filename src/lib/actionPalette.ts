import type { Task, Action } from './types'

export interface PaletteAction {
  id: string
  label: string
  shortcut: string | null
  category: 'task' | 'navigation' | 'general'
  keywords: string[]
}

export function getTaskActions(task: Task, customActions: Action[]): PaletteAction[] {
  const actions: PaletteAction[] = []

  if (task.status !== 'done') {
    actions.push({
      id: 'start-task',
      label: 'Start Task',
      shortcut: null,
      category: 'task',
      keywords: ['run', 'execute', 'begin', 'agent'],
    })
  }

  if (task.status !== 'done') {
    actions.push({
      id: 'move-to-done',
      label: 'Move to Done',
      shortcut: null,
      category: 'task',
      keywords: ['complete', 'finish', 'close', 'done'],
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

export function getGlobalActions(): PaletteAction[] {
  return [
    {
      id: 'go-back',
      label: 'Go Back',
      shortcut: '⌘[',
      category: 'navigation',
      keywords: ['back', 'previous', 'navigate'],
    },
    {
      id: 'search-tasks',
      label: 'Search Tasks',
      shortcut: '⌘⇧F',
      category: 'general',
      keywords: ['find', 'search', 'lookup'],
    },
    {
      id: 'new-task',
      label: 'New Task',
      shortcut: '⌘T',
      category: 'general',
      keywords: ['create', 'add', 'task'],
    },
    {
      id: 'switch-project',
      label: 'Switch Project',
      shortcut: '⌘P',
      category: 'navigation',
      keywords: ['project', 'switch', 'change'],
    },
    {
      id: 'open-workqueue',
      label: 'Work Queue',
      shortcut: '⌘R',
      category: 'navigation',
      keywords: ['queue', 'work', 'workqueue'],
    },
    {
      id: 'refresh-github',
      label: 'Refresh GitHub',
      shortcut: '⌘⇧R',
      category: 'general',
      keywords: ['sync', 'github', 'refresh', 'pull'],
    },
  ]
}

export function getAvailableActions(task: Task | null, customActions: Action[]): PaletteAction[] {
  const taskActions = task ? getTaskActions(task, customActions) : []
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
