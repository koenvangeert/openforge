import { isPluginViewKey } from './plugin/types'
import { get } from 'svelte/store'
import {
  activeProjectId,
  currentView,
  pendingManualComments,
  prFileDiffs,
  prOverviewComments,
  reviewComments,
  selectedReviewPr,
  selectedSkillName,
  selectedTaskId,
} from './stores'
import type { AppView, ReviewPullRequest } from './types'
import { TASK_CLEARING_VIEWS } from './views'

interface NavState {
  currentView: AppView
  selectedTaskId: string | null
  selectedReviewPr: ReviewPullRequest | null
  selectedSkillName: string | null
  activeProjectId: string | null
}

const history: NavState[] = []
const MAX_HISTORY = 50

function captureState(): NavState {
  return {
    currentView: get(currentView),
    selectedTaskId: get(selectedTaskId),
    selectedReviewPr: get(selectedReviewPr),
    selectedSkillName: get(selectedSkillName),
    activeProjectId: get(activeProjectId),
  }
}

export function pushNavState(): void {
  history.push(captureState())
  if (history.length > MAX_HISTORY) {
    history.shift()
  }
}

export function resetToBoard(): void {
  history.length = 0
  currentView.set('board')
  selectedTaskId.set(null)
  selectedReviewPr.set(null)
  selectedSkillName.set(null)
}

function navigateBack(): boolean {
  const prev = history.pop()
  if (!prev) {
    return false
  }

  const hadReviewPr = get(selectedReviewPr)

  currentView.set(prev.currentView)
  selectedTaskId.set(prev.selectedTaskId)
  selectedReviewPr.set(prev.selectedReviewPr)
  selectedSkillName.set(prev.selectedSkillName)
  activeProjectId.set(prev.activeProjectId)

  if (hadReviewPr && !prev.selectedReviewPr) {
    prFileDiffs.set([])
    reviewComments.set([])
    pendingManualComments.set([])
    prOverviewComments.set([])
  }

  return true
}

export function useAppRouter() {
  let currentViewState = $state<AppView>(get(currentView))

  function navigate(view: AppView) {
    if (view === 'board') {
      resetToBoardRoute()
      currentViewState = 'board'
      return
    }

    pushNavState()
    currentViewState = view
    currentView.set(view)

    if (TASK_CLEARING_VIEWS.has(view) || isPluginViewKey(view)) {
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

  function resetToBoardRoute() {
    resetToBoard()
    currentViewState = 'board'
  }

  return {
    navigate,
    navigateToTask,
    back,
    resetToBoard: resetToBoardRoute,
    get currentView() {
      return currentViewState
    },
  }
}
