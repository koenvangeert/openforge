import { get } from 'svelte/store'
import type { BackendReadyState } from '@openforge/plugin-sdk'
import {
  fetchAuthoredPrs,
  fetchReviewPrs,
  forceGithubSync,
  fsReadDir,
  fsReadFile,
  fsSearchFiles,
  getAgentReviewComments,
  getAllTasks,
  getAuthoredPrs,
  getConfig,
  getFileAtRef,
  getFileContent,
  getPrFileDiffs,
  getPrOverviewComments,
  getProjectAttention,
  getProjectConfig,
  getProjects,
  getPtyBuffer,
  getReviewComments,
  getReviewPrs,
  getTaskDetail,
  getTasksForProject,
  getTaskWorkspace,
  getLatestSession,
  listOpenCodeSkills,
  markReviewPrViewed,
  killPty,
  openUrl,
  pluginBackendWhenReady,
  pluginInvoke,
  resizePty,
  saveSkillContent,
  setConfig,
  setProjectConfig,
  spawnShellPty,
  submitPrReview,
  updateAgentReviewCommentStatus,
  updateTaskStatus,
  updateTaskSummary,
  writePty,
} from '../ipc'
import { activeProjectId, currentView, selectedTaskId } from '../stores'
import type { AppView } from '../types'
import { installedPlugins } from './pluginStore'
import { isPluginViewKey } from './types'
import {
  emitPluginHostEvent,
  ensurePluginHostStoreSubscriptions,
  getContextSnapshot,
  subscribeToPluginHostEvent,
  waitForTerminalEventSubscriptions,
} from './pluginHostEvents'

const STATIC_APP_VIEWS = new Set<AppView>(['board', 'settings', 'global_settings', 'files'])
const pluginBackendReadyStates = new Map<string, BackendReadyState>()

function isAppView(value: unknown): value is AppView {
  return typeof value === 'string' && (STATIC_APP_VIEWS.has(value as AppView) || isPluginViewKey(value))
}

export function clearPluginRuntimeHostState(pluginId: string): void {
  pluginBackendReadyStates.delete(pluginId)
}

export function createPluginRuntimeHost(pluginId: string) {
  const entry = get(installedPlugins).get(pluginId)
  if (entry?.manifest.backend && entry.state !== 'active') {
    pluginBackendReadyStates.set(pluginId, 'starting')
  } else if (!entry?.manifest.backend) {
    pluginBackendReadyStates.delete(pluginId)
  }

  return {
    listProjects: () => getProjects(),
    getProject: async (projectId: string) => (await getProjects()).find((project) => project.id === projectId) ?? null,
    listTasks: (request?: { projectId?: string }) => request?.projectId ? getTasksForProject(request.projectId) : getAllTasks(),
    getTask: (taskId: string) => getTaskDetail(taskId),
    updateTaskSummary: (taskId: string, summary: string) => updateTaskSummary(taskId, summary),
    updateTaskStatus: (taskId: string, status: Parameters<typeof updateTaskStatus>[1]) => updateTaskStatus(taskId, status),
    getTaskWorkspace: (taskId: string) => getTaskWorkspace(taskId),
    getLatestSession: (taskId: string) => getLatestSession(taskId),
    readDir: (request: { projectId: string; path?: string | null }) => fsReadDir(request.projectId, request.path ?? null),
    readFile: (request: { projectId: string; path: string }) => fsReadFile(request.projectId, request.path),
    searchFiles: (request: { projectId: string; query: string; limit?: number }) => fsSearchFiles(request.projectId, request.query, request.limit),
    spawnShell: async (request: { taskId: string; cwd: string; cols: number; rows: number; terminalIndex: number }) => {
      await waitForTerminalEventSubscriptions(request)
      return spawnShellPty(request.taskId, request.cwd, request.cols, request.rows, request.terminalIndex)
    },
    writeShell: (request: { taskId: string; data: string }) => writePty(request.taskId, request.data),
    resizeShell: (request: { taskId: string; cols: number; rows: number }) => resizePty(request.taskId, request.cols, request.rows),
    killShell: (request: { taskId: string }) => killPty(request.taskId),
    getShellBuffer: (request: { taskId: string }) => getPtyBuffer(request.taskId),
    notify: async (request: unknown) => {
      await Promise.resolve()
      emitPluginHostEvent('openforge.notification', request)
    },
    getAttention: () => getProjectAttention(),
    openUrl: (url: string) => openUrl(url),
    getBackendState: () => {
      const entry = get(installedPlugins).get(pluginId)
      if (!entry?.manifest.backend) return 'missing' as const
      if (entry.state === 'error') return 'error' as const
      return pluginBackendReadyStates.get(pluginId) ?? 'starting'
    },
    whenBackendReady: async () => {
      const entry = get(installedPlugins).get(pluginId)
      if (!entry?.manifest.backend) {
        throw new Error(`Plugin backend is unavailable for ${pluginId}`)
      }
      if (pluginBackendReadyStates.get(pluginId) !== 'ready') {
        pluginBackendReadyStates.set(pluginId, 'starting')
      }
      try {
        await pluginBackendWhenReady(pluginId)
        pluginBackendReadyStates.set(pluginId, 'ready')
      } catch (error) {
        pluginBackendReadyStates.set(pluginId, 'error')
        throw error
      }
    },
    onBackendReady: (handler: () => void) => {
      const entry = get(installedPlugins).get(pluginId)
      let disposed = false
      if (entry?.manifest.backend) {
        if (pluginBackendReadyStates.get(pluginId) !== 'ready') {
          pluginBackendReadyStates.set(pluginId, 'starting')
        }
        pluginBackendWhenReady(pluginId).then(() => {
          pluginBackendReadyStates.set(pluginId, 'ready')
          if (!disposed) handler()
        }).catch(() => {
          pluginBackendReadyStates.set(pluginId, 'error')
        })
      }
      return () => { disposed = true }
    },
    invokeBackendMethod: async (method: string, payload?: unknown) => {
      try {
        const result = await pluginInvoke(pluginId, method, payload ?? null)
        pluginBackendReadyStates.set(pluginId, 'ready')
        return result
      } catch (error) {
        pluginBackendReadyStates.set(pluginId, 'error')
        throw error
      }
    },
    getConfig: (key: string) => getConfig(key),
    setConfig: (key: string, value: unknown) => setConfig(key, typeof value === 'string' ? value : JSON.stringify(value)),
    getProjectConfig: (projectId: string, key: string) => getProjectConfig(projectId, key),
    setProjectConfig: (projectId: string, key: string, value: unknown) => setProjectConfig(projectId, key, typeof value === 'string' ? value : JSON.stringify(value)),
    invokeHostCommand: (command: string, payload: unknown) => {
      ensurePluginHostStoreSubscriptions()
      return invokePluginHostCommand(command, payload)
    },
    onHostEvent: (event: string, handler: (payload: unknown) => void) => {
      ensurePluginHostStoreSubscriptions()
      return subscribeToPluginHostEvent(pluginId, event, handler)
    },
  }
}

export async function invokePluginHostCommand(command: string, payload: unknown): Promise<unknown> {
  const commandPayload = payload !== null && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : undefined

  switch (command) {
    case 'getContext':
      return getContextSnapshot()
    case 'getSelection':
      return { selectedTaskId: get(selectedTaskId) }
    case 'getNavigation':
      return {
        activeProjectId: get(activeProjectId),
        currentView: get(currentView),
      }
    case 'getTaskContext': {
      const taskId = typeof commandPayload?.taskId === 'string' ? commandPayload.taskId : get(selectedTaskId)
      return { taskId }
    }
    case 'getProjectContext': {
      const projectId = typeof commandPayload?.projectId === 'string' ? commandPayload.projectId : get(activeProjectId)
      return { projectId }
    }
    case 'navigate': {
      if (isAppView(commandPayload?.currentView)) {
        currentView.set(commandPayload.currentView)
      }

      if (typeof commandPayload?.selectedTaskId === 'string' || commandPayload?.selectedTaskId === null) {
        selectedTaskId.set(commandPayload?.selectedTaskId ?? null)
      }

      if (typeof commandPayload?.activeProjectId === 'string' || commandPayload?.activeProjectId === null) {
        activeProjectId.set(commandPayload?.activeProjectId ?? null)
      }

      return getContextSnapshot()
    }
    case 'forceGithubSync':
      return forceGithubSync()
    case 'openUrl':
      return openUrl(String(commandPayload?.url ?? ''))
    case 'fsReadDir':
      return fsReadDir(String(commandPayload?.projectId ?? ''), typeof commandPayload?.dirPath === 'string' ? commandPayload.dirPath : null)
    case 'fsReadFile':
      return fsReadFile(String(commandPayload?.projectId ?? ''), String(commandPayload?.filePath ?? ''))
    case 'listOpenCodeSkills':
      return listOpenCodeSkills(String(commandPayload?.projectId ?? ''))
    case 'saveSkillContent':
      return saveSkillContent(
        String(commandPayload?.projectId ?? ''),
        String(commandPayload?.name ?? ''),
        commandPayload?.level === 'user' ? 'user' : 'project',
        String(commandPayload?.sourceDir ?? ''),
        String(commandPayload?.content ?? '')
      )
    case 'fetchReviewPrs':
      return fetchReviewPrs()
    case 'getReviewPrs':
      return getReviewPrs()
    case 'fetchAuthoredPrs':
      return fetchAuthoredPrs()
    case 'getAuthoredPrs':
      return getAuthoredPrs()
    case 'markReviewPrViewed':
      return markReviewPrViewed(Number(commandPayload?.prId), String(commandPayload?.headSha ?? ''))
    case 'getPrFileDiffs':
      return getPrFileDiffs(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), Number(commandPayload?.prNumber))
    case 'getFileContent':
      return getFileContent(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), String(commandPayload?.sha ?? ''))
    case 'getFileAtRef':
      return getFileAtRef(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), String(commandPayload?.path ?? ''), String(commandPayload?.refSha ?? ''))
    case 'getReviewComments':
      return getReviewComments(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), Number(commandPayload?.prNumber))
    case 'getPrOverviewComments':
      return getPrOverviewComments(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), Number(commandPayload?.prNumber))
    case 'submitPrReview':
      return submitPrReview(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), Number(commandPayload?.prNumber), String(commandPayload?.event ?? ''), String(commandPayload?.body ?? ''), Array.isArray(commandPayload?.comments) ? commandPayload.comments as never : [], String(commandPayload?.commitId ?? ''))
    case 'getAgentReviewComments':
      return getAgentReviewComments(Number(commandPayload?.reviewPrId))
    case 'updateAgentReviewCommentStatus':
      return updateAgentReviewCommentStatus(Number(commandPayload?.commentId), String(commandPayload?.status ?? ''))
    case 'getProjectConfig':
      return getProjectConfig(String(commandPayload?.projectId ?? ''), String(commandPayload?.key ?? ''))
    case 'setProjectConfig':
      return setProjectConfig(String(commandPayload?.projectId ?? ''), String(commandPayload?.key ?? ''), String(commandPayload?.value ?? ''))
    case 'spawnShellPty':
      await waitForTerminalEventSubscriptions(commandPayload)
      return spawnShellPty(String(commandPayload?.taskId ?? ''), String(commandPayload?.cwd ?? ''), Number(commandPayload?.cols), Number(commandPayload?.rows), Number(commandPayload?.terminalIndex))
    case 'writePty':
      return writePty(String(commandPayload?.taskId ?? ''), String(commandPayload?.data ?? ''))
    case 'resizePty':
      return resizePty(String(commandPayload?.taskId ?? ''), Number(commandPayload?.cols), Number(commandPayload?.rows))
    case 'killPty':
      return killPty(String(commandPayload?.taskId ?? ''))
    case 'getPtyBuffer':
      return getPtyBuffer(String(commandPayload?.taskId ?? ''))
    case 'getTaskWorkspace':
      return getTaskWorkspace(String(commandPayload?.taskId ?? ''))
    case 'getConfig':
      return getConfig(String(commandPayload?.key ?? ''))
    case 'setConfig':
      return setConfig(String(commandPayload?.key ?? ''), String(commandPayload?.value ?? ''))
    default:
      throw new Error(`Unknown plugin host command: ${command}`)
  }
}
