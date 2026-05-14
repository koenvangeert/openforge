import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import { activeProjectId, backlogLabelFilters } from './stores'

describe('backlogLabelFilters', () => {
  it('keeps label filters during a project session and clears them when the active project changes', () => {
    activeProjectId.set(null)
    backlogLabelFilters.set(new Map())

    activeProjectId.set('project-a')
    backlogLabelFilters.set(new Map([['project-a', new Set([1, 2])]]))

    expect(get(backlogLabelFilters).get('project-a')).toEqual(new Set([1, 2]))

    activeProjectId.set('project-b')

    expect(get(backlogLabelFilters).size).toBe(0)
  })
})
