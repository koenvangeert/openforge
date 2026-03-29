import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ipc', () => ({
  updateProject: vi.fn(),
  setProjectConfig: vi.fn(),
  setConfig: vi.fn(),
}))

vi.mock('./actions', () => ({
  saveActions: vi.fn(),
}))

vi.mock('./boardFilters', () => ({
  saveFocusFilterStates: vi.fn(),
}))

import { saveGlobalSettings, saveProjectSettings } from './settingsSaver'
import { saveActions } from './actions'
import { saveFocusFilterStates } from './boardFilters'
import { setConfig, setProjectConfig, updateProject } from './ipc'

describe('settingsSaver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateProject).mockResolvedValue(undefined)
    vi.mocked(setProjectConfig).mockResolvedValue(undefined)
    vi.mocked(setConfig).mockResolvedValue(undefined)
    vi.mocked(saveActions).mockResolvedValue(undefined)
    vi.mocked(saveFocusFilterStates).mockResolvedValue(undefined)
  })

  it('persists project settings through the existing project config helpers', async () => {
    await saveProjectSettings({
      projectId: 'project-1',
      projectName: 'My Project',
      projectPath: '/tmp/project',
      githubDefaultRepo: 'owner/repo',
      agentInstructions: 'Do the thing',
      aiProvider: 'opencode',
      useWorktrees: false,
      projectColor: 'violet',
      actions: [{ id: 'a1', name: 'Action', prompt: '', builtin: false, enabled: true }],
      focusFilterStates: ['idle'],
    })

    expect(updateProject).toHaveBeenCalledWith('project-1', 'My Project', '/tmp/project')
    expect(setProjectConfig).toHaveBeenCalledWith('project-1', 'github_default_repo', 'owner/repo')
    expect(setProjectConfig).toHaveBeenCalledWith('project-1', 'additional_instructions', 'Do the thing')
    expect(setProjectConfig).toHaveBeenCalledWith('project-1', 'ai_provider', 'opencode')
    expect(setProjectConfig).toHaveBeenCalledWith('project-1', 'use_worktrees', 'false')
    expect(setProjectConfig).toHaveBeenCalledWith('project-1', 'project_color', 'violet')
    expect(saveActions).toHaveBeenCalledWith('project-1', [
      { id: 'a1', name: 'Action', prompt: '', builtin: false, enabled: true },
    ])
    expect(saveFocusFilterStates).toHaveBeenCalledWith('project-1', ['idle'])
  })

  it('persists global settings through the existing global config helpers', async () => {
    await saveGlobalSettings({
      taskIdPrefix: 'T-',
      githubToken: 'gh-token',
      codeCleanupTasksEnabled: true,
      githubPollInterval: 45,
    })

    expect(setConfig).toHaveBeenCalledWith('task_id_prefix', 'T-')
    expect(setConfig).toHaveBeenCalledWith('github_token', 'gh-token')
    expect(setConfig).toHaveBeenCalledWith('code_cleanup_tasks_enabled', 'true')
    expect(setConfig).toHaveBeenCalledWith('github_poll_interval', '45')
  })
})
