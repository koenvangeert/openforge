import { get } from 'svelte/store'
import {
  activeProjectId,
  activeSessions,
  authoredPrCount,
  error,
  isLoading,
  projectAttention,
  projects,
  reviewRequestCount,
  tasks,
  ticketPrs,
} from './stores'
import {
  forceGithubSync,
  getAuthoredPrs,
  getConfig,
  getLatestSessions,
  getProjectAttention,
  getProjectConfig,
  getProjects,
  getPullRequests,
  getReviewPrs,
  getTasksForProject,
} from './ipc'
import { applyProjectOrder } from './projectOrder'
import { hasMergeConflicts, preservePullRequestState } from './types'
import type { ProjectAttention, PullRequestInfo } from './types'

type LogError = (message: string, error: unknown) => void

export interface AppDataOrchestratorOptions {
  setShowProjectSetup(show: boolean): void
  logError?: LogError
}

function defaultLogError(message: string, errorValue: unknown): void {
  console.error(message, errorValue)
}

async function loadExcludedRepos(projectId: string): Promise<Set<string>> {
  try {
    const val = await getProjectConfig(projectId, 'pr_excluded_repos')
    if (!val) return new Set()

    const parsed = JSON.parse(val)
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    // No exclusion config — count all
    return new Set()
  }
}

export function useAppDataOrchestrator(options: AppDataOrchestratorOptions) {
  const logError = options.logError ?? defaultLogError
  let isSyncing = $state(false)

  async function loadProjects(): Promise<void> {
    try {
      const fetchedProjects = await getProjects()
      let savedOrder: string | null = null

      try {
        savedOrder = await getConfig('project_sidebar_order')
      } catch (configError) {
        logError('Failed to load saved project order:', configError)
      }

      const orderedProjects = applyProjectOrder(fetchedProjects, savedOrder)
      projects.set(orderedProjects)

      const currentActiveProjectId = get(activeProjectId)
      if (currentActiveProjectId && !orderedProjects.find(p => p.id === currentActiveProjectId)) {
        activeProjectId.set(orderedProjects.length > 0 ? orderedProjects[0].id : null)
      } else if (orderedProjects.length > 0 && !currentActiveProjectId) {
        activeProjectId.set(orderedProjects[0].id)
      }

      if (orderedProjects.length === 0) {
        options.setShowProjectSetup(true)
      }
    } catch (e) {
      logError('Failed to load projects:', e)
      error.set(String(e))
    }
  }

  async function loadSessions(): Promise<void> {
    try {
      const taskIds = get(tasks).map(t => t.id)
      if (taskIds.length === 0) return

      const sessions = await getLatestSessions(taskIds)
      const updated = new Map(get(activeSessions))
      for (const session of sessions) {
        updated.set(session.ticket_id, session)
      }
      activeSessions.set(updated)
    } catch (e) {
      logError('Failed to load sessions:', e)
    }
  }

  async function loadTasks(): Promise<void> {
    const projectId = get(activeProjectId)
    if (!projectId) return

    isLoading.set(true)
    try {
      tasks.set(await getTasksForProject(projectId))
      await loadSessions()
    } catch (e) {
      logError('Failed to load tasks:', e)
      error.set(String(e))
    } finally {
      isLoading.set(false)
    }
  }

  async function loadPullRequests(): Promise<void> {
    try {
      const prs = await getPullRequests()
      const grouped = new Map<string, PullRequestInfo[]>()
      const previousPrs = get(ticketPrs)

      for (const pr of prs) {
        const oldList = previousPrs.get(pr.ticket_id) || []
        const oldPr = oldList.find(p => p.id === pr.id)
        const preservedPr = preservePullRequestState(oldPr, pr)

        const existing = grouped.get(preservedPr.ticket_id) || []
        existing.push(preservedPr)
        grouped.set(preservedPr.ticket_id, existing)
      }

      ticketPrs.set(grouped)
    } catch (e) {
      logError('Failed to load pull requests:', e)
    }
  }

  async function refreshPrCounts(): Promise<void> {
    const projectId = get(activeProjectId)
    if (!projectId) return

    try {
      const excludedRepos = await loadExcludedRepos(projectId)
      const isExcluded = (owner: string, name: string) => excludedRepos.has(`${owner}/${name}`)

      const reviewPrList = await getReviewPrs()
      const filtered = reviewPrList.filter(p => !isExcluded(p.repo_owner, p.repo_name))
      reviewRequestCount.set(filtered.filter(p => p.viewed_at === null).length)

      const authoredPrList = await getAuthoredPrs()
      const filteredAuthored = authoredPrList.filter(p => !isExcluded(p.repo_owner, p.repo_name))
      authoredPrCount.set(filteredAuthored.filter(
        (p) => p.ci_status === 'failure' || p.review_status === 'changes_requested' || hasMergeConflicts(p),
      ).length)
    } catch (e) {
      logError('Failed to refresh PR counts:', e)
    }
  }

  async function loadProjectAttention(): Promise<void> {
    try {
      const summaries = await getProjectAttention()
      const map = new Map<string, ProjectAttention>()
      for (const summary of summaries) {
        map.set(summary.project_id, summary)
      }
      projectAttention.set(map)
    } catch (e) {
      logError('Failed to load project attention:', e)
    }
  }

  async function triggerGithubSync(): Promise<void> {
    if (isSyncing) return

    isSyncing = true
    try {
      await forceGithubSync()
      await loadPullRequests()
      await loadTasks()
    } catch (e) {
      logError('Failed to sync GitHub:', e)
      error.set(String(e))
    } finally {
      isSyncing = false
    }
  }

  return {
    get isSyncing() {
      return isSyncing
    },
    loadProjects,
    loadTasks,
    loadSessions,
    loadPullRequests,
    refreshPrCounts,
    loadProjectAttention,
    triggerGithubSync,
  }
}
