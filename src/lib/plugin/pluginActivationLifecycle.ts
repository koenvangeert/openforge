import { get } from 'svelte/store'
import type { OpenForgeContextSnapshot } from '@openforge/plugin-sdk'
import type { FrontendOpenForgeAPI } from '@openforge/plugin-sdk/frontend'
import { openUrl } from '../ipc'
import { activeProjectId } from '../stores'
import { installedPlugins } from './pluginStore'
import { loadPluginFrontend, deactivatePlugin as deactivatePluginLoader, isFrontendPluginModule } from './pluginLoader'
import { createRuntimeContributionRegistry } from './runtimeContributionRegistry'
import type { RuntimeContributionRegistryInstance } from './runtimeContributionRegistry'
import { createIpcPluginStorage } from './pluginStorage'
import type { PluginManifest } from './types'
import { getPackageMetadataForPlugin, setPluginRuntimeError, setPluginRuntimeState } from './pluginInstallState'
import { createPluginRuntimeHost } from './pluginHostCommands'
import { clearPluginHostSubscriptions } from './pluginHostEvents'
import {
  applyRuntimeSnapshotContributions,
  clearPluginRuntimeContributions,
  getPluginCommandHandler,
  hasPluginCommandHandler,
  stopPluginBackgroundServices,
} from './pluginRuntimeContributions'

const activationPromises = new Map<string, Promise<boolean>>()
const activeRuntimeRegistries = new Map<string, RuntimeContributionRegistryInstance>()

function normalizePluginAssetUrl(pluginId: string, frontendEntry: string): string {
  const entry = frontendEntry.replace(/^\.\//, '').replace(/^\//, '')
  return `plugin://${pluginId}/${entry}`
}

function createFrontendRuntimeRegistryForPlugin(pluginId: string, manifest: PluginManifest): RuntimeContributionRegistryInstance {
  return createRuntimeContributionRegistry({
    pluginId,
    projectId: get(activeProjectId),
    packageMetadata: getPackageMetadataForPlugin(pluginId, manifest),
    storage: createIpcPluginStorage(pluginId),
    host: createPluginRuntimeHost(pluginId),
  })
}

async function activateFrontendRuntimePlugin(pluginId: string, manifest: PluginManifest, frontendPlugin: Parameters<RuntimeContributionRegistryInstance['activateFrontend']>[0]): Promise<boolean> {
  const runtimeRegistry = createFrontendRuntimeRegistryForPlugin(pluginId, manifest)

  try {
    await runtimeRegistry.activateFrontend(frontendPlugin)
    activeRuntimeRegistries.set(pluginId, runtimeRegistry)
    await applyRuntimeSnapshotContributions(pluginId, runtimeRegistry.getSnapshot())
    setPluginRuntimeState(pluginId, 'active', null)
    return true
  } catch (error) {
    await runtimeRegistry.deactivate()
    activeRuntimeRegistries.delete(pluginId)
    clearPluginRuntimeContributions(pluginId)
    setPluginRuntimeError(pluginId, error)
    return false
  }
}

async function activateBuiltinPluginModule(pluginId: string): Promise<boolean> {
  try {
    const { getBuiltinPluginModule } = await import('./builtinPluginModules')
    const builtinModule = getBuiltinPluginModule(pluginId)
    if (!builtinModule) {
      throw new Error(`Unknown builtin plugin: ${pluginId}`)
    }

    if (isFrontendPluginModule(builtinModule)) {
      const manifest = get(installedPlugins).get(pluginId)?.manifest
      if (!manifest) {
        throw new Error(`Builtin plugin ${pluginId} is not installed`)
      }
      return activateFrontendRuntimePlugin(pluginId, manifest, builtinModule)
    }

    throw new Error(`Builtin plugin ${pluginId} uses the legacy activate(context) API, which is no longer supported; built-ins must use defineFrontendPlugin(...) runtime registration`)
  } catch (error) {
    setPluginRuntimeError(pluginId, error)
    return false
  }
}

async function activateExternalPluginModule(pluginId: string, manifest: PluginManifest): Promise<boolean> {
  if (!manifest.frontend) {
    if (!manifest.backend) {
      setPluginRuntimeError(pluginId, new Error(`Plugin ${pluginId} metadata is missing a frontend or backend entry`))
      return false
    }

    setPluginRuntimeState(pluginId, 'active', null)
    return true
  }

  const loaded = await loadPluginFrontend(pluginId, normalizePluginAssetUrl(pluginId, manifest.frontend))
  if (!loaded) return false

  if (isFrontendPluginModule(loaded.module)) {
    return activateFrontendRuntimePlugin(pluginId, manifest, loaded.module)
  }

  setPluginRuntimeError(pluginId, new Error(`Plugin ${pluginId} uses the legacy activate(context) API, which is no longer supported; export defineFrontendPlugin(...) and register contributions at runtime`))
  return false
}

function isBackendOnlyExternalPlugin(pluginId: string): boolean {
  const entry = get(installedPlugins).get(pluginId)
  return Boolean(entry && !entry.isBuiltin && !entry.manifest.frontend && entry.manifest.backend)
}

async function deactivateLoadedPluginModule(pluginId: string): Promise<void> {
  const runtimeRegistry = activeRuntimeRegistries.get(pluginId)
  if (runtimeRegistry) {
    try {
      await runtimeRegistry.deactivate()
    } finally {
      activeRuntimeRegistries.delete(pluginId)
    }
    setPluginRuntimeState(pluginId, 'installed', null)
    return
  }

  if (isBackendOnlyExternalPlugin(pluginId)) {
    setPluginRuntimeState(pluginId, 'installed', null)
    return
  }

  await deactivatePluginLoader(pluginId)
}

export async function activatePlugin(pluginId: string): Promise<boolean> {
  if (activationPromises.has(pluginId)) {
    return activationPromises.get(pluginId) as Promise<boolean>
  }

  const map = get(installedPlugins)
  const entry = map.get(pluginId)
  if (!entry) return false

  if (entry.state === 'active' && (activeRuntimeRegistries.has(pluginId) || isBackendOnlyExternalPlugin(pluginId))) {
    return true
  }

  const activation = (async () => {
    clearPluginRuntimeContributions(pluginId)
    await stopPluginBackgroundServices(pluginId)

    const activated = entry.isBuiltin
      ? await activateBuiltinPluginModule(pluginId)
      : await activateExternalPluginModule(pluginId, entry.manifest)

    return activated
  })()

  activationPromises.set(pluginId, activation)

  try {
    return await activation
  } finally {
    activationPromises.delete(pluginId)
  }
}

export async function executePluginCommand(pluginId: string, commandId: string, payload?: unknown): Promise<boolean> {
  if (!hasPluginCommandHandler(pluginId, commandId)) {
    const activated = await activatePlugin(pluginId)
    if (!activated) {
      return false
    }
  }

  const handler = getPluginCommandHandler(pluginId, commandId)
  if (!handler) {
    return false
  }

  await handler(payload)
  return true
}

function createUnavailableFrontendApi(pluginId: string): FrontendOpenForgeAPI {
  const unavailable = async () => {
    throw new Error(`Frontend runtime API is unavailable for plugin ${pluginId}`)
  }

  return {
    commands: {
      register: () => ({ dispose: () => undefined }),
      invoke: unavailable,
      invokeGlobal: unavailable,
      list: unavailable,
    },
    events: {
      on: () => ({ dispose: () => undefined }),
      onGlobal: () => ({ dispose: () => undefined }),
      emit: unavailable,
      emitGlobal: unavailable,
    },
    storage: {
      global: { get: unavailable, set: unavailable, delete: unavailable },
      project: () => ({ get: unavailable, set: unavailable, delete: unavailable }),
      task: () => ({ get: unavailable, set: unavailable, delete: unavailable }),
    },
    context: {
      getSnapshot: () => ({ pluginId, projectId: get(activeProjectId) }),
    },
    tasks: {
      list: unavailable,
      get: unavailable,
      updateSummary: unavailable,
      updateStatus: unavailable,
      getWorkspace: unavailable,
      getLatestSession: unavailable,
    },
    projects: {
      list: unavailable,
      get: unavailable,
    },
    fs: { readDir: unavailable, readFile: unavailable, writeFile: unavailable, searchFiles: unavailable },
    shell: { spawn: unavailable, write: unavailable, resize: unavailable, kill: unavailable, getBuffer: unavailable },
    notifications: { notify: unavailable },
    attention: { listProjects: unavailable },
    system: { openUrl: async (url: string) => openUrl(url) },
    config: { get: unavailable, set: unavailable },
    projectConfig: { get: unavailable, set: unavailable },
    views: { register: () => ({ dispose: () => undefined }) },
    taskPane: { registerTab: () => ({ dispose: () => undefined }) },
    settings: { registerSection: () => ({ dispose: () => undefined }) },
    backend: {
      state: 'missing',
      whenReady: unavailable,
      onReady: () => ({ dispose: () => undefined }),
      invoke: unavailable,
    },
  }
}

export function getPluginRenderProps(pluginId: string, options: { projectId: string | null; taskId?: string | null }): { api: FrontendOpenForgeAPI; context: OpenForgeContextSnapshot } {
  const runtimeRegistry = activeRuntimeRegistries.get(pluginId)
  if (!runtimeRegistry) {
    return {
      api: createUnavailableFrontendApi(pluginId),
      context: {
        pluginId,
        projectId: options.projectId,
        taskId: options.taskId ?? null,
      },
    }
  }

  return {
    api: runtimeRegistry.getFrontendApi(),
    context: runtimeRegistry.createRenderContextSnapshot(options.projectId, options.taskId ?? null),
  }
}

export async function deactivatePluginById(pluginId: string): Promise<void> {
  await deactivateLoadedPluginModule(pluginId)
  clearPluginRuntimeContributions(pluginId)
  await stopPluginBackgroundServices(pluginId)
  clearPluginHostSubscriptions(pluginId)
  setPluginRuntimeState(pluginId, 'installed', null)
}
