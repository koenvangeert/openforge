import { get } from 'svelte/store'
import { navigateBack, pushNavState, resetToBoard as navResetToBoard } from './navigation'
import { currentView, selectedTaskId } from './stores'
import type { AppView } from './types'

const VIEWS_CLEARING_TASK_SELECTION: ReadonlySet<AppView> = new Set([
  'pr_review',
  'settings',
  'workqueue',
  'global_settings',
])

export function useAppRouter() {
  let currentViewState = $state<AppView>(get(currentView))

  function navigate(view: AppView) {
    if (view === 'board') {
      navResetToBoard()
      currentViewState = 'board'
      return
    }

    pushNavState()
    currentViewState = view
    currentView.set(view)

    if (VIEWS_CLEARING_TASK_SELECTION.has(view)) {
      selectedTaskId.set(null)
    }
  }

  function navigateToTask(taskId: string) {
    pushNavState()
    selectedTaskId.set(taskId)
  }

  function back(): boolean {
    const didNavigate = navigateBack()
    currentViewState = get(currentView)
    return didNavigate
  }

  function resetToBoard() {
    navResetToBoard()
    currentViewState = 'board'
  }

  return {
    navigate,
    navigateToTask,
    back,
    resetToBoard,
    get currentView() {
      return currentViewState
    },
  }
}
