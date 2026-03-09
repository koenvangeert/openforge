import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Action } from './types'

// Mock IPC before importing actions module
vi.mock('./ipc', () => ({
  getProjectConfig: vi.fn(),
  setProjectConfig: vi.fn(),
}))

import { DEFAULT_ACTIONS, loadActions, saveActions, createAction, getEnabledActions } from './actions'
import { getProjectConfig, setProjectConfig } from './ipc'

describe('actions module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('DEFAULT_ACTIONS', () => {
    it('has exactly 1 item', () => {
      expect(DEFAULT_ACTIONS).toHaveLength(1)
    })

    it('are all builtin and enabled', () => {
      DEFAULT_ACTIONS.forEach(action => {
        expect(action.builtin).toBe(true)
        expect(action.enabled).toBe(true)
      })
    })

    it('has the Go action', () => {
      const names = DEFAULT_ACTIONS.map(a => a.name)
      expect(names).toContain('Go')
    })
  })

  describe('loadActions', () => {
    it('returns defaults when no config exists', async () => {
      vi.mocked(getProjectConfig).mockResolvedValue(null)

      const result = await loadActions('test-project-id')

      expect(result).toHaveLength(1)
      expect(result).toEqual(DEFAULT_ACTIONS)
      expect(setProjectConfig).toHaveBeenCalledWith(
        'test-project-id',
        'actions',
        JSON.stringify(DEFAULT_ACTIONS)
      )
    })

    it('parses stored JSON correctly', async () => {
      const storedActions = [
        {
          id: 'custom-1',
          name: 'Custom Action',
          prompt: 'Do something custom',
          builtin: false,
          enabled: true,
        },
        {
          id: 'custom-2',
          name: 'Another Custom',
          prompt: 'Do another thing',
          builtin: false,
          enabled: false,
        },
      ]

      vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify(storedActions))

      const result = await loadActions('test-project-id')

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('custom-1')
      expect(result[0].name).toBe('Custom Action')
      expect(result[1].id).toBe('custom-2')
      expect(result[1].enabled).toBe(false)
      expect(setProjectConfig).not.toHaveBeenCalled()
    })

    it('returns defaults when stored JSON is malformed', async () => {
      vi.mocked(getProjectConfig).mockResolvedValue('not valid json')

      const result = await loadActions('test-project-id')

      expect(result).toEqual(DEFAULT_ACTIONS)
      expect(setProjectConfig).toHaveBeenCalledWith(
        'test-project-id',
        'actions',
        JSON.stringify(DEFAULT_ACTIONS)
      )
    })

    it('returns defaults when stored JSON is not an array', async () => {
      vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify({ not: 'array' }))

      const result = await loadActions('test-project-id')

      expect(result).toEqual(DEFAULT_ACTIONS)
      expect(setProjectConfig).toHaveBeenCalledWith(
        'test-project-id',
        'actions',
        JSON.stringify(DEFAULT_ACTIONS)
      )
    })

    it('returns defaults when stored JSON is an empty array', async () => {
      vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify([]))

      const result = await loadActions('test-project-id')

      expect(result).toEqual(DEFAULT_ACTIONS)
      expect(setProjectConfig).toHaveBeenCalledWith(
        'test-project-id',
        'actions',
        JSON.stringify(DEFAULT_ACTIONS)
      )
    })
  })

  describe('saveActions', () => {
    it('serializes and calls setProjectConfig', async () => {
      const actions: Action[] = [
        {
          id: 'test-1',
          name: 'Test Action',
          prompt: 'Test prompt',
          builtin: false,
          enabled: true,
        },
      ]

      await saveActions('test-project-id', actions)

      expect(setProjectConfig).toHaveBeenCalledWith(
        'test-project-id',
        'actions',
        JSON.stringify(actions)
      )
    })
  })

  describe('createAction', () => {
    it('returns new action with UUID id', () => {
      const action = createAction('My Action', 'My prompt text')

      expect(action.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      expect(action.name).toBe('My Action')
      expect(action.prompt).toBe('My prompt text')
      expect(action.builtin).toBe(false)
      expect(action.enabled).toBe(true)
    })

    it('generates unique IDs for multiple actions', () => {
      const action1 = createAction('Action 1', 'Prompt 1')
      const action2 = createAction('Action 2', 'Prompt 2')

      expect(action1.id).not.toBe(action2.id)
    })
  })

  describe('getEnabledActions', () => {
    it('filters disabled actions', () => {
      const actions: Action[] = [
        {
          id: 'enabled-1',
          name: 'Enabled Action',
          prompt: 'This is enabled',
          builtin: true,
          enabled: true,
        },
        {
          id: 'disabled-1',
          name: 'Disabled Action',
          prompt: 'This is disabled',
          builtin: true,
          enabled: false,
        },
        {
          id: 'enabled-2',
          name: 'Another Enabled',
          prompt: 'Also enabled',
          builtin: false,
          enabled: true,
        },
      ]

      const result = getEnabledActions(actions)

      expect(result).toHaveLength(2)
      expect(result.every(a => a.enabled)).toBe(true)
      expect(result.find(a => a.id === 'disabled-1')).toBeUndefined()
    })

    it('sorts alphabetically by name', () => {
      const actions: Action[] = [
        {
          id: 'z',
          name: 'Zebra',
          prompt: 'Z',
          builtin: true,
          enabled: true,
        },
        {
          id: 'a',
          name: 'Apple',
          prompt: 'A',
          builtin: true,
          enabled: true,
        },
        {
          id: 'm',
          name: 'Mango',
          prompt: 'M',
          builtin: true,
          enabled: true,
        },
      ]

      const result = getEnabledActions(actions)

      expect(result[0].name).toBe('Apple')
      expect(result[1].name).toBe('Mango')
      expect(result[2].name).toBe('Zebra')
    })

    it('returns empty array when all actions are disabled', () => {
      const actions: Action[] = [
        {
          id: 'disabled-1',
          name: 'Disabled 1',
          prompt: 'Disabled',
          builtin: true,
          enabled: false,
        },
        {
          id: 'disabled-2',
          name: 'Disabled 2',
          prompt: 'Also disabled',
          builtin: false,
          enabled: false,
        },
      ]

      const result = getEnabledActions(actions)

      expect(result).toHaveLength(0)
    })

    it('handles empty input array', () => {
      const result = getEnabledActions([])

      expect(result).toHaveLength(0)
    })
  })
})
