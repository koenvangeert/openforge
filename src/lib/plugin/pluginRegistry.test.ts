import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

const {
  installPluginMock,
  installPluginFromLocalIpcMock,
  installPluginFromNpmIpcMock,
  uninstallPluginIpcMock,
  getEnabledPluginsMock,
  pluginInvokeMock,
  getPluginStorageMock,
  setPluginStorageMock,
} = vi.hoisted(() => ({
  installPluginMock: vi.fn(),
  installPluginFromLocalIpcMock: vi.fn(),
  installPluginFromNpmIpcMock: vi.fn(),
  uninstallPluginIpcMock: vi.fn(),
  getEnabledPluginsMock: vi.fn(),
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
  installPluginFromLocal: installPluginFromLocalIpcMock,
  installPluginFromNpm: installPluginFromNpmIpcMock,
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
  deactivatePluginById,
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
import { clearComponentRegistry, getRegisteredComponent } from './componentRegistry'

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
    installPluginFromLocalIpcMock.mockReset()
    installPluginFromNpmIpcMock.mockReset()
    uninstallPluginIpcMock.mockReset()
    getEnabledPluginsMock.mockReset()
    pluginInvokeMock.mockReset()
    getPluginStorageMock.mockReset()
    setPluginStorageMock.mockReset()
    loadPluginFrontendMock.mockReset()
    activatePluginLoaderMock.mockReset()
    deactivatePluginLoaderMock.mockReset()
    isPluginLoadedMock.mockReset()
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    clearComponentRegistry()
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

  it('installPluginFromNpm installs through IPC and updates the store', async () => {
    installPluginFromNpmIpcMock.mockResolvedValue(makeNormalized('npm-plugin'))

    await installPluginFromNpm('some-package')

    expect(installPluginFromNpmIpcMock).toHaveBeenCalledWith('some-package')
    expect(get(installedPlugins).get('npm-plugin')?.installPath).toBe('/tmp/plugin')
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
    expect(loadPluginFrontendMock).toHaveBeenCalledWith('test-plugin', 'plugin://test-plugin/index.js')
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

  it('deactivatePluginById clears host event subscriptions and unregisters view components for the plugin', async () => {
    const manifest = makeManifest()
    const Component = {} as never
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: {}, activationResult: null })
    deactivatePluginLoaderMock.mockResolvedValue(undefined)

    activatePluginLoaderMock.mockImplementation(async (_pluginId, _context) => {
      return { contributions: { views: [{ id: 'main', component: Component }] } }
    })

    await activatePlugin('test-plugin')

    const context = activatePluginLoaderMock.mock.calls[0]?.[1]
    if (context === undefined) {
      throw new Error('Expected plugin context to be passed to activatePluginLoader')
    }

    const handler = vi.fn()
    context.onEvent('selection-changed', handler)
    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-123' })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBe(Component)

    await deactivatePluginById('test-plugin')
    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-456' })

    expect(deactivatePluginLoaderMock).toHaveBeenCalledWith('test-plugin')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBeUndefined()
  })

  it('uninstallPlugin clears host event subscriptions for loaded plugins', async () => {
    const manifest = makeManifest()
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: {}, activationResult: null })
    deactivatePluginLoaderMock.mockResolvedValue(undefined)
    uninstallPluginIpcMock.mockResolvedValue(undefined)
    isPluginLoadedMock.mockReturnValueOnce(false).mockReturnValue(true)

    activatePluginLoaderMock.mockImplementation(async (_pluginId, _context) => {
      return { contributions: {} }
    })

    await activatePlugin('test-plugin')

    const context = activatePluginLoaderMock.mock.calls[0]?.[1]
    if (context === undefined) {
      throw new Error('Expected plugin context to be passed to activatePluginLoader')
    }

    const handler = vi.fn()
    context.onEvent('selection-changed', handler)
    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-123' })
    expect(handler).toHaveBeenCalledTimes(1)

    await uninstallPlugin('test-plugin')
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
    installPluginFromLocalIpcMock.mockResolvedValue(makeNormalized('local-plugin'))

    await installFromLocal('/plugins/test', 'project-1')

    expect(installPluginFromLocalIpcMock).toHaveBeenCalledWith('/plugins/test')
    expect(get(installedPlugins).has('local-plugin')).toBe(true)
  })

  it('activatePlugin dedupes concurrent activation for the same plugin', async () => {
    const manifest = makeManifest()
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: {}, activationResult: null })
    let resolveActivation: (() => void) | undefined
    activatePluginLoaderMock.mockImplementation(() => new Promise(resolve => {
      resolveActivation = () => resolve({ contributions: {} })
    }))

    const first = activatePlugin('test-plugin')
    const second = activatePlugin('test-plugin')
    await Promise.resolve()
    resolveActivation?.()

    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    expect(activatePluginLoaderMock).toHaveBeenCalledTimes(1)
  })

  it('disabling a plugin reconciles active lifecycle state and unregisters its views', async () => {
    const manifest = makeManifest()
    const Component = {} as never
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: {}, activationResult: null })
    activatePluginLoaderMock.mockResolvedValue({ contributions: { views: [{ id: 'main', component: Component }] } })
    deactivatePluginLoaderMock.mockResolvedValue(undefined)

    await expect(activatePlugin('test-plugin')).resolves.toBe(true)
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'active', error: null }]]))
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBe(Component)

    enabledPluginIds.set(new Set())
    await Promise.resolve()
    await Promise.resolve()

    expect(deactivatePluginLoaderMock).toHaveBeenCalledWith('test-plugin')
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBeUndefined()
  })
})
