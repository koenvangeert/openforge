import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

const {
  forceGithubSyncMock,
  installPluginMock,
  getPluginIpcMock,
  listPluginsMock,
  installPluginFromGitIpcMock,
  installPluginFromLocalIpcMock,
  installPluginFromNpmIpcMock,
  uninstallPluginIpcMock,
  getEnabledPluginsMock,
  pluginInvokeMock,
  getPluginStorageMock,
  setPluginStorageMock,
  deletePluginStorageMock,
  spawnShellPtyMock,
} = vi.hoisted(() => ({
  forceGithubSyncMock: vi.fn(),
  installPluginMock: vi.fn(),
  getPluginIpcMock: vi.fn(),
  listPluginsMock: vi.fn(),
  installPluginFromGitIpcMock: vi.fn(),
  installPluginFromLocalIpcMock: vi.fn(),
  installPluginFromNpmIpcMock: vi.fn(),
  uninstallPluginIpcMock: vi.fn(),
  getEnabledPluginsMock: vi.fn(),
  pluginInvokeMock: vi.fn(),
  getPluginStorageMock: vi.fn(),
  setPluginStorageMock: vi.fn(),
  deletePluginStorageMock: vi.fn(),
  spawnShellPtyMock: vi.fn(),
}))

vi.mock('../ipc', () => ({
  forceGithubSync: forceGithubSyncMock,
  installPlugin: installPluginMock,
  uninstallPlugin: uninstallPluginIpcMock,
  getEnabledPlugins: getEnabledPluginsMock,
  getPlugin: getPluginIpcMock,
  listPlugins: listPluginsMock,
  setPluginEnabled: vi.fn(),
  installPluginFromGit: installPluginFromGitIpcMock,
  installPluginFromLocal: installPluginFromLocalIpcMock,
  installPluginFromNpm: installPluginFromNpmIpcMock,
  pluginInvoke: pluginInvokeMock,
  getPluginStorage: getPluginStorageMock,
  setPluginStorage: setPluginStorageMock,
  deletePluginStorage: deletePluginStorageMock,
  spawnShellPty: spawnShellPtyMock,
}))

const {
  loadPluginFrontendMock,
  activatePluginLoaderMock,
  deactivatePluginLoaderMock,
  isPluginLoadedMock,
  getBuiltinPluginModuleMock,
} = vi.hoisted(() => ({
  loadPluginFrontendMock: vi.fn(),
  activatePluginLoaderMock: vi.fn(),
  deactivatePluginLoaderMock: vi.fn(),
  isPluginLoadedMock: vi.fn(),
  getBuiltinPluginModuleMock: vi.fn(),
}))

vi.mock('./pluginLoader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pluginLoader')>()

  return {
    ...actual,
    loadPluginFrontend: loadPluginFrontendMock,
    activatePlugin: activatePluginLoaderMock,
    deactivatePlugin: deactivatePluginLoaderMock,
    isPluginLoaded: isPluginLoadedMock,
  }
})

const {
  listenDesktopEventMock,
  desktopEventHandlers,
} = vi.hoisted(() => ({
  listenDesktopEventMock: vi.fn(),
  desktopEventHandlers: new Map<string, (event: { payload: unknown }) => void>(),
}))

vi.mock('../desktopIpc', () => ({
  listenDesktopEvent: listenDesktopEventMock,
}))

vi.mock('./builtinPluginModules', () => ({
  getBuiltinPluginModule: getBuiltinPluginModuleMock,
}))

import {
  deactivatePluginById,
  emitPluginHostEvent,
  executePluginCommand,
  initializePluginRuntime,
  installPluginFromManifest,
  installPluginFromGit,
  installPluginFromNpm,
  uninstallPlugin,
  loadEnabledForProject as registryLoadEnabledForProject,
  activatePlugin,
  installFromLocal,
  getPluginRenderProps,
  enablePluginForProject,
  disablePluginForProject,
  reloadPluginForProject,
} from './pluginRegistry'
import { installedPlugins, enabledPluginIds } from './pluginStore'
import type { PluginManifest } from './types'
import type { NormalizedPluginRow } from '../ipc'
import { clearComponentRegistry, getRegisteredComponent, getRegisteredRenderableComponent } from './componentRegistry'

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
    sourceKind: 'legacy',
    sourceSpec: '',
    packageMetadata: '{}',
    installedAt: 0,
    isBuiltin: false,
  }
}

describe('pluginRegistry', () => {
  beforeEach(() => {
    installPluginMock.mockReset()
    forceGithubSyncMock.mockReset()
    getPluginIpcMock.mockReset()
    listPluginsMock.mockReset()
    listPluginsMock.mockResolvedValue([])
    installPluginFromGitIpcMock.mockReset()
    installPluginFromLocalIpcMock.mockReset()
    installPluginFromNpmIpcMock.mockReset()
    uninstallPluginIpcMock.mockReset()
    getEnabledPluginsMock.mockReset()
    pluginInvokeMock.mockReset()
    getPluginStorageMock.mockReset()
    setPluginStorageMock.mockReset()
    deletePluginStorageMock.mockReset()
    spawnShellPtyMock.mockReset()
    listenDesktopEventMock.mockReset()
    desktopEventHandlers.clear()
    listenDesktopEventMock.mockImplementation(async (event: string, handler: (event: { payload: unknown }) => void) => {
      desktopEventHandlers.set(event, handler)
      return vi.fn()
    })
    loadPluginFrontendMock.mockReset()
    activatePluginLoaderMock.mockReset()
    deactivatePluginLoaderMock.mockReset()
    isPluginLoadedMock.mockReset()
    getBuiltinPluginModuleMock.mockReset()
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

  it('installPluginFromManifest allows backend-only command plugins', async () => {
    installPluginMock.mockResolvedValue(undefined)
    const manifest = makeManifest({
      frontend: null,
      backend: 'backend.js',
      contributes: {
        commands: [{ id: 'echo', title: 'Echo' }],
      },
    })

    await installPluginFromManifest(manifest, '/plugins/test')

    expect(installPluginMock).toHaveBeenCalledOnce()
    const call = installPluginMock.mock.calls[0][0]
    expect(call.frontendEntry).toBe('')
    expect(call.backendEntry).toBe('backend.js')
  })

  it('installPluginFromManifest rejects plugins with no executable integration entry', async () => {
    const manifest = makeManifest({ frontend: null, backend: null })

    await expect(installPluginFromManifest(manifest, '/plugins/test')).rejects.toThrow(
      'External plugins require a frontend or backend entry'
    )
    expect(installPluginMock).not.toHaveBeenCalled()
  })

  it('installPluginFromManifest rejects frontendless plugins with renderable contributions', async () => {
    const manifest = makeManifest({
      frontend: null,
      backend: 'backend.js',
      contributes: {
        views: [{ id: 'main', title: 'Main', icon: 'plug' }],
      },
    })

    await expect(installPluginFromManifest(manifest, '/plugins/test')).rejects.toThrow(
      'Renderable plugin contributions require a frontend entry'
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

  it('installPluginFromNpm installs app-wide through IPC without enabling the project', async () => {
    installPluginFromNpmIpcMock.mockResolvedValue({
      ...makeNormalized('npm-plugin'),
      sourceKind: 'npm',
      sourceSpec: 'npm:@acme/plugin@1.0.0',
    })

    await installPluginFromNpm('@acme/plugin@1.0.0')

    expect(installPluginFromNpmIpcMock).toHaveBeenCalledWith('@acme/plugin@1.0.0')
    const entry = get(installedPlugins).get('npm-plugin')
    expect(entry?.installPath).toBe('/tmp/plugin')
    expect(entry?.sourceKind).toBe('npm')
    expect(entry?.sourceSpec).toBe('npm:@acme/plugin@1.0.0')
    expect(get(enabledPluginIds).has('npm-plugin')).toBe(false)
  })

  it('installPluginFromGit installs app-wide through IPC without enabling the project', async () => {
    installPluginFromGitIpcMock.mockResolvedValue({
      ...makeNormalized('git-plugin'),
      sourceKind: 'git',
      sourceSpec: 'git:github.com/acme/openforge-tools@main',
    })

    await installPluginFromGit('github.com/acme/openforge-tools@main')

    expect(installPluginFromGitIpcMock).toHaveBeenCalledWith('github.com/acme/openforge-tools@main')
    expect(get(installedPlugins).get('git-plugin')).toMatchObject({
      sourceKind: 'git',
      sourceSpec: 'git:github.com/acme/openforge-tools@main',
      state: 'installed',
    })
    expect(get(enabledPluginIds).has('git-plugin')).toBe(false)
  })

  it('loadEnabledForProject populates enabled set', async () => {
    getEnabledPluginsMock.mockResolvedValue([makeNormalized('pa'), makeNormalized('pb')])
    await registryLoadEnabledForProject('proj1')
    const set = get(enabledPluginIds)
    expect(set.has('pa')).toBe(true)
    expect(set.has('pb')).toBe(true)
  })

  it('activates backend-only command plugins with backend RPC handlers', async () => {
    const manifest = makeManifest({
      frontend: null,
      backend: 'backend.js',
      contributes: {
        commands: [{ id: 'echo', title: 'Echo' }],
      },
    })
    installedPlugins.set(new Map([['backend-plugin', { manifest: { ...manifest, id: 'backend-plugin' }, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['backend-plugin']))
    pluginInvokeMock.mockResolvedValue({ echoed: true })

    await expect(executePluginCommand('backend-plugin', 'echo', { message: 'hello' })).resolves.toBe(true)

    expect(loadPluginFrontendMock).not.toHaveBeenCalled()
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
    expect(pluginInvokeMock).toHaveBeenCalledWith('backend-plugin', 'echo', { message: 'hello' })
    expect(get(installedPlugins).get('backend-plugin')?.state).toBe('active')
  })

  it('deactivates backend-only plugins back to installed state', async () => {
    const manifest = makeManifest({
      frontend: null,
      backend: 'backend.js',
      contributes: {
        commands: [{ id: 'echo', title: 'Echo' }],
      },
    })
    installedPlugins.set(new Map([['backend-plugin', { manifest: { ...manifest, id: 'backend-plugin' }, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['backend-plugin']))
    pluginInvokeMock.mockResolvedValue({ echoed: true })

    await expect(executePluginCommand('backend-plugin', 'echo', { message: 'hello' })).resolves.toBe(true)
    await deactivatePluginById('backend-plugin')

    expect(deactivatePluginLoaderMock).not.toHaveBeenCalled()
    expect(get(installedPlugins).get('backend-plugin')).toMatchObject({
      state: 'installed',
      error: null,
    })
  })

  it('activatePlugin loads frontend and activates', async () => {
    const manifest = makeManifest()
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: {}, activationResult: null })
    activatePluginLoaderMock.mockResolvedValue({ contributions: {} })
    pluginInvokeMock.mockResolvedValue('backend-result')
    getPluginStorageMock.mockResolvedValue({ stored: true })
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

    await expect(calledCtx.storage.global.get('plugin-key')).resolves.toEqual({ stored: true })
    expect(getPluginStorageMock).toHaveBeenCalledWith('test-plugin', 'global', null, 'plugin-key')

    await calledCtx.storage.project('P-1').set('plugin-key', { plugin: 'value' })
    expect(setPluginStorageMock).toHaveBeenCalledWith('test-plugin', 'project', 'P-1', 'plugin-key', { plugin: 'value' })
  })

  it('activates defineFrontendPlugin package entries through plugin:// assets and runtime registries', async () => {
    const LazyView = vi.fn() as never
    const commandHandler = vi.fn(async () => ({ ok: true }))
    const activateFrontend = vi.fn((openforge, context) => {
      context.subscriptions.add(openforge.views.register({
        id: 'prs',
        title: 'Pull Requests',
        icon: 'git-pull-request',
        placement: 'rail',
        order: 25,
        component: () => Promise.resolve({ default: LazyView }),
      }))
      context.subscriptions.add(openforge.taskPane.registerTab({
        id: 'activity',
        title: 'Activity',
        component: LazyView,
      }))
      context.subscriptions.add(openforge.settings.registerSection({
        id: 'prefs',
        title: 'Preferences',
        component: LazyView,
      }))
      context.subscriptions.add(openforge.commands.register({
        id: 'refresh',
        title: 'Refresh',
        handler: commandHandler,
      }))
    })
    const frontendPlugin = defineFrontendPlugin({ activate: activateFrontend })
    const manifest = makeManifest({
      id: 'runtime-plugin',
      frontend: './dist/frontend.js',
      contributes: {},
    })

    installedPlugins.set(new Map([['runtime-plugin', {
      manifest,
      state: 'installed',
      error: null,
      packageMetadata: {
        id: 'runtime-plugin',
        apiVersion: 1,
        displayName: 'Runtime Plugin',
        description: 'Runtime plugin',
        frontend: './dist/frontend.js',
      },
    }]]))
    enabledPluginIds.set(new Set(['runtime-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'runtime-plugin', module: frontendPlugin, activationResult: null })

    await expect(activatePlugin('runtime-plugin')).resolves.toBe(true)

    expect(loadPluginFrontendMock).toHaveBeenCalledWith('runtime-plugin', 'plugin://runtime-plugin/dist/frontend.js')
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
    expect(activateFrontend).toHaveBeenCalledOnce()
    expect(get(installedPlugins).get('runtime-plugin')?.manifest.contributes.views).toMatchObject([
      { id: 'prs', title: 'Pull Requests', icon: 'git-pull-request', showInRail: true, railOrder: 25 },
    ])
    expect(getRegisteredComponent('plugin:runtime-plugin:prs')).toBeDefined()
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'runtime-plugin:activity')).toBeDefined()
    expect(getRegisteredRenderableComponent('settingsSections', 'runtime-plugin:prefs')).toBeDefined()
    await expect(executePluginCommand('runtime-plugin', 'refresh', { source: 'test' })).resolves.toBe(true)
    expect(commandHandler).toHaveBeenCalledWith({ source: 'test' })

    const firstProps = getPluginRenderProps('runtime-plugin', { projectId: 'P-1', taskId: 'T-1' })
    const secondProps = getPluginRenderProps('runtime-plugin', { projectId: 'P-1', taskId: 'T-2' })
    expect(firstProps.api).toBe(secondProps.api)
    expect(firstProps.context).toEqual({ pluginId: 'runtime-plugin', projectId: 'P-1', taskId: 'T-1' })
    expect(secondProps.context).toEqual({ pluginId: 'runtime-plugin', projectId: 'P-1', taskId: 'T-2' })
    expect(secondProps.api.context.getSnapshot()).toEqual({ pluginId: 'runtime-plugin', projectId: null })

    await firstProps.api.storage.task('T-1').set('reviewState', { viewedFiles: ['README.md'] })
    expect(setPluginStorageMock).toHaveBeenCalledWith('runtime-plugin', 'task', 'T-1', 'reviewState', { viewedFiles: ['README.md'] })
    getPluginStorageMock.mockResolvedValueOnce({ owner: 'acme', name: 'app' })
    await expect(firstProps.api.storage.project('P-1').get('repo')).resolves.toEqual({ owner: 'acme', name: 'app' })
    expect(getPluginStorageMock).toHaveBeenCalledWith('runtime-plugin', 'project', 'P-1', 'repo')

    const otherSlotProps = getPluginRenderProps('runtime-plugin', { projectId: 'P-2', taskId: 'T-99' })
    expect(firstProps.context).toEqual({ pluginId: 'runtime-plugin', projectId: 'P-1', taskId: 'T-1' })
    expect(otherSlotProps.context).toEqual({ pluginId: 'runtime-plugin', projectId: 'P-2', taskId: 'T-99' })
    expect(firstProps.api.context.getSnapshot()).toEqual({ pluginId: 'runtime-plugin', projectId: null })
  })

  it('activates package plugins immediately when enabling and deactivates them when disabling', async () => {
    const RuntimeView = vi.fn() as never
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({
          id: 'main',
          title: 'Main View',
          icon: 'sparkles',
          placement: 'rail',
          component: RuntimeView,
        }))
      },
    })
    const manifest = makeManifest({ id: 'enable-runtime-plugin', frontend: './dist/frontend.js', contributes: {} })
    installedPlugins.set(new Map([['enable-runtime-plugin', {
      manifest,
      state: 'installed',
      error: null,
      packageMetadata: {
        id: 'enable-runtime-plugin',
        apiVersion: 1,
        displayName: 'Enable Runtime Plugin',
        description: 'Runtime package plugin',
        frontend: './dist/frontend.js',
      },
    }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'enable-runtime-plugin', module: frontendPlugin, activationResult: null })

    await expect(enablePluginForProject('P-1', 'enable-runtime-plugin')).resolves.toBe(true)

    expect(get(enabledPluginIds)).toEqual(new Set(['enable-runtime-plugin']))
    expect(get(installedPlugins).get('enable-runtime-plugin')?.state).toBe('active')
    expect(get(installedPlugins).get('enable-runtime-plugin')?.manifest.contributes.views).toMatchObject([
      { id: 'main', title: 'Main View' },
    ])

    await disablePluginForProject('P-1', 'enable-runtime-plugin')

    expect(get(enabledPluginIds)).toEqual(new Set())
    expect(get(installedPlugins).get('enable-runtime-plugin')?.state).toBe('installed')
    expect(get(installedPlugins).get('enable-runtime-plugin')?.manifest.contributes).toEqual({})
  })

  it('activates builtin plugin modules inside the host bundle instead of loading plugin:// frontend bundles', async () => {
    const Component = {} as never
    const deactivateBuiltin = vi.fn(async () => undefined)
    const manifest = makeManifest({ id: 'builtin-plugin' })
    installedPlugins.set(new Map([['builtin-plugin', { manifest, state: 'installed', error: null, isBuiltin: true }]]))
    enabledPluginIds.set(new Set(['builtin-plugin']))
    getBuiltinPluginModuleMock.mockReturnValue({
      activate: vi.fn(async () => ({ contributions: { views: [{ id: 'main', component: Component }] } })),
      deactivate: deactivateBuiltin,
    })

    await expect(activatePlugin('builtin-plugin')).resolves.toBe(true)

    expect(getBuiltinPluginModuleMock).toHaveBeenCalledWith('builtin-plugin')
    expect(loadPluginFrontendMock).not.toHaveBeenCalled()
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
    expect(getRegisteredComponent('plugin:builtin-plugin:main')).toBe(Component)
    expect(get(installedPlugins).get('builtin-plugin')?.state).toBe('active')

    await deactivatePluginById('builtin-plugin')

    expect(deactivateBuiltin).toHaveBeenCalledOnce()
    expect(deactivatePluginLoaderMock).not.toHaveBeenCalled()
    expect(getRegisteredComponent('plugin:builtin-plugin:main')).toBeUndefined()
    expect(get(installedPlugins).get('builtin-plugin')?.state).toBe('installed')
  })

  it('activates runtime implementations for every supported contribution type', async () => {
    const tabComponent = {} as never
    const sidebarComponent = {} as never
    const settingsComponent = {} as never
    const commandHandler = vi.fn(async () => undefined)
    const startService = vi.fn(async () => undefined)
    const stopService = vi.fn(async () => undefined)

    installedPlugins.set(new Map([['test-plugin', { manifest: makeManifest(), state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: {}, activationResult: null })
    activatePluginLoaderMock.mockResolvedValue({
      contributions: {
        views: [{ id: 'main', component: {} as never }],
        taskPaneTabs: [{ id: 'activity', component: tabComponent }],
        sidebarPanels: [{ id: 'inspector', component: sidebarComponent }],
        settingsSections: [{ id: 'preferences', component: settingsComponent }],
        commands: [{ id: 'open-demo', execute: commandHandler }],
        backgroundServices: [{ id: 'sync', start: startService, stop: stopService }],
      },
    })

    await expect(activatePlugin('test-plugin')).resolves.toBe(true)

    expect(getRegisteredComponent('plugin:test-plugin:main')).toBeDefined()
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'test-plugin:activity')).toBe(tabComponent)
    expect(getRegisteredRenderableComponent('sidebarPanels', 'test-plugin:inspector')).toBe(sidebarComponent)
    expect(getRegisteredRenderableComponent('settingsSections', 'test-plugin:preferences')).toBe(settingsComponent)
    expect(startService).toHaveBeenCalledOnce()

    await expect(executePluginCommand('test-plugin', 'open-demo', { source: 'shortcut' })).resolves.toBe(true)
    expect(commandHandler).toHaveBeenCalledWith({ source: 'shortcut' })

    await deactivatePluginById('test-plugin')

    expect(stopService).toHaveBeenCalledOnce()
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'test-plugin:activity')).toBeUndefined()
    expect(getRegisteredRenderableComponent('sidebarPanels', 'test-plugin:inspector')).toBeUndefined()
    expect(getRegisteredRenderableComponent('settingsSections', 'test-plugin:preferences')).toBeUndefined()
  })

  it('rolls back runtime state when background service startup fails', async () => {
    const commandHandler = vi.fn(async () => undefined)
    const startService = vi.fn(async () => {
      throw new Error('service failed to start')
    })

    installedPlugins.set(new Map([['test-plugin', { manifest: makeManifest(), state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: {}, activationResult: null })
    deactivatePluginLoaderMock.mockResolvedValue(undefined)
    activatePluginLoaderMock.mockResolvedValue({
      contributions: {
        views: [{ id: 'main', component: {} as never }],
        commands: [{ id: 'open-demo', execute: commandHandler }],
        backgroundServices: [{ id: 'sync', start: startService }],
      },
    })

    await expect(activatePlugin('test-plugin')).resolves.toBe(false)

    expect(deactivatePluginLoaderMock).toHaveBeenCalledWith('test-plugin')
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBeUndefined()
    await expect(executePluginCommand('test-plugin', 'open-demo')).resolves.toBe(false)
    expect(get(installedPlugins).get('test-plugin')).toMatchObject({
      state: 'error',
      error: 'service failed to start',
    })
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
    forceGithubSyncMock.mockResolvedValue({ ok: true })
    await expect(context.invokeHost('forceGithubSync')).resolves.toEqual({ ok: true })
    expect(forceGithubSyncMock).toHaveBeenCalledOnce()

    const handler = vi.fn()
    const unsubscribe = context.onEvent('selection-changed', handler)
    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-123' })
    expect(handler).toHaveBeenCalledWith({ selectedTaskId: 'T-123' })

    unsubscribe?.()
    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-456' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('waits for terminal event listeners to be attached before spawning shell PTYs', async () => {
    const manifest = makeManifest()
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: {}, activationResult: null })
    spawnShellPtyMock.mockResolvedValue(42)

    let resolveOutputListen: ((unlisten: () => void) => void) | null = null
    let resolveExitListen: ((unlisten: () => void) => void) | null = null
    listenDesktopEventMock.mockImplementation((event: string, handler: (event: { payload: unknown }) => void) => {
      desktopEventHandlers.set(event, handler)
      return new Promise<() => void>((resolve) => {
        if (event === 'pty-output-T-1-shell-0') {
          resolveOutputListen = resolve
        } else if (event === 'pty-exit-T-1-shell-0') {
          resolveExitListen = resolve
        } else {
          resolve(() => undefined)
        }
      })
    })

    activatePluginLoaderMock.mockResolvedValue({ contributions: {} })
    await activatePlugin('test-plugin')
    const context = activatePluginLoaderMock.mock.calls[0]?.[1]
    if (context === undefined) {
      throw new Error('Expected plugin context to be passed to activatePluginLoader')
    }

    const outputHandler = vi.fn()
    context.onEvent('pty-output-T-1-shell-0', outputHandler)
    context.onEvent('pty-exit-T-1-shell-0', vi.fn())

    const spawn = context.invokeHost('spawnShellPty', {
      taskId: 'T-1',
      cwd: '/tmp/worktree',
      cols: 80,
      rows: 24,
      terminalIndex: 0,
    })
    await Promise.resolve()

    expect(spawnShellPtyMock).not.toHaveBeenCalled()

    const outputResolver = resolveOutputListen as ((unlisten: () => void) => void) | null
    if (!outputResolver) throw new Error('Expected output listener registration to be pending')
    outputResolver(() => undefined)
    await Promise.resolve()
    expect(spawnShellPtyMock).not.toHaveBeenCalled()

    const exitResolver = resolveExitListen as ((unlisten: () => void) => void) | null
    if (!exitResolver) throw new Error('Expected exit listener registration to be pending')
    exitResolver(() => undefined)
    await expect(spawn).resolves.toBe(42)
    expect(spawnShellPtyMock).toHaveBeenCalledWith('T-1', '/tmp/worktree', 80, 24, 0)

    desktopEventHandlers.get('pty-output-T-1-shell-0')?.({ payload: { data: 'hello' } })
    expect(outputHandler).toHaveBeenCalledWith({ data: 'hello' })
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

  it('uninstallPlugin tears down runtime contributions and background services', async () => {
    const stopService = vi.fn(async () => undefined)
    uninstallPluginIpcMock.mockResolvedValue(undefined)
    isPluginLoadedMock.mockReturnValue(true)
    deactivatePluginLoaderMock.mockResolvedValue(undefined)
    installedPlugins.set(new Map([['test-plugin', { manifest: makeManifest(), state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: {}, activationResult: null })
    activatePluginLoaderMock.mockResolvedValue({
      contributions: {
        taskPaneTabs: [{ id: 'activity', component: {} as never }],
        commands: [{ id: 'open-demo', execute: vi.fn(async () => undefined) }],
        backgroundServices: [{ id: 'sync', start: async () => undefined, stop: stopService }],
      },
    })

    await expect(activatePlugin('test-plugin')).resolves.toBe(true)
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'test-plugin:activity')).toBeDefined()

    await uninstallPlugin('test-plugin')

    expect(stopService).toHaveBeenCalledOnce()
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'test-plugin:activity')).toBeUndefined()
    await expect(executePluginCommand('test-plugin', 'open-demo')).resolves.toBe(false)
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

  it('installFromLocal reads package metadata via IPC and does not enable the project', async () => {
    installPluginFromLocalIpcMock.mockResolvedValue({
      ...makeNormalized('local-plugin'),
      sourceKind: 'local',
      sourceSpec: '/plugins/test',
    })

    await installFromLocal('/plugins/test', 'project-1')

    expect(installPluginFromLocalIpcMock).toHaveBeenCalledWith('/plugins/test')
    expect(get(installedPlugins).get('local-plugin')).toMatchObject({
      sourceKind: 'local',
      sourceSpec: '/plugins/test',
      state: 'installed',
    })
    expect(get(enabledPluginIds).has('local-plugin')).toBe(false)
  })

  it('reloadPluginForProject refreshes target metadata and preserves other active plugins', async () => {
    const reloadManifest = makeManifest({ id: 'reload-plugin' })
    const otherManifest = makeManifest({ id: 'other-plugin' })
    enabledPluginIds.set(new Set(['reload-plugin', 'other-plugin']))
    installedPlugins.set(new Map([
      ['reload-plugin', { manifest: reloadManifest, state: 'active', error: 'old error' }],
      ['other-plugin', { manifest: otherManifest, state: 'active', error: null }],
    ]))
    getPluginIpcMock.mockResolvedValue({
      ...makeNormalized('reload-plugin'),
      name: 'Reloaded Plugin',
      sourceKind: 'local',
      sourceSpec: '/plugins/reload-plugin',
    })
    getEnabledPluginsMock.mockResolvedValue([makeNormalized('reload-plugin'), makeNormalized('other-plugin')])
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'reload-plugin', module: {}, activationResult: null })
    deactivatePluginLoaderMock.mockResolvedValue(undefined)
    activatePluginLoaderMock.mockImplementation(async (pluginId: string) => {
      installedPlugins.update(map => {
        const entry = map.get(pluginId)
        if (!entry) return map
        const next = new Map(map)
        next.set(pluginId, { ...entry, state: 'active', error: null })
        return next
      })
      return { contributions: {} }
    })

    await expect(reloadPluginForProject('project-1', 'reload-plugin')).resolves.toBe(true)

    expect(deactivatePluginLoaderMock).toHaveBeenCalledWith('reload-plugin')
    expect(getPluginIpcMock).toHaveBeenCalledWith('reload-plugin')
    expect(getEnabledPluginsMock).toHaveBeenCalledWith('project-1')
    expect(activatePluginLoaderMock).toHaveBeenCalledOnce()
    expect(get(installedPlugins).get('reload-plugin')).toMatchObject({
      state: 'active',
      sourceKind: 'local',
      sourceSpec: '/plugins/reload-plugin',
    })
    expect(get(installedPlugins).get('other-plugin')).toMatchObject({
      state: 'active',
      error: null,
    })
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

  it('initializePluginRuntime installs builtin manifests without unused frontend bundle entries', async () => {
    installPluginMock.mockResolvedValue(undefined)

    await initializePluginRuntime()

    expect(installPluginMock).toHaveBeenCalled()
    expect(installPluginMock.mock.calls.every(([row]) => row.isBuiltin === true)).toBe(true)
    expect(installPluginMock.mock.calls.every(([row]) => row.frontendEntry === '')).toBe(true)
  })
})
