import { describe, expect, it } from 'vitest'
import type { Task, TaskLabel } from './types'
import { getBacklogLabelCounts, getLabelsWithBacklogItems, pruneSelectedBacklogLabelIds, taskMatchesAnySelectedLabel, validateTaskLabelName } from './taskLabels'

const bug: TaskLabel = { id: 1, project_id: 'proj-1', name: 'Bug', color: 'error' }
const ui: TaskLabel = { id: 2, project_id: 'proj-1', name: 'UI', color: 'primary' }

function task(id: string, status: Task['status'], labels: TaskLabel[] = []): Task {
  return {
    id,
    initial_prompt: id,
    status,
    prompt: null,
    summary: null,
    agent: null,
    permission_mode: null,
    depends_on: [],
    project_id: 'proj-1',
    created_at: 1000,
    updated_at: 1000,
    labels,
  } as Task & { labels: TaskLabel[] }
}

describe('taskLabels', () => {
  it('matches selected labels with OR semantics', () => {
    const selected = new Set([bug.id, ui.id])

    expect(taskMatchesAnySelectedLabel(task('T-1', 'backlog', [bug]), selected)).toBe(true)
    expect(taskMatchesAnySelectedLabel(task('T-2', 'backlog', [ui]), selected)).toBe(true)
    expect(taskMatchesAnySelectedLabel(task('T-3', 'backlog'), selected)).toBe(false)
  })

  it('counts labels on backlog tasks only', () => {
    const counts = getBacklogLabelCounts([
      task('T-1', 'backlog', [bug]),
      task('T-2', 'backlog', [bug, ui]),
      task('T-3', 'doing', [bug]),
    ], [bug, ui])

    expect(counts.get(bug.id)).toBe(2)
    expect(counts.get(ui.id)).toBe(1)
  })

  it('returns only labels with at least one backlog task', () => {
    const counts = getBacklogLabelCounts([
      task('T-1', 'backlog', [ui]),
      task('T-2', 'doing', [bug]),
    ], [bug, ui])

    expect(getLabelsWithBacklogItems([bug, ui], counts)).toEqual([ui])
  })

  it('prunes selected backlog label filters that no longer have visible chips', () => {
    expect(pruneSelectedBacklogLabelIds(new Set([bug.id, ui.id]), [ui])).toEqual(new Set([ui.id]))
  })

  it('validates trimmed non-empty label names up to forty characters', () => {
    expect(validateTaskLabelName('  needs design  ')).toBeNull()
    expect(validateTaskLabelName('   ')).toBe('Label name is required')
    expect(validateTaskLabelName('x'.repeat(41))).toBe('Label names must be 40 characters or fewer')
  })
})
