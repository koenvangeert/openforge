import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ipc', () => ({
  getProjectConfig: vi.fn(),
  getConfig: vi.fn(),
  checkOpenCodeInstalled: vi.fn(),
  checkClaudeInstalled: vi.fn(),
  getAllWhisperModelStatuses: vi.fn(),
}))

vi.mock('./actions', () => ({
  loadActions: vi.fn(),
}))

vi.mock('./boardFilters', () => ({
  loadFocusFilterStates: vi.fn(),
}))

import {
  loadGlobalSettings,
  loadInstallationStatus,
  loadProjectSettings,
  loadWhisperModelStatuses,
} from './settingsConfig'
import {
  checkClaudeInstalled,
  checkOpenCodeInstalled,
  getAllWhisperModelStatuses,
  getConfig,
  getProjectConfig,
} from './ipc'
import { loadActions } from './actions'
import { loadFocusFilterStates } from './boardFilters'

describe('settingsConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    vi.mocked(getConfig).mockResolvedValue(null)
    vi.mocked(loadActions).mockResolvedValue([])
    vi.mocked(loadFocusFilterStates).mockResolvedValue([])
    vi.mocked(checkOpenCodeInstalled).mockResolvedValue({
      installed: false,
      path: null,
      version: null,
    })
    vi.mocked(checkClaudeInstalled).mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      authenticated: false,
    })
    vi.mocked(getAllWhisperModelStatuses).mockResolvedValue([])
  })

  describe('loadProjectSettings', () => {
    it('loads project settings with defaults and related collections', async () => {
      vi.mocked(getProjectConfig)
        .mockResolvedValueOnce('owner/repo')
        .mockResolvedValueOnce('Be careful')
        .mockResolvedValueOnce('opencode')
        .mockResolvedValueOnce('false')
        .mockResolvedValueOnce('amber')

      vi.mocked(loadActions).mockResolvedValue([
        { id: 'a1', name: 'Action', prompt: '', builtin: false, enabled: true },
      ])
      vi.mocked(loadFocusFilterStates).mockResolvedValue(['idle'])

      const result = await loadProjectSettings('project-1')

      expect(getProjectConfig).toHaveBeenCalledTimes(5)
      expect(loadActions).toHaveBeenCalledWith('project-1')
      expect(loadFocusFilterStates).toHaveBeenCalledWith('project-1')
      expect(result).toEqual({
        githubDefaultRepo: 'owner/repo',
        agentInstructions: 'Be careful',
        aiProvider: 'opencode',
        useWorktrees: false,
        projectColor: 'amber',
        actions: [{ id: 'a1', name: 'Action', prompt: '', builtin: false, enabled: true }],
        focusFilterStates: ['idle'],
      })
    })

    it('falls back to the current defaults when config values are missing', async () => {
      const result = await loadProjectSettings('project-1')

      expect(result).toEqual({
        githubDefaultRepo: '',
        agentInstructions: '',
        aiProvider: 'claude-code',
        useWorktrees: true,
        projectColor: '',
        actions: [],
        focusFilterStates: [],
      })
    })
  })

  describe('loadGlobalSettings', () => {
    it('loads global settings and parses boolean and numeric fields', async () => {
      vi.mocked(getConfig)
        .mockResolvedValueOnce('T-')
        .mockResolvedValueOnce('gh-token')
        .mockResolvedValueOnce('true')
        .mockResolvedValueOnce('45')

      const result = await loadGlobalSettings()

      expect(getConfig).toHaveBeenCalledTimes(4)
      expect(result).toEqual({
        taskIdPrefix: 'T-',
        githubToken: 'gh-token',
        codeCleanupTasksEnabled: true,
        githubPollInterval: 45,
      })
    })

    it('uses current fallback values when config is empty or invalid', async () => {
      vi.mocked(getConfig)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('not-a-number')

      const result = await loadGlobalSettings()

      expect(result).toEqual({
        taskIdPrefix: '',
        githubToken: '',
        codeCleanupTasksEnabled: false,
        githubPollInterval: 30,
      })
    })
  })

  describe('loadInstallationStatus', () => {
    it('loads installation checks and normalizes the result', async () => {
      vi.mocked(checkOpenCodeInstalled).mockResolvedValue({
        installed: true,
        path: '/usr/local/bin/opencode',
        version: '1.2.3',
      })
      vi.mocked(checkClaudeInstalled).mockResolvedValue({
        installed: true,
        path: '/usr/local/bin/claude',
        version: '2.3.4',
        authenticated: true,
      })

      const result = await loadInstallationStatus()

      expect(result).toEqual({
        opencodeInstalled: true,
        opencodeVersion: '1.2.3',
        claudeInstalled: true,
        claudeVersion: '2.3.4',
        claudeAuthenticated: true,
      })
    })

    it('falls back to disconnected install status when checks fail', async () => {
      vi.mocked(checkOpenCodeInstalled).mockRejectedValue(new Error('missing'))
      vi.mocked(checkClaudeInstalled).mockRejectedValue(new Error('missing'))

      const result = await loadInstallationStatus()

      expect(result).toEqual({
        opencodeInstalled: false,
        opencodeVersion: null,
        claudeInstalled: false,
        claudeVersion: null,
        claudeAuthenticated: false,
      })
    })
  })

  describe('loadWhisperModelStatuses', () => {
    it('returns Whisper model statuses when available', async () => {
      vi.mocked(getAllWhisperModelStatuses).mockResolvedValue([
        {
          size: 'tiny',
          display_name: 'Tiny',
          disk_size_mb: 39,
          ram_usage_mb: 125,
          downloaded: true,
          model_path: '/tmp/tiny.bin',
          model_size_bytes: 39000000,
          model_name: 'ggml-tiny',
          is_active: true,
        },
      ])

      await expect(loadWhisperModelStatuses()).resolves.toEqual([
        {
          size: 'tiny',
          display_name: 'Tiny',
          disk_size_mb: 39,
          ram_usage_mb: 125,
          downloaded: true,
          model_path: '/tmp/tiny.bin',
          model_size_bytes: 39000000,
          model_name: 'ggml-tiny',
          is_active: true,
        },
      ])
    })

    it('returns an empty list when loading model statuses fails', async () => {
      vi.mocked(getAllWhisperModelStatuses).mockRejectedValue(new Error('boom'))

      await expect(loadWhisperModelStatuses()).resolves.toEqual([])
    })
  })
})
