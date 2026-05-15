import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import type { FrontendOpenForgeAPI } from '@openforge/plugin-sdk/frontend'
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
  pluginBackendWhenReadyMock,
  getPluginStorageMock,
  setPluginStorageMock,
  deletePluginStorageMock,
  spawnShellPtyMock,
  openUrlMock,
  fsReadDirMock,
  fsReadFileMock,
  fsSearchFilesMock,
  getConfigMock,
  setConfigMock,
  getProjectConfigMock,
  setProjectConfigMock,
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
  pluginBackendWhenReadyMock: vi.fn(),
  getPluginStorageMock: vi.fn(),
  setPluginStorageMock: vi.fn(),
  deletePluginStorageMock: vi.fn(),
  spawnShellPtyMock: vi.fn(),
  openUrlMock: vi.fn(),
  fsReadDirMock: vi.fn(),
  fsReadFileMock: vi.fn(),
  fsSearchFilesMock: vi.fn(),
  getConfigMock: vi.fn(),
  setConfigMock: vi.fn(),
  getProjectConfigMock: vi.fn(),
  setProjectConfigMock: vi.fn(),
}))

vi.mock('../ipc', () => ({
  forceGithubSync: forceGithubSyncMock,
  registerBuiltinPlugin: installPluginMock,
  uninstallPlugin: uninstallPluginIpcMock,
  getEnabledPlugins: getEnabledPluginsMock,
  getPlugin: getPluginIpcMock,
  listPlugins: listPluginsMock,
  setPluginEnabled: vi.fn(),
  installPluginFromGit: installPluginFromGitIpcMock,
  installPluginFromLocal: installPluginFromLocalIpcMock,
  installPluginFromNpm: installPluginFromNpmIpcMock,
  pluginInvoke: pluginInvokeMock,
  pluginBackendWhenReady: pluginBackendWhenReadyMock,
  getPluginStorage: getPluginStorageMock,
  setPluginStorage: setPluginStorageMock,
  deletePluginStorage: deletePluginStorageMock,
  spawnShellPty: spawnShellPtyMock,
  openUrl: openUrlMock,
  fsReadDir: fsReadDirMock,
  fsReadFile: fsReadFileMock,
  fsSearchFiles: fsSearchFilesMock,
  getConfig: getConfigMock,
  setConfig: setConfigMock,
  getProjectConfig: getProjectConfigMock,
  setProjectConfig: setProjectConfigMock,
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
import { installedPlugins, enabledPluginIds, runtimeContributionSources } from './pluginStore'
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
    pluginInvokeMock.mockResolvedValue(undefined)
    pluginBackendWhenReadyMock.mockReset()
    pluginBackendWhenReadyMock.mockResolvedValue(undefined)
    getPluginStorageMock.mockReset()
    setPluginStorageMock.mockReset()
    deletePluginStorageMock.mockReset()
    spawnShellPtyMock.mockReset()
    openUrlMock.mockReset()
    openUrlMock.mockResolvedValue(undefined)
    fsReadDirMock.mockReset()
    fsReadFileMock.mockReset()
    fsSearchFilesMock.mockReset()
    getConfigMock.mockReset()
    setConfigMock.mockReset()
    getProjectConfigMock.mockReset()
    setProjectConfigMock.mockReset()
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
    runtimeContributionSources.set(new Map())
    clearComponentRegistry()
  })

  it('installPluginFromManifest rejects legacy manifest installs loudly', async () => {
    const manifest = makeManifest()

    await expect(installPluginFromManifest(manifest, '/plugins/test-plugin')).rejects.toThrow(
      'Legacy manifest.json plugin installation is no longer supported'
    )
    expect(installPluginMock).not.toHaveBeenCalled()
    expect(get(installedPlugins).has('test-plugin')).toBe(false)
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

  it('does not synthesize backend command handlers from legacy manifest contributions', async () => {
    const manifest = makeManifest({ frontend: null, backend: 'backend.js' })
    installedPlugins.set(new Map([['backend-plugin', { manifest: { ...manifest, id: 'backend-plugin' }, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['backend-plugin']))
    pluginInvokeMock.mockResolvedValue({ echoed: true })

    await expect(executePluginCommand('backend-plugin', 'echo', { message: 'hello' })).resolves.toBe(false)

    expect(loadPluginFrontendMock).not.toHaveBeenCalled()
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
    expect(pluginInvokeMock).not.toHaveBeenCalled()
    expect(get(installedPlugins).get('backend-plugin')?.state).toBe('active')
  })

  it('deactivates backend-only plugins back to installed state', async () => {
    const manifest = makeManifest({
      frontend: null,
      backend: 'backend.js',
    })
    installedPlugins.set(new Map([['backend-plugin', { manifest: { ...manifest, id: 'backend-plugin' }, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['backend-plugin']))
    pluginInvokeMock.mockResolvedValue({ echoed: true })

    await expect(activatePlugin('backend-plugin')).resolves.toBe(true)
    await deactivatePluginById('backend-plugin')

    expect(deactivatePluginLoaderMock).not.toHaveBeenCalled()
    expect(get(installedPlugins).get('backend-plugin')).toMatchObject({
      state: 'installed',
      error: null,
    })
  })

  it('activatePlugin rejects legacy frontend activate(context) modules loudly', async () => {
    const manifest = makeManifest()
    const legacyModule = { activate: vi.fn() }
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: legacyModule })

    const result = await activatePlugin('test-plugin')

    expect(result).toBe(false)
    expect(loadPluginFrontendMock).toHaveBeenCalledWith('test-plugin', 'plugin://test-plugin/index.js')
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
    expect(legacyModule.activate).not.toHaveBeenCalled()
    expect(get(installedPlugins).get('test-plugin')).toMatchObject({
      state: 'error',
      error: 'Plugin test-plugin uses the legacy activate(context) API, which is no longer supported; export defineFrontendPlugin(...) and register contributions at runtime',
    })
  })

  it('activates defineFrontendPlugin package entries through plugin:// assets and runtime registries', async () => {
    const LazyView = vi.fn() as never
    const commandHandler = vi.fn(async () => ({ ok: true }))
    const capturedApis: FrontendOpenForgeAPI[] = []
    const backendStateDuringActivation: string[] = []
    const activateFrontend = vi.fn((openforge, context) => {
      capturedApis.push(openforge)
      backendStateDuringActivation.push(openforge.backend.state)
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
      backend: './dist/backend.js',
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
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'runtime-plugin', module: frontendPlugin })

    await expect(activatePlugin('runtime-plugin')).resolves.toBe(true)

    expect(loadPluginFrontendMock).toHaveBeenCalledWith('runtime-plugin', 'plugin://runtime-plugin/dist/frontend.js')
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
    expect(activateFrontend).toHaveBeenCalledOnce()
    expect(get(runtimeContributionSources).get('runtime-plugin')?.views).toMatchObject([
      { id: 'prs', title: 'Pull Requests', icon: 'git-pull-request', placement: 'rail', order: 25 },
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

    fsReadFileMock.mockResolvedValueOnce('readme')
    await expect(firstProps.api.fs.readFile({ projectId: 'P-1', path: 'README.md' })).resolves.toBe('readme')
    await firstProps.api.system.openUrl('https://example.com/plugin')
    await firstProps.api.config.set('theme', { mode: 'dark' })
    await firstProps.api.projectConfig.set('repo', { owner: 'acme', name: 'app' }, 'P-1')
    await firstProps.api.backend.whenReady()
    await expect(firstProps.api.backend.invoke('syncProject', { projectId: 'P-1' })).resolves.toBeUndefined()

    expect(backendStateDuringActivation).toEqual(['starting'])
    expect(capturedApis[0].backend.state).toBe('ready')
    expect(fsReadFileMock).toHaveBeenCalledWith('P-1', 'README.md')
    expect(openUrlMock).toHaveBeenCalledWith('https://example.com/plugin')
    expect(setConfigMock).toHaveBeenCalledWith('theme', '{"mode":"dark"}')
    expect(setProjectConfigMock).toHaveBeenCalledWith('P-1', 'repo', '{"owner":"acme","name":"app"}')
    expect(pluginBackendWhenReadyMock).toHaveBeenCalledWith('runtime-plugin')
    expect(pluginInvokeMock).toHaveBeenCalledWith('runtime-plugin', 'syncProject', { projectId: 'P-1' })

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
    const manifest = makeManifest({ id: 'enable-runtime-plugin', frontend: './dist/frontend.js' })
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
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'enable-runtime-plugin', module: frontendPlugin })

    await expect(enablePluginForProject('P-1', 'enable-runtime-plugin')).resolves.toBe(true)

    expect(get(enabledPluginIds)).toEqual(new Set(['enable-runtime-plugin']))
    expect(get(installedPlugins).get('enable-runtime-plugin')?.state).toBe('active')
    expect(get(runtimeContributionSources).get('enable-runtime-plugin')?.views).toMatchObject([
      { id: 'main', title: 'Main View' },
    ])

    await disablePluginForProject('P-1', 'enable-runtime-plugin')

    expect(get(enabledPluginIds)).toEqual(new Set())
    expect(get(installedPlugins).get('enable-runtime-plugin')?.state).toBe('installed')
    expect(get(runtimeContributionSources).get('enable-runtime-plugin')).toBeUndefined()
  })

  it('activates builtin defineFrontendPlugin modules inside the host bundle instead of loading plugin:// frontend bundles', async () => {
    const Component = vi.fn() as never
    const activateBuiltin = vi.fn((openforge, context) => {
      context.subscriptions.add(openforge.views.register({
        id: 'main',
        title: 'Builtin Main',
        icon: 'plug',
        placement: 'rail',
        component: Component,
      }))
    })
    const manifest = makeManifest({ id: 'builtin-plugin', frontend: './dist/frontend.js' })
    installedPlugins.set(new Map([['builtin-plugin', { manifest, state: 'installed', error: null, isBuiltin: true }]]))
    enabledPluginIds.set(new Set(['builtin-plugin']))
    getBuiltinPluginModuleMock.mockReturnValue(defineFrontendPlugin({ activate: activateBuiltin }))

    await expect(activatePlugin('builtin-plugin')).resolves.toBe(true)

    expect(getBuiltinPluginModuleMock).toHaveBeenCalledWith('builtin-plugin')
    expect(loadPluginFrontendMock).not.toHaveBeenCalled()
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
    expect(activateBuiltin).toHaveBeenCalledOnce()
    expect(get(runtimeContributionSources).get('builtin-plugin')?.views).toMatchObject([
      { id: 'main', title: 'Builtin Main', icon: 'plug', placement: 'rail' },
    ])
    expect(getRegisteredComponent('plugin:builtin-plugin:main')).toBe(Component)
    expect(get(installedPlugins).get('builtin-plugin')?.state).toBe('active')

    await deactivatePluginById('builtin-plugin')

    expect(deactivatePluginLoaderMock).not.toHaveBeenCalled()
    expect(getRegisteredComponent('plugin:builtin-plugin:main')).toBeUndefined()
    expect(get(installedPlugins).get('builtin-plugin')?.state).toBe('installed')
  })

  it('activates runtime implementations for supported frontend contribution types', async () => {
    const viewComponent = vi.fn() as never
    const tabComponent = vi.fn() as never
    const settingsComponent = vi.fn() as never
    const commandHandler = vi.fn(async () => undefined)
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({ id: 'main', title: 'Main', icon: 'sparkles', placement: 'rail', component: viewComponent }))
        context.subscriptions.add(openforge.taskPane.registerTab({ id: 'activity', title: 'Activity', component: tabComponent }))
        context.subscriptions.add(openforge.settings.registerSection({ id: 'preferences', title: 'Preferences', component: settingsComponent }))
        context.subscriptions.add(openforge.commands.register({ id: 'open-demo', title: 'Open demo', handler: commandHandler }))
      },
    })

    installedPlugins.set(new Map([['test-plugin', { manifest: makeManifest(), state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })

    await expect(activatePlugin('test-plugin')).resolves.toBe(true)

    expect(get(runtimeContributionSources).get('test-plugin')).toMatchObject({
      views: [{ id: 'main', title: 'Main' }],
      taskPaneTabs: [{ id: 'activity', title: 'Activity' }],
      settingsSections: [{ id: 'preferences', title: 'Preferences' }],
      commands: [{ id: 'open-demo', title: 'Open demo' }],
    })
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBe(viewComponent)
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'test-plugin:activity')).toBe(tabComponent)
    expect(getRegisteredRenderableComponent('settingsSections', 'test-plugin:preferences')).toBe(settingsComponent)

    await expect(executePluginCommand('test-plugin', 'open-demo', { source: 'shortcut' })).resolves.toBe(true)
    expect(commandHandler).toHaveBeenCalledWith({ source: 'shortcut' })

    await deactivatePluginById('test-plugin')

    expect(get(runtimeContributionSources).get('test-plugin')).toBeUndefined()
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'test-plugin:activity')).toBeUndefined()
    expect(getRegisteredRenderableComponent('settingsSections', 'test-plugin:preferences')).toBeUndefined()
  })

  it('rolls back runtime state when runtime registration validation fails', async () => {
    const viewComponent = vi.fn() as never
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({ id: 'main', title: 'Main', icon: 'sparkles', placement: 'rail', component: viewComponent }))
        context.subscriptions.add(openforge.commands.register({ id: 'open-demo', title: 'Open demo', handler: async () => undefined }))
        openforge.commands.register({ id: 'open-demo', title: 'Duplicate', handler: async () => undefined })
      },
    })

    installedPlugins.set(new Map([['test-plugin', { manifest: makeManifest(), state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })

    await expect(activatePlugin('test-plugin')).resolves.toBe(false)

    expect(deactivatePluginLoaderMock).not.toHaveBeenCalled()
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBeUndefined()
    expect(get(runtimeContributionSources).get('test-plugin')).toBeUndefined()
    await expect(executePluginCommand('test-plugin', 'open-demo')).resolves.toBe(false)
    expect(get(installedPlugins).get('test-plugin')).toMatchObject({
      state: 'error',
      error: 'Duplicate runtime contribution id: test-plugin.open-demo',
    })
  })

  it('activatePlugin exposes runtime context, storage, and host event subscription APIs', async () => {
    const handler = vi.fn()
    let capturedApi: FrontendOpenForgeAPI | null = null
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        capturedApi = openforge
        context.subscriptions.add(openforge.events.onGlobal('openforge.selection-changed', handler))
      },
    })
    const manifest = makeManifest()
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })
    getPluginStorageMock.mockResolvedValue({ stored: true })
    setPluginStorageMock.mockResolvedValue(undefined)

    await expect(activatePlugin('test-plugin')).resolves.toBe(true)

    const api = capturedApi as FrontendOpenForgeAPI | null
    if (api === null) {
      throw new Error('Expected runtime API to be passed to defineFrontendPlugin activate')
    }

    expect(api.context.getSnapshot()).toEqual({ pluginId: 'test-plugin', projectId: null })
    await expect(api.storage.global.get('plugin-key')).resolves.toEqual({ stored: true })
    expect(getPluginStorageMock).toHaveBeenCalledWith('test-plugin', 'global', null, 'plugin-key')

    await api.storage.project('P-1').set('plugin-key', { plugin: 'value' })
    expect(setPluginStorageMock).toHaveBeenCalledWith('test-plugin', 'project', 'P-1', 'plugin-key', { plugin: 'value' })

    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-123' })
    expect(handler).toHaveBeenCalledWith({ selectedTaskId: 'T-123' })

    await deactivatePluginById('test-plugin')
    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-456' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('waits for terminal event listeners to be attached before spawning shell PTYs', async () => {
    let spawn: Promise<number> | null = null
    const outputHandler = vi.fn()
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.events.onGlobal('openforge.pty-output-T-1-shell-0', outputHandler))
        context.subscriptions.add(openforge.events.onGlobal('openforge.pty-exit-T-1-shell-0', vi.fn()))
        spawn = openforge.shell.spawn({
          taskId: 'T-1',
          cwd: '/tmp/worktree',
          cols: 80,
          rows: 24,
          terminalIndex: 0,
        })
      },
    })
    const manifest = makeManifest()
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })
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

    await activatePlugin('test-plugin')
    await Promise.resolve()

    expect(spawn).not.toBeNull()
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

  it('deactivatePluginById clears runtime host event subscriptions and unregisters view components for the plugin', async () => {
    const manifest = makeManifest()
    const Component = vi.fn() as never
    const handler = vi.fn()
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({ id: 'main', title: 'Main', icon: 'sparkles', placement: 'rail', component: Component }))
        context.subscriptions.add(openforge.events.onGlobal('openforge.selection-changed', handler))
      },
    })
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })

    await activatePlugin('test-plugin')

    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-123' })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBe(Component)

    await deactivatePluginById('test-plugin')
    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-456' })

    expect(deactivatePluginLoaderMock).not.toHaveBeenCalled()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBeUndefined()
  })

  it('uninstallPlugin clears host event subscriptions for active runtime plugins', async () => {
    const manifest = makeManifest()
    const handler = vi.fn()
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.events.onGlobal('openforge.selection-changed', handler))
      },
    })
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })
    uninstallPluginIpcMock.mockResolvedValue(undefined)

    await activatePlugin('test-plugin')

    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-123' })
    expect(handler).toHaveBeenCalledTimes(1)

    await uninstallPlugin('test-plugin')
    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-456' })

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('uninstallPlugin tears down runtime contributions', async () => {
    uninstallPluginIpcMock.mockResolvedValue(undefined)
    const commandHandler = vi.fn(async () => undefined)
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.taskPane.registerTab({ id: 'activity', title: 'Activity', component: vi.fn() as never }))
        context.subscriptions.add(openforge.commands.register({ id: 'open-demo', title: 'Open demo', handler: commandHandler }))
      },
    })
    installedPlugins.set(new Map([['test-plugin', { manifest: makeManifest(), state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })

    await expect(activatePlugin('test-plugin')).resolves.toBe(true)
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'test-plugin:activity')).toBeDefined()

    await uninstallPlugin('test-plugin')

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

  it('installPluginFromManifest rejects every legacy manifest before validation compatibility paths run', async () => {
    const highVersion = makeManifest({ apiVersion: 99 })
    await expect(installPluginFromManifest(highVersion, '/tmp')).rejects.toThrow('Legacy manifest.json plugin installation is no longer supported')
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
    const frontendPlugin = defineFrontendPlugin({ activate: vi.fn(() => undefined) })
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'reload-plugin', module: frontendPlugin })
    deactivatePluginLoaderMock.mockResolvedValue(undefined)

    await expect(reloadPluginForProject('project-1', 'reload-plugin')).resolves.toBe(true)

    expect(deactivatePluginLoaderMock).toHaveBeenCalledWith('reload-plugin')
    expect(getPluginIpcMock).toHaveBeenCalledWith('reload-plugin')
    expect(getEnabledPluginsMock).toHaveBeenCalledWith('project-1')
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
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
    enabledPluginIds.set(new Set(['test-plugin']))
    const activateFrontend = vi.fn(() => undefined)
    const frontendPlugin = defineFrontendPlugin({ activate: activateFrontend })
    let resolveLoad: (() => void) | undefined
    loadPluginFrontendMock.mockReturnValue(new Promise(resolve => {
      resolveLoad = () => resolve({ pluginId: 'test-plugin', module: frontendPlugin })
    }))

    const first = activatePlugin('test-plugin')
    const second = activatePlugin('test-plugin')
    await Promise.resolve()
    expect(loadPluginFrontendMock).toHaveBeenCalledTimes(1)
    resolveLoad?.()

    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    expect(activateFrontend).toHaveBeenCalledTimes(1)
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
  })

  it('disabling a plugin reconciles active lifecycle state and unregisters its views', async () => {
    const manifest = makeManifest()
    const Component = vi.fn() as never
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({ id: 'main', title: 'Main', icon: 'sparkles', placement: 'rail', component: Component }))
      },
    })
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })
    deactivatePluginLoaderMock.mockResolvedValue(undefined)

    await expect(activatePlugin('test-plugin')).resolves.toBe(true)
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'active', error: null }]]))
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBe(Component)

    await disablePluginForProject('P-1', 'test-plugin')

    expect(deactivatePluginLoaderMock).not.toHaveBeenCalled()
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBeUndefined()
  })

  it('initializePluginRuntime installs builtin package metadata with built frontend entries', async () => {
    installPluginMock.mockResolvedValue(undefined)

    await initializePluginRuntime()

    expect(installPluginMock).toHaveBeenCalled()
    expect(installPluginMock.mock.calls.every(([row]) => row.isBuiltin === true)).toBe(true)
    expect(installPluginMock.mock.calls.every(([row]) => row.sourceKind === 'builtin')).toBe(true)
    expect(installPluginMock.mock.calls.every(([row]) => row.frontendEntry === './dist/frontend.js')).toBe(true)
    expect(installPluginMock.mock.calls.every(([row]) => row.contributes === '{}')).toBe(true)
    expect(installPluginMock.mock.calls.every(([row]) => JSON.parse(row.packageMetadata).frontend === './dist/frontend.js')).toBe(true)
  })
})
