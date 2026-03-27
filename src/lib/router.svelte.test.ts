import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { navigateBack } from './navigation'
import { activeProjectId, currentView, selectedTaskId } from './stores'
import { useAppRouter } from './router.svelte'

describe('useAppRouter', () => {
  beforeEach(() => {
    currentView.set('board')
    selectedTaskId.set(null)
    activeProjectId.set(null)

    while (navigateBack()) {
    }

    currentView.set('board')
    selectedTaskId.set(null)
    activeProjectId.set(null)
  })

  it('navigate(pr_review) clears selectedTaskId synchronously', () => {
    const router = useAppRouter()
    selectedTaskId.set('task-1')

    router.navigate('pr_review')

    expect(get(selectedTaskId)).toBeNull()
    expect(get(currentView)).toBe('pr_review')
  })

  it('navigate(settings) clears selectedTaskId synchronously', () => {
    const router = useAppRouter()
    selectedTaskId.set('task-1')

    router.navigate('settings')

    expect(get(selectedTaskId)).toBeNull()
    expect(get(currentView)).toBe('settings')
  })

  it('navigate(workqueue) clears selectedTaskId synchronously', () => {
    const router = useAppRouter()
    selectedTaskId.set('task-1')

    router.navigate('workqueue')

    expect(get(selectedTaskId)).toBeNull()
    expect(get(currentView)).toBe('workqueue')
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

  it('navigateToTask sets selectedTaskId', () => {
    const router = useAppRouter()

    router.navigateToTask('task-42')

    expect(get(selectedTaskId)).toBe('task-42')
  })
})
