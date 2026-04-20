import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

const {
  installPluginMock,
  uninstallPluginIpcMock,
  getEnabledPluginsMock,
  fsReadFileMock,
  pluginInvokeMock,
  getPluginStorageMock,
  setPluginStorageMock,
} = vi.hoisted(() => ({
  installPluginMock: vi.fn(),
  uninstallPluginIpcMock: vi.fn(),
  getEnabledPluginsMock: vi.fn(),
  fsReadFileMock: vi.fn(),
  pluginInvokeMock: vi.fn(),
  getPluginStorageMock: vi.fn(),
  setPluginStorageMock: vi.fn(),
}))

vi.mock('../ipc', () => ({
  installPlugin: installPluginMock,
  uninstallPlugin: uninstallPluginIpcMock,
  getEnabledPlugins: getEnabledPluginsMock,
  listPlugins: vi.fn().mockResolvedValue([]),
  setPluginEnabled: vi.fn(),
  fsReadFile: fsReadFileMock,
  pluginInvoke: pluginInvokeMock,
  getPluginStorage: getPluginStorageMock,
  setPluginStorage: setPluginStorageMock,
}))

const {
  loadPluginFrontendMock,
  activatePluginLoaderMock,
  deactivatePluginLoaderMock,
  isPluginLoadedMock,
} = vi.hoisted(() => ({
  loadPluginFrontendMock: vi.fn(),
  activatePluginLoaderMock: vi.fn(),
  deactivatePluginLoaderMock: vi.fn(),
  isPluginLoadedMock: vi.fn(),
}))

vi.mock('./pluginLoader', () => ({
  loadPluginFrontend: loadPluginFrontendMock,
  activatePlugin: activatePluginLoaderMock,
  deactivatePlugin: deactivatePluginLoaderMock,
  isPluginLoaded: isPluginLoadedMock,
}))

import {
  emitPluginHostEvent,
  installPluginFromManifest,
  installPluginFromNpm,
  uninstallPlugin,
  loadEnabledForProject as registryLoadEnabledForProject,
  activatePlugin,
  installFromLocal,
} from './pluginRegistry'
import { installedPlugins, enabledPluginIds } from './pluginStore'
import type { PluginManifest } from './types'
import type { NormalizedPluginRow } from '../ipc'

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    apiVersion: 1,
    description: 'A test plugin',
    permissions: [],
    contributes: {},
    frontend: 'index.js',
    backend: null,
    ...overrides,
  }
}

function makeNormalized(id: string): NormalizedPluginRow {
  return {
    id,
    name: `Plugin ${id}`,
    version: '1.0.0',
    apiVersion: 1,
    description: 'Test',
    permissions: '[]',
    contributes: '{}',
    frontendEntry: 'index.js',
    backendEntry: null,
    installPath: '/tmp/plugin',
    installedAt: 0,
    isBuiltin: false,
  }
}

describe('pluginRegistry', () => {
  beforeEach(() => {
    installPluginMock.mockReset()
    uninstallPluginIpcMock.mockReset()
    getEnabledPluginsMock.mockReset()
    fsReadFileMock.mockReset()
    pluginInvokeMock.mockReset()
    getPluginStorageMock.mockReset()
    setPluginStorageMock.mockReset()
    loadPluginFrontendMock.mockReset()
    activatePluginLoaderMock.mockReset()
    deactivatePluginLoaderMock.mockReset()
    isPluginLoadedMock.mockReset()
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
  })

  it('installPluginFromManifest validates and installs', async () => {
    installPluginMock.mockResolvedValue(undefined)
    const manifest = makeManifest()
    await installPluginFromManifest(manifest, '/plugins/test-plugin')
    expect(installPluginMock).toHaveBeenCalledOnce()
    const call = installPluginMock.mock.calls[0][0]
    expect(call.id).toBe('test-plugin')
    expect(call.frontendEntry).toBe('index.js')
    const map = get(installedPlugins)
    expect(map.has('test-plugin')).toBe(true)
  })

  it('installPluginFromManifest rejects unsupported apiVersion', async () => {
    const manifest = makeManifest({ apiVersion: 999 })
    await expect(installPluginFromManifest(manifest, '/plugins/test')).rejects.toThrow(
      'Unsupported API version'
    )
    expect(installPluginMock).not.toHaveBeenCalled()
  })

  it('uninstallPlugin removes from store', async () => {
    uninstallPluginIpcMock.mockResolvedValue(undefined)
    isPluginLoadedMock.mockReturnValue(false)
    installedPlugins.set(new Map([['test-plugin', { manifest: makeManifest(), state: 'installed', error: null }]]))
    await uninstallPlugin('test-plugin')
    expect(uninstallPluginIpcMock).toHaveBeenCalledWith('test-plugin')
    expect(get(installedPlugins).has('test-plugin')).toBe(false)
  })

  it('installPluginFromNpm throws not implemented', async () => {
    await expect(installPluginFromNpm('some-package')).rejects.toThrow('Not implemented: NPM install')
  })

  it('loadEnabledForProject populates enabled set', async () => {
    getEnabledPluginsMock.mockResolvedValue([makeNormalized('pa'), makeNormalized('pb')])
    await registryLoadEnabledForProject('proj1')
    const set = get(enabledPluginIds)
    expect(set.has('pa')).toBe(true)
    expect(set.has('pb')).toBe(true)
  })

  it('activatePlugin loads frontend and activates', async () => {
    const manifest = makeManifest()
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: {}, activationResult: null })
    activatePluginLoaderMock.mockResolvedValue({ contributions: {} })
    pluginInvokeMock.mockResolvedValue('backend-result')
    getPluginStorageMock.mockResolvedValue('stored-value')
    setPluginStorageMock.mockResolvedValue(undefined)

    const result = await activatePlugin('test-plugin')

    expect(result).toBe(true)
    expect(loadPluginFrontendMock).toHaveBeenCalledWith('test-plugin', 'index.js')
    expect(activatePluginLoaderMock).toHaveBeenCalledOnce()
    const [calledId, calledCtx] = activatePluginLoaderMock.mock.calls[0]
    expect(calledId).toBe('test-plugin')
    expect(calledCtx).toBeDefined()

    await expect(calledCtx.invokeBackend('ping', { ok: true })).resolves.toBe('backend-result')
    expect(pluginInvokeMock).toHaveBeenCalledWith('test-plugin', 'ping', { ok: true })

    await expect(calledCtx.storage.get('plugin-key')).resolves.toBe('stored-value')
    expect(getPluginStorageMock).toHaveBeenCalledWith('test-plugin', 'plugin-key')

    await calledCtx.storage.set('plugin-key', 'plugin-value')
    expect(setPluginStorageMock).toHaveBeenCalledWith('test-plugin', 'plugin-key', 'plugin-value')
  })

  it('activatePlugin exposes a host context command surface and real event subscription', async () => {
    const manifest = makeManifest()
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: {}, activationResult: null })

    activatePluginLoaderMock.mockImplementation(async (_pluginId, _context) => {
      return { contributions: {} }
    })

    await activatePlugin('test-plugin')

    const activationCall = activatePluginLoaderMock.mock.calls[0]
    expect(activationCall).toBeDefined()
    const context = activationCall?.[1]
    if (context === undefined) {
      throw new Error('Expected plugin context to be passed to activatePluginLoader')
    }

    await expect(context.invokeHost('getContext')).resolves.toEqual({
      activeProjectId: null,
      currentView: 'board',
      selectedTaskId: null,
    })

    const handler = vi.fn()
    const unsubscribe = context.onEvent('selection-changed', handler)
    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-123' })
    expect(handler).toHaveBeenCalledWith({ selectedTaskId: 'T-123' })

    unsubscribe?.()
    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-456' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('activatePlugin returns false for plugin not in store', async () => {
    const result = await activatePlugin('nonexistent-plugin')
    expect(result).toBe(false)
    expect(loadPluginFrontendMock).not.toHaveBeenCalled()
  })

  it('uninstallPlugin deactivates active plugin first', async () => {
    uninstallPluginIpcMock.mockResolvedValue(undefined)
    deactivatePluginLoaderMock.mockResolvedValue(undefined)
    isPluginLoadedMock.mockReturnValue(true)
    installedPlugins.set(new Map([['test-plugin', { manifest: makeManifest(), state: 'active', error: null }]]))

    await uninstallPlugin('test-plugin')

    expect(deactivatePluginLoaderMock).toHaveBeenCalledWith('test-plugin')
    expect(uninstallPluginIpcMock).toHaveBeenCalledWith('test-plugin')
    // deactivate must happen before uninstall IPC
    const deactivateOrder = deactivatePluginLoaderMock.mock.invocationCallOrder[0]
    const uninstallOrder = uninstallPluginIpcMock.mock.invocationCallOrder[0]
    expect(deactivateOrder).toBeLessThan(uninstallOrder)
  })

  it('installPluginFromManifest with corrupt manifest rejects with validation error', async () => {
    const highVersion = makeManifest({ apiVersion: 99 })
    await expect(installPluginFromManifest(highVersion, '/tmp')).rejects.toThrow('Unsupported API version: 99')
    expect(installPluginMock).not.toHaveBeenCalled()
  })

  it('installFromLocal reads manifest via IPC and installs', async () => {
    installPluginMock.mockResolvedValue(undefined)
    const manifest = makeManifest()
    fsReadFileMock.mockResolvedValue({ content: JSON.stringify(manifest), path: '/plugins/test/manifest.json' })

    await installFromLocal('/plugins/test', 'project-1')

    expect(fsReadFileMock).toHaveBeenCalledWith('project-1', '/plugins/test/manifest.json')
    expect(installPluginMock).toHaveBeenCalledOnce()
    expect(get(installedPlugins).has('test-plugin')).toBe(true)
  })
})
