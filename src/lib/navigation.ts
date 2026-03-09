import { get } from 'svelte/store'
import { currentView, selectedTaskId, selectedReviewPr, selectedSkillName, prFileDiffs, reviewComments, pendingManualComments, prOverviewComments, activeProjectId } from './stores'
import type { AppView, ReviewPullRequest } from './types'

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

export function navigateBack(): boolean {
  const prev = history.pop()
  if (!prev) return false

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
