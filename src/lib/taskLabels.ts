import type { Task, TaskLabel } from './types'

export const MAX_TASK_LABEL_NAME_LENGTH = 40

const LABEL_COLORS = ['primary', 'secondary', 'accent', 'info', 'success', 'warning', 'error'] as const

export function normalizeTaskLabelNameInput(name: string): string {
  return name.trim()
}

export function validateTaskLabelName(name: string): string | null {
  const normalized = normalizeTaskLabelNameInput(name)
  if (!normalized) return 'Label name is required'
  if ([...normalized].length > MAX_TASK_LABEL_NAME_LENGTH) {
    return `Label names must be ${MAX_TASK_LABEL_NAME_LENGTH} characters or fewer`
  }
  return null
}

export function normalizeTaskLabelKey(name: string): string {
  return normalizeTaskLabelNameInput(name).toLocaleLowerCase()
}

export function labelColorForName(name: string): TaskLabel['color'] {
  const key = normalizeTaskLabelKey(name)
  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0
  }
  return LABEL_COLORS[hash % LABEL_COLORS.length]
}

export function makeTemporaryTaskLabel(name: string, projectId: string): TaskLabel {
  const normalized = normalizeTaskLabelNameInput(name)
  return {
    id: -Math.max(1, Math.abs(hashLabelId(projectId, normalized))),
    project_id: projectId,
    name: normalized,
    color: labelColorForName(normalized),
  }
}

function hashLabelId(projectId: string, name: string): number {
  const input = `${projectId}:${normalizeTaskLabelKey(name)}`
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33 + input.charCodeAt(index)) | 0
  }
  return hash
}

export function getTaskLabels(task: Task): TaskLabel[] {
  const labels = (task as Task & { labels?: unknown }).labels
  return Array.isArray(labels) ? (labels as TaskLabel[]) : []
}

export function hasLabelNamed(labels: TaskLabel[], name: string): boolean {
  const key = normalizeTaskLabelKey(name)
  return labels.some((label) => normalizeTaskLabelKey(label.name) === key)
}

export function taskMatchesAnySelectedLabel(task: Task, selectedLabelIds: Set<number>): boolean {
  if (selectedLabelIds.size === 0) return true
  return getTaskLabels(task).some((label) => selectedLabelIds.has(label.id))
}

export function getBacklogLabelCounts(tasks: Task[], labels: TaskLabel[]): Map<number, number> {
  const counts = new Map(labels.map((label) => [label.id, 0]))
  for (const task of tasks) {
    if (task.status !== 'backlog') continue
    for (const label of getTaskLabels(task)) {
      counts.set(label.id, (counts.get(label.id) ?? 0) + 1)
    }
  }
  return counts
}

export function getLabelsWithBacklogItems(labels: TaskLabel[], counts: Map<number, number>): TaskLabel[] {
  return labels.filter((label) => (counts.get(label.id) ?? 0) > 0)
}

export function pruneSelectedBacklogLabelIds(selectedLabelIds: Set<number>, visibleLabels: TaskLabel[]): Set<number> {
  const visibleLabelIds = new Set(visibleLabels.map((label) => label.id))
  return new Set([...selectedLabelIds].filter((labelId) => visibleLabelIds.has(labelId)))
}
