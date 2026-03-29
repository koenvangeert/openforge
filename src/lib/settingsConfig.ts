import { loadActions } from './actions'
import { loadFocusFilterStates } from './boardFilters'
import {
  checkClaudeInstalled,
  checkOpenCodeInstalled,
  getAllWhisperModelStatuses,
  getConfig,
  getProjectConfig,
} from './ipc'
import type { WhisperModelStatus, ClaudeInstallStatus } from './types'
import type { Action } from './types'
import type { TaskState } from './taskState'

export interface ProjectSettingsConfig {
  githubDefaultRepo: string
  agentInstructions: string
  aiProvider: string
  useWorktrees: boolean
  projectColor: string
  actions: Action[]
  focusFilterStates: TaskState[]
}

export interface GlobalSettingsConfig {
  taskIdPrefix: string
  githubToken: string
  codeCleanupTasksEnabled: boolean
  githubPollInterval: number
}

export interface InstallationStatus {
  opencodeInstalled: boolean
  opencodeVersion: string | null
  claudeInstalled: boolean
  claudeVersion: string | null
  claudeAuthenticated: boolean
}

interface OpenCodeInstallStatus {
  installed: boolean
  path: string | null
  version: string | null
}

const DEFAULT_PROJECT_SETTINGS: Omit<ProjectSettingsConfig, 'actions' | 'focusFilterStates'> = {
  githubDefaultRepo: '',
  agentInstructions: '',
  aiProvider: 'claude-code',
  useWorktrees: true,
  projectColor: '',
}

const DEFAULT_GLOBAL_SETTINGS: GlobalSettingsConfig = {
  taskIdPrefix: '',
  githubToken: '',
  codeCleanupTasksEnabled: false,
  githubPollInterval: 30,
}

export async function loadProjectSettings(projectId: string): Promise<ProjectSettingsConfig> {
  const [repo, instructions, provider, worktrees, color, actions, focusFilterStates] = await Promise.all([
    getProjectConfig(projectId, 'github_default_repo'),
    getProjectConfig(projectId, 'additional_instructions'),
    getProjectConfig(projectId, 'ai_provider'),
    getProjectConfig(projectId, 'use_worktrees'),
    getProjectConfig(projectId, 'project_color'),
    loadActions(projectId),
    loadFocusFilterStates(projectId),
  ])

  return {
    githubDefaultRepo: repo ?? DEFAULT_PROJECT_SETTINGS.githubDefaultRepo,
    agentInstructions: instructions ?? DEFAULT_PROJECT_SETTINGS.agentInstructions,
    aiProvider: provider ?? DEFAULT_PROJECT_SETTINGS.aiProvider,
    useWorktrees: worktrees !== 'false',
    projectColor: color ?? DEFAULT_PROJECT_SETTINGS.projectColor,
    actions,
    focusFilterStates,
  }
}

export async function loadGlobalSettings(): Promise<GlobalSettingsConfig> {
  const [taskIdPrefix, githubToken, codeCleanupTasksEnabled, githubPollInterval] = await Promise.all([
    getConfig('task_id_prefix'),
    getConfig('github_token'),
    getConfig('code_cleanup_tasks_enabled'),
    getConfig('github_poll_interval'),
  ])

  return {
    taskIdPrefix: taskIdPrefix ?? DEFAULT_GLOBAL_SETTINGS.taskIdPrefix,
    githubToken: githubToken ?? DEFAULT_GLOBAL_SETTINGS.githubToken,
    codeCleanupTasksEnabled: codeCleanupTasksEnabled === 'true',
    githubPollInterval: parseInt(githubPollInterval ?? String(DEFAULT_GLOBAL_SETTINGS.githubPollInterval), 10) || DEFAULT_GLOBAL_SETTINGS.githubPollInterval,
  }
}

export async function loadInstallationStatus(): Promise<InstallationStatus> {
  const [opencodeResult, claudeResult] = await Promise.all([
    checkOpenCodeInstalled().catch<OpenCodeInstallStatus>(() => ({
      installed: false,
      path: null,
      version: null,
    })),
    checkClaudeInstalled().catch<ClaudeInstallStatus>(() => ({
      installed: false,
      path: null,
      version: null,
      authenticated: false,
    })),
  ])

  return {
    opencodeInstalled: opencodeResult.installed,
    opencodeVersion: opencodeResult.version,
    claudeInstalled: claudeResult.installed,
    claudeVersion: claudeResult.version,
    claudeAuthenticated: claudeResult.authenticated,
  }
}

export async function loadWhisperModelStatuses(): Promise<WhisperModelStatus[]> {
  return getAllWhisperModelStatuses().catch(() => [])
}
