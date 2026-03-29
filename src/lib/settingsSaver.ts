import { saveActions } from './actions'
import { saveFocusFilterStates } from './boardFilters'
import { setConfig, setProjectConfig, updateProject } from './ipc'
import type { Action } from './types'
import type { TaskState } from './taskState'

export interface ProjectSettingsSavePayload {
  projectId: string
  projectName: string
  projectPath: string
  githubDefaultRepo: string
  agentInstructions: string
  aiProvider: string
  useWorktrees: boolean
  projectColor: string
  actions: Action[]
  focusFilterStates: TaskState[]
}

export interface GlobalSettingsSavePayload {
  taskIdPrefix: string
  githubToken: string
  codeCleanupTasksEnabled: boolean
  githubPollInterval: number
}

export async function saveProjectSettings(payload: ProjectSettingsSavePayload): Promise<void> {
  await updateProject(payload.projectId, payload.projectName, payload.projectPath)
  await setProjectConfig(payload.projectId, 'github_default_repo', payload.githubDefaultRepo)
  await setProjectConfig(payload.projectId, 'additional_instructions', payload.agentInstructions)
  await setProjectConfig(payload.projectId, 'ai_provider', payload.aiProvider)
  await setProjectConfig(payload.projectId, 'use_worktrees', payload.useWorktrees ? 'true' : 'false')
  await setProjectConfig(payload.projectId, 'project_color', payload.projectColor)
  await saveActions(payload.projectId, payload.actions)
  await saveFocusFilterStates(payload.projectId, payload.focusFilterStates)
}

export async function saveGlobalSettings(payload: GlobalSettingsSavePayload): Promise<void> {
  await setConfig('task_id_prefix', payload.taskIdPrefix)
  await setConfig('github_token', payload.githubToken)
  await setConfig('code_cleanup_tasks_enabled', payload.codeCleanupTasksEnabled ? 'true' : 'false')
  await setConfig('github_poll_interval', String(payload.githubPollInterval))
}
