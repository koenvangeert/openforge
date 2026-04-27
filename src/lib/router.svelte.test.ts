import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { activeProjectId, currentView, selectedReviewPr, selectedSkillIdentity, selectedTaskId } from './stores'
import { pushNavState, resetToBoard, useAppRouter } from './router.svelte'

describe('useAppRouter', () => {
  beforeEach(() => {
    const router = useAppRouter()
    currentView.set('board')
    selectedTaskId.set(null)
    selectedReviewPr.set(null)
    selectedSkillIdentity.set(null)
    activeProjectId.set(null)

    while (router.back()) {
    }

    currentView.set('board')
    selectedTaskId.set(null)
    selectedReviewPr.set(null)
    selectedSkillIdentity.set(null)
    activeProjectId.set(null)
  })

  it('navigate(plugin PR review view) clears selectedTaskId synchronously', () => {
    const router = useAppRouter()
    selectedTaskId.set('task-1')

    router.navigate('plugin:com.openforge.github-sync:pr_review')

    expect(get(selectedTaskId)).toBeNull()
    expect(get(currentView)).toBe('plugin:com.openforge.github-sync:pr_review')
  })

  it('navigate(settings) clears selectedTaskId synchronously', () => {
    const router = useAppRouter()
    selectedTaskId.set('task-1')

    router.navigate('settings')

    expect(get(selectedTaskId)).toBeNull()
    expect(get(currentView)).toBe('settings')
  })

  it('back returns false when history is empty', () => {
    const router = useAppRouter()

    expect(router.back()).toBe(false)
  })

  it('back returns true with history and restores previous state', () => {
    const router = useAppRouter()
    selectedTaskId.set('task-1')

    router.navigate('settings')

    expect(get(currentView)).toBe('settings')
    expect(get(selectedTaskId)).toBeNull()

    expect(router.back()).toBe(true)
    expect(get(currentView)).toBe('board')
    expect(get(selectedTaskId)).toBe('task-1')
  })

  it('resetToBoard does not change activeProjectId', () => {
    const router = useAppRouter()
    activeProjectId.set('proj-1')
    currentView.set('settings')
    selectedTaskId.set('task-1')

    router.resetToBoard()

    expect(get(activeProjectId)).toBe('proj-1')
    expect(get(currentView)).toBe('board')
    expect(get(selectedTaskId)).toBeNull()
  })

  it('resetToBoard sets currentView to board and clears selectedTaskId', () => {
    currentView.set('settings')
    selectedTaskId.set('task-1')

    resetToBoard()

    expect(get(currentView)).toBe('board')
    expect(get(selectedTaskId)).toBeNull()
  })

  it('navigateToTask sets selectedTaskId', () => {
    const router = useAppRouter()

    router.navigateToTask('task-42')

    expect(get(selectedTaskId)).toBe('task-42')
  })

  it('pushNavState captures activeProjectId and back restores it', () => {
    const router = useAppRouter()
    activeProjectId.set('proj-1')
    pushNavState()

    activeProjectId.set('proj-2')
    currentView.set('settings')

    expect(router.back()).toBe(true)
    expect(get(activeProjectId)).toBe('proj-1')
    expect(get(currentView)).toBe('board')
  })

  it('back restores activeProjectId to different previous values', () => {
    const router = useAppRouter()
    activeProjectId.set('proj-A')
    currentView.set('board')
    pushNavState()

    activeProjectId.set('proj-B')
    currentView.set('global_settings')
    pushNavState()

    activeProjectId.set('proj-C')

    router.back()
    expect(get(activeProjectId)).toBe('proj-B')

    router.back()
    expect(get(activeProjectId)).toBe('proj-A')
  })

  it('back restores null activeProjectId', () => {
    const router = useAppRouter()
    activeProjectId.set(null)
    pushNavState()

    activeProjectId.set('proj-2')

    router.back()
    expect(get(activeProjectId)).toBeNull()
  })

  it('resetToBoard resets from plugin PR review view', () => {
    currentView.set('plugin:com.openforge.github-sync:pr_review')

    resetToBoard()

    expect(get(currentView)).toBe('board')
  })

  it('resetToBoard resets from plugin skills view', () => {
    currentView.set('plugin:com.openforge.skills-viewer:skills')

    resetToBoard()

    expect(get(currentView)).toBe('board')
  })

  it('resetToBoard clears navigation history', () => {
    const router = useAppRouter()
    activeProjectId.set('proj-1')
    currentView.set('board')
    pushNavState()

    currentView.set('settings')
    pushNavState()

    resetToBoard()

    expect(router.back()).toBe(false)
  })

  it('resetToBoard is a no-op when already on board with no task selected', () => {
    currentView.set('board')
    selectedTaskId.set(null)

    resetToBoard()

    expect(get(currentView)).toBe('board')
    expect(get(selectedTaskId)).toBeNull()
  })

  it('resetToBoard keeps activeProjectId when already on board', () => {
    activeProjectId.set('proj-1')
    currentView.set('board')

    resetToBoard()

    expect(get(activeProjectId)).toBe('proj-1')
    expect(get(currentView)).toBe('board')
  })
})
