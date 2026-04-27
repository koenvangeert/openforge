import type { BoardStatus, Task } from './types'

export const BOARD_STATUSES = ['backlog', 'doing', 'done'] as const satisfies readonly BoardStatus[]

const BOARD_STATUS_ALIASES: Record<string, BoardStatus> = {
  backlog: 'backlog',
  todo: 'backlog',
  doing: 'doing',
  in_progress: 'doing',
  in_review: 'doing',
  testing: 'doing',
  done: 'done',
}

export function normalizeBoardStatus(status: string): BoardStatus | null {
  const normalized = status.trim().toLowerCase()
  return BOARD_STATUS_ALIASES[normalized] ?? null
}

export function parseBoardStatus(status: string): BoardStatus {
  const normalized = normalizeBoardStatus(status)
  if (normalized === null) {
    throw new Error(`Invalid board status: ${status}`)
  }
  return normalized
}

type RawTask = Omit<Task, 'status'> & { status: string }

export function normalizeTask(task: RawTask): Task {
  return {
    ...task,
    status: parseBoardStatus(task.status),
  }
}
