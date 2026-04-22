import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

const { listPluginsMock, setPluginEnabledMock, getEnabledPluginsMock } = vi.hoisted(() => ({
  listPluginsMock: vi.fn(),
  setPluginEnabledMock: vi.fn(),
  getEnabledPluginsMock: vi.fn(),
}))

vi.mock('../ipc', () => ({
  listPlugins: listPluginsMock,
  setPluginEnabled: setPluginEnabledMock,
  getEnabledPlugins: getEnabledPluginsMock,
}))

import {
  installedPlugins,
  enabledPluginIds,
  loading,
  error,
  loadInstalledPlugins,
  enablePlugin,
  disablePlugin,
  isPluginEnabled,
  getContributions,
  loadEnabledForProject,
} from './pluginStore'
import type { NormalizedPluginRow } from '../ipc'

function makePlugin(id: string): NormalizedPluginRow {
  return {
    id,
    name: `Plugin ${id}`,
    version: '1.0.0',
    apiVersion: 1,
    description: 'Test plugin',
    permissions: '[]',
    contributes: '{}',
    frontendEntry: 'index.js',
    backendEntry: null,
    installPath: '/tmp/plugin',
    installedAt: 0,
    isBuiltin: false,
  }
}

describe('pluginStore', () => {
  beforeEach(() => {
    listPluginsMock.mockReset()
    setPluginEnabledMock.mockReset()
    getEnabledPluginsMock.mockReset()
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    loading.set(false)
    error.set(null)
  })

  it('loads installed plugins from backend', async () => {
    listPluginsMock.mockResolvedValue([makePlugin('p1'), makePlugin('p2')])
    await loadInstalledPlugins()
    const map = get(installedPlugins)
    expect(map.size).toBe(2)
    expect(map.has('p1')).toBe(true)
    expect(map.has('p2')).toBe(true)
    expect(map.get('p1')?.installPath).toBe('/tmp/plugin')
  })

  it('enables plugin for project', async () => {
    setPluginEnabledMock.mockResolvedValue(undefined)
    await enablePlugin('proj1', 'p1')
    const set = get(enabledPluginIds)
    expect(set.has('p1')).toBe(true)
  })

  it('disables plugin for project', async () => {
    setPluginEnabledMock.mockResolvedValue(undefined)
    enabledPluginIds.set(new Set(['p1']))
    await disablePlugin('proj1', 'p1')
    const set = get(enabledPluginIds)
    expect(set.has('p1')).toBe(false)
  })

  it('checks if plugin is enabled', () => {
    enabledPluginIds.set(new Set(['p1']))
    expect(isPluginEnabled('p1')).toBe(true)
    expect(isPluginEnabled('p2')).toBe(false)
  })

  it('getContributions returns empty array (stub)', () => {
    installedPlugins.set(new Map([[
      'p1',
      {
        manifest: {
          id: 'p1',
          name: 'Plugin p1',
          version: '1.0.0',
          apiVersion: 1,
          description: 'Test plugin',
          permissions: [],
          contributes: {
            views: [{ id: 'main', title: 'Main', icon: 'sparkles' }],
          },
          frontend: 'index.js',
          backend: null,
        },
        state: 'installed',
        error: null,
      },
    ]]))
    enabledPluginIds.set(new Set(['p1']))

    const result = getContributions('views') as Array<{ pluginId: string, contributionId: string }>

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ pluginId: 'p1', contributionId: 'main' })
  })

  it('sets loading state during load', async () => {
    let loadingDuring = false
    listPluginsMock.mockImplementation(async () => {
      loadingDuring = get(loading)
      return []
    })
    await loadInstalledPlugins()
    expect(loadingDuring).toBe(true)
    expect(get(loading)).toBe(false)
  })

  it('sets error state on IPC failure', async () => {
    listPluginsMock.mockRejectedValue(new Error('backend error'))
    await loadInstalledPlugins()
    expect(get(error)).toBe('backend error')
    expect(get(loading)).toBe(false)
  })

  it('loadEnabledForProject populates enabled set', async () => {
    getEnabledPluginsMock.mockResolvedValue([makePlugin('pa'), makePlugin('pb')])
    await loadEnabledForProject('proj1')
    const set = get(enabledPluginIds)
    expect(set.has('pa')).toBe(true)
    expect(set.has('pb')).toBe(true)
  })
})
