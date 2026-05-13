import type { BoardStatus } from './types'

export interface DependencyStatusPresentation {
  label: string
  badgeClass: string
}

export function getDependencyStatusPresentation(status: BoardStatus | null): DependencyStatusPresentation {
  if (status === 'done') return { label: status, badgeClass: 'badge-success' }
  if (status === 'doing') return { label: status, badgeClass: 'badge-warning' }
  if (status === 'backlog') return { label: status, badgeClass: 'badge-ghost' }
  return { label: status ?? 'unknown', badgeClass: 'badge-neutral' }
}
