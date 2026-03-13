import type { TaskState } from './taskState'
import type { BoardColumnConfig } from './types'
import { getProjectConfig, setProjectConfig } from './ipc'

const BOARD_COLUMNS_CONFIG_KEY = 'board_columns'

/** Configurable task states (doing-related only — egg and done are fixed). */
export const ALL_TASK_STATES: TaskState[] = [
  'idle',
  'active',
  'needs-input',
  'resting',
  'celebrating',
  'sad',
  'frozen',
  'pr-draft',
  'pr-open',
  'ci-running',
  'review-pending',
  'ci-failed',
  'changes-requested',
  'ready-to-merge',
  'pr-merged',
]

/** Fixed backlog column — not user-configurable. */
export const BACKLOG_COLUMN: BoardColumnConfig = {
  id: 'col-backlog',
  name: 'Backlog',
  statuses: ['egg'],
  underlyingStatus: 'backlog',
}

/** Fixed done column — not user-configurable. */
export const DONE_COLUMN: BoardColumnConfig = {
  id: 'col-done',
  name: 'Done',
  statuses: ['done'],
  underlyingStatus: 'done',
}

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  egg: 'New',
  idle: 'Idle',
  active: 'Running',
  'needs-input': 'Needs Input',
  resting: 'Paused',
  celebrating: 'Agent Done',
  sad: 'Failed',
  frozen: 'Interrupted',
  done: 'Done',
  'pr-draft': 'PR Draft',
  'pr-open': 'PR Open',
  'ci-running': 'CI Running',
  'review-pending': 'Awaiting Review',
  'ci-failed': 'CI Failed',
  'changes-requested': 'Changes Requested',
  'ready-to-merge': 'Ready to Merge',
  'pr-merged': 'PR Merged',
}

export const DEFAULT_BOARD_COLUMNS: BoardColumnConfig[] = [
  {
    id: 'col-doing',
    name: 'Doing',
    statuses: [
      'idle',
      'active',
      'needs-input',
      'resting',
      'celebrating',
      'sad',
      'frozen',
      'pr-draft',
      'pr-open',
      'ci-running',
      'review-pending',
      'ci-failed',
      'changes-requested',
      'ready-to-merge',
      'pr-merged',
    ],
    underlyingStatus: 'doing',
  },
]

export function validateBoardColumns(columns: BoardColumnConfig[]): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!Array.isArray(columns) || columns.length === 0) {
    errors.push('At least one board column is required.')
    return { valid: false, errors }
  }

  const stateCounts = new Map<TaskState, number>()

  for (const column of columns) {
    if (typeof column.name !== 'string' || column.name.trim().length === 0) {
      errors.push(`Column "${column.id}" must have a non-empty name.`)
    }

    for (const state of column.statuses) {
      if (!ALL_TASK_STATES.includes(state)) {
        errors.push(`Unknown task state: ${String(state)}.`)
        continue
      }

      stateCounts.set(state, (stateCounts.get(state) ?? 0) + 1)
    }
  }

  for (const state of ALL_TASK_STATES) {
    const count = stateCounts.get(state) ?? 0
    if (count === 0) {
      errors.push(`Task state "${state}" is missing from all columns.`)
    } else if (count > 1) {
      errors.push(`Task state "${state}" appears in multiple columns.`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function getColumnForTaskState(state: TaskState, columns: BoardColumnConfig[]): BoardColumnConfig {
  const match = columns.find((column) => column.statuses.includes(state))
  return match ?? columns[0] ?? DEFAULT_BOARD_COLUMNS[0]
}

function normalizeBoardColumns(columns: BoardColumnConfig[]): BoardColumnConfig[] {
  const normalized = columns.map((column) => ({
    ...column,
    statuses: [...column.statuses],
  }))

  const primaryDoingColumn = normalized.find((column) => column.underlyingStatus === 'doing')
  if (!primaryDoingColumn) {
    return normalized
  }

  for (const state of ALL_TASK_STATES) {
    const exists = normalized.some((column) => column.statuses.includes(state))
    if (!exists) {
      primaryDoingColumn.statuses.push(state)
    }
  }

  return normalized
}

function normalizeAndValidateBoardColumns(columns: BoardColumnConfig[]): {
  normalized: BoardColumnConfig[]
  validation: { valid: boolean; errors: string[] }
} {
  const normalized = normalizeBoardColumns(columns)

  return {
    normalized,
    validation: validateBoardColumns(normalized),
  }
}

export async function loadBoardColumns(projectId: string): Promise<BoardColumnConfig[]> {
  const stored = await getProjectConfig(projectId, BOARD_COLUMNS_CONFIG_KEY)

  if (!stored) {
    await saveBoardColumns(projectId, DEFAULT_BOARD_COLUMNS)
    return DEFAULT_BOARD_COLUMNS
  }

  try {
    const parsed = JSON.parse(stored)

    if (Array.isArray(parsed)) {
      const { normalized, validation } = normalizeAndValidateBoardColumns(parsed as BoardColumnConfig[])
      if (validation.valid) {
        return normalized
      }
    }
  } catch {
    await saveBoardColumns(projectId, DEFAULT_BOARD_COLUMNS)
    return DEFAULT_BOARD_COLUMNS
  }

  await saveBoardColumns(projectId, DEFAULT_BOARD_COLUMNS)
  return DEFAULT_BOARD_COLUMNS
}

export async function saveBoardColumns(projectId: string, columns: BoardColumnConfig[]): Promise<void> {
  const { normalized, validation } = normalizeAndValidateBoardColumns(columns)

  if (!validation.valid) {
    throw new Error(validation.errors.join(' '))
  }

  await setProjectConfig(projectId, BOARD_COLUMNS_CONFIG_KEY, JSON.stringify(normalized))
}
