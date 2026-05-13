import { describe, expect, it } from 'vitest'
import { getDependencyStatusPresentation } from './dependencyStatusPresentation'
import type { BoardStatus } from './types'

describe('getDependencyStatusPresentation', () => {
  it.each([
    ['done', 'done'],
    ['doing', 'doing'],
    ['backlog', 'backlog'],
    [null, 'unknown'],
  ] satisfies Array<[BoardStatus | null, string]>)('maps %s dependencies to their chip label', (status, label) => {
    expect(getDependencyStatusPresentation(status).label).toBe(label)
  })
})
