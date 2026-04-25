import type { PluginManifest } from './types'
import { MAX_SUPPORTED_API_VERSION } from './types'
import { isPluginViewKey } from './types'
import { makePluginViewKey } from './types'
import {
  forceGithubSync,
  getPluginStorage,
  installPlugin,
  installPluginFromLocal as installPluginFromLocalIpc,
  installPluginFromNpm as installPluginFromNpmIpc,
  pluginInvoke,
  setPluginStorage,
  uninstallPlugin as uninstallPluginIpc,
} from '../ipc'
import {
  installedPlugins,
  enabledPluginIds,
  loadEnabledForProject as loadEnabledPluginIdsForProject,
  loadInstalledPlugins,
} from './pluginStore'
import { get } from 'svelte/store'
import {
  loadPluginFrontend,
  activatePlugin as activatePluginLoader,
  deactivatePlugin as deactivatePluginLoader,
  isPluginLoaded,
} from './pluginLoader'
import type { PluginESM } from './pluginLoader'
import type { PluginContext } from './types'
import type {
  PluginActivatedBackgroundService,
  PluginActivationResult,
  PluginActivatedCommandContribution,
  PluginActivatedSettingsSectionContribution,
  PluginActivatedSidebarPanelContribution,
  PluginActivatedTaskPaneTabContribution,
} from './types'
import { BUILTIN_PLUGIN_MANIFESTS } from './builtinPlugins'
import { registerRenderableContributionComponent } from './componentRegistry'
import { registerViewComponent } from './componentRegistry'
import { unregisterViewComponentsForPlugin } from './componentRegistry'
import { activeProjectId, currentView, selectedTaskId } from '../stores'
import type { AppView } from '../types'

const STATIC_APP_VIEWS = new Set<AppView>(['board', 'settings', 'workqueue', 'global_settings', 'files'])

function isAppView(value: unknown): value is AppView {
  return typeof value === 'string' && (STATIC_APP_VIEWS.has(value as AppView) || isPluginViewKey(value))
}

type PluginHostEventName = 'context-changed' | 'navigation-changed' | 'selection-changed'

type PluginHostContextSnapshot = {
  activeProjectId: string | null
  currentView: string
  selectedTaskId: string | null
}

type PluginHostListener = (payload: unknown) => void

const pluginHostListeners = new Map<PluginHostEventName, Set<PluginHostListener>>()
const pluginHostUnsubscribers = new Map<string, Set<() => void>>()
const activationPromises = new Map<string, Promise<boolean>>()
const pluginCommandHandlers = new Map<string, PluginActivatedCommandContribution['execute']>()
const backgroundServiceStops = new Map<string, () => Promise<void>>()
const activeBuiltinPluginModules = new Map<string, PluginESM>()

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function setPluginRuntimeState(pluginId: string, state: 'installed' | 'active' | 'error', error: string | null): void {
  installedPlugins.update(map => {
    const entry = map.get(pluginId)
    if (!entry) {
      return map
    }

    const next = new Map(map)
    next.set(pluginId, { ...entry, state, error })
    return next
  })
}

function setPluginRuntimeError(pluginId: string, error: unknown): void {
  setPluginRuntimeState(pluginId, 'error', normalizeErrorMessage(error))
}

function toNamespacedContributionId(pluginId: string, contributionId: string): string {
  return `${pluginId}:${contributionId}`
}

function clearPluginRuntimeContributions(pluginId: string): void {
  unregisterViewComponentsForPlugin(pluginId)

  for (const key of Array.from(pluginCommandHandlers.keys())) {
    if (key.startsWith(`${pluginId}:`)) {
      pluginCommandHandlers.delete(key)
    }
  }
}

async function stopPluginBackgroundServices(pluginId: string): Promise<void> {
  const stopEntries = Array.from(backgroundServiceStops.entries()).filter(([key]) => key.startsWith(`${pluginId}:`))
  for (const [key, stop] of stopEntries) {
    await stop()
    backgroundServiceStops.delete(key)
  }
}

function registerRenderableContributions<T extends PluginActivatedTaskPaneTabContribution | PluginActivatedSidebarPanelContribution | PluginActivatedSettingsSectionContribution>(
  pluginId: string,
  slotType: 'taskPaneTabs' | 'sidebarPanels' | 'settingsSections',
  contributions: T[] | undefined
): void {
  for (const contribution of contributions ?? []) {
    registerRenderableContributionComponent(slotType, toNamespacedContributionId(pluginId, contribution.id), contribution.component)
  }
}

function registerCommandContributions(pluginId: string, contributions: PluginActivatedCommandContribution[] | undefined): void {
  for (const contribution of contributions ?? []) {
    pluginCommandHandlers.set(toNamespacedContributionId(pluginId, contribution.id), contribution.execute)
  }
}

async function startBackgroundServices(pluginId: string, contributions: PluginActivatedBackgroundService[] | undefined): Promise<void> {
  for (const contribution of contributions ?? []) {
    await contribution.start()
    backgroundServiceStops.set(
      toNamespacedContributionId(pluginId, contribution.id),
      async () => {
        await contribution.stop?.()
      }
    )
  }
}

async function activateBuiltinPluginModule(pluginId: string, context: PluginContext): Promise<PluginActivationResult | null> {
  try {
    const { getBuiltinPluginModule } = await import('./builtinPluginModules')
    const builtinModule = getBuiltinPluginModule(pluginId)
    if (!builtinModule) {
      throw new Error(`Unknown builtin plugin: ${pluginId}`)
    }

    const activationResult = await builtinModule.activate(context)
    activeBuiltinPluginModules.set(pluginId, builtinModule)
    setPluginRuntimeState(pluginId, 'active', null)
    return activationResult
  } catch (error) {
    activeBuiltinPluginModules.delete(pluginId)
    setPluginRuntimeError(pluginId, error)
    return null
  }
}

async function activateExternalPluginModule(pluginId: string, frontendEntry: string, context: PluginContext): Promise<PluginActivationResult | null> {
  const loaded = await loadPluginFrontend(pluginId, `plugin://${pluginId}/${frontendEntry}`)
  if (!loaded) return null
  return activatePluginLoader(pluginId, context)
}

async function deactivateBuiltinPluginModule(pluginId: string): Promise<void> {
  const builtinModule = activeBuiltinPluginModules.get(pluginId)
  if (!builtinModule) return

  try {
    await builtinModule.deactivate?.()
  } catch (error) {
    console.error(`[pluginRegistry] Failed to deactivate builtin plugin ${pluginId}:`, error)
  } finally {
    activeBuiltinPluginModules.delete(pluginId)
    setPluginRuntimeState(pluginId, 'installed', null)
  }
}

async function deactivateLoadedPluginModule(pluginId: string): Promise<void> {
  if (activeBuiltinPluginModules.has(pluginId)) {
    await deactivateBuiltinPluginModule(pluginId)
    return
  }

  await deactivatePluginLoader(pluginId)
}

function subscribeToPluginHostEvent(pluginId: string, event: string, handler: PluginHostListener): () => void {
  const typedEvent = event as PluginHostEventName
  const listeners = pluginHostListeners.get(typedEvent) ?? new Set<PluginHostListener>()
  listeners.add(handler)
  pluginHostListeners.set(typedEvent, listeners)

  const unsubscribe = () => {
    const currentListeners = pluginHostListeners.get(typedEvent)
    currentListeners?.delete(handler)
    if (currentListeners && currentListeners.size === 0) {
      pluginHostListeners.delete(typedEvent)
    }
  }

  const cleanupCallbacks = pluginHostUnsubscribers.get(pluginId) ?? new Set<() => void>()
  const cleanup = () => {
    unsubscribe()
    cleanupCallbacks.delete(cleanup)
    if (cleanupCallbacks.size === 0) {
      pluginHostUnsubscribers.delete(pluginId)
    }
  }

  cleanupCallbacks.add(cleanup)
  pluginHostUnsubscribers.set(pluginId, cleanupCallbacks)

  return cleanup
}

function clearPluginHostSubscriptions(pluginId: string): void {
  const cleanupCallbacks = pluginHostUnsubscribers.get(pluginId)
  if (!cleanupCallbacks) return

  for (const cleanup of Array.from(cleanupCallbacks)) {
    cleanup()
  }

  pluginHostUnsubscribers.delete(pluginId)
}

function getContextSnapshot(): PluginHostContextSnapshot {
  return {
    activeProjectId: get(activeProjectId),
    currentView: get(currentView),
    selectedTaskId: get(selectedTaskId),
  }
}

export function emitPluginHostEvent(event: PluginHostEventName, payload: unknown): void {
  const listeners = pluginHostListeners.get(event)
  if (!listeners) return

  for (const listener of listeners) {
    listener(payload)
  }
}

let storeSubscriptionsInitialized = false

function ensurePluginHostStoreSubscriptions(): void {
  if (storeSubscriptionsInitialized) return
  storeSubscriptionsInitialized = true

  let previousContext = getContextSnapshot()

  const emitContextUpdates = () => {
    const nextContext = getContextSnapshot()

    if (nextContext.selectedTaskId !== previousContext.selectedTaskId) {
      emitPluginHostEvent('selection-changed', { selectedTaskId: nextContext.selectedTaskId })
    }

    if (nextContext.activeProjectId !== previousContext.activeProjectId || nextContext.currentView !== previousContext.currentView) {
      emitPluginHostEvent('navigation-changed', {
        activeProjectId: nextContext.activeProjectId,
        currentView: nextContext.currentView,
      })
    }

    if (
      nextContext.activeProjectId !== previousContext.activeProjectId
      || nextContext.currentView !== previousContext.currentView
      || nextContext.selectedTaskId !== previousContext.selectedTaskId
    ) {
      emitPluginHostEvent('context-changed', nextContext)
    }

    previousContext = nextContext
  }

  activeProjectId.subscribe(emitContextUpdates)
  currentView.subscribe(emitContextUpdates)
  selectedTaskId.subscribe(emitContextUpdates)
}

async function invokePluginHostCommand(command: string, payload: unknown): Promise<unknown> {
  const commandPayload = payload !== null && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : undefined

  switch (command) {
    case 'getContext':
      return getContextSnapshot()
    case 'getSelection':
      return { selectedTaskId: get(selectedTaskId) }
    case 'getNavigation':
      return {
        activeProjectId: get(activeProjectId),
        currentView: get(currentView),
      }
    case 'getTaskContext': {
      const taskId = typeof commandPayload?.taskId === 'string' ? commandPayload.taskId : get(selectedTaskId)
      return { taskId }
    }
    case 'getProjectContext': {
      const projectId = typeof commandPayload?.projectId === 'string' ? commandPayload.projectId : get(activeProjectId)
      return { projectId }
    }
    case 'navigate': {
      if (isAppView(commandPayload?.currentView)) {
        currentView.set(commandPayload.currentView)
      }

      if (typeof commandPayload?.selectedTaskId === 'string' || commandPayload?.selectedTaskId === null) {
        selectedTaskId.set(commandPayload?.selectedTaskId ?? null)
      }

      if (typeof commandPayload?.activeProjectId === 'string' || commandPayload?.activeProjectId === null) {
        activeProjectId.set(commandPayload?.activeProjectId ?? null)
      }

      return getContextSnapshot()
    }
    case 'forceGithubSync':
      return forceGithubSync()
    default:
      throw new Error(`Unknown plugin host command: ${command}`)
  }
}

function upsertInstalledPlugin(row: {
  id: string
  name: string
  version: string
  apiVersion: number
  description: string
  permissions: string
  contributes: string
  frontendEntry: string
  backendEntry: string | null
  installPath: string
  isBuiltin: boolean
}): void {
  const manifest: PluginManifest = {
    id: row.id,
    name: row.name,
    version: row.version,
    apiVersion: row.apiVersion,
    description: row.description,
    permissions: JSON.parse(row.permissions),
    contributes: JSON.parse(row.contributes),
    frontend: row.frontendEntry,
    backend: row.backendEntry,
  }

  installedPlugins.update(map => {
    const next = new Map(map)
    next.set(row.id, {
      manifest,
      state: 'installed',
      error: null,
      installPath: row.installPath,
      isBuiltin: row.isBuiltin,
    })
    return next
  })
}

export async function installPluginFromNpm(packageName: string): Promise<void> {
  const row = await installPluginFromNpmIpc(packageName)
  upsertInstalledPlugin(row)
}

export async function installPluginFromManifest(manifest: PluginManifest, installPath: string): Promise<void> {
  if (manifest.apiVersion > MAX_SUPPORTED_API_VERSION) {
    throw new Error(`Unsupported API version: ${manifest.apiVersion}`)
  }

  await installPlugin({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    description: manifest.description,
    permissions: JSON.stringify(manifest.permissions),
    contributes: JSON.stringify(manifest.contributes),
    frontendEntry: manifest.frontend,
    backendEntry: manifest.backend,
    installPath,
    installedAt: Date.now(),
    isBuiltin: false,
  })

  installedPlugins.update(map => {
    const next = new Map(map)
    next.set(manifest.id, { manifest, state: 'installed', error: null, installPath, isBuiltin: false })
    return next
  })
}

export async function initializePluginRuntime(): Promise<void> {
  await loadInstalledPlugins()

  for (const manifest of BUILTIN_PLUGIN_MANIFESTS) {
    await installPlugin({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      apiVersion: manifest.apiVersion,
      description: manifest.description,
      permissions: JSON.stringify(manifest.permissions),
      contributes: JSON.stringify(manifest.contributes),
      frontendEntry: manifest.frontend,
      backendEntry: manifest.backend,
      installPath: `builtin:${manifest.id}`,
      installedAt: Date.now(),
      isBuiltin: true,
    })
  }

  await loadInstalledPlugins()
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  await deactivatePluginById(pluginId)
  await uninstallPluginIpc(pluginId)
  installedPlugins.update(map => {
    const next = new Map(map)
    next.delete(pluginId)
    return next
  })
}

export async function loadEnabledForProject(projectId: string): Promise<void> {
  await loadEnabledPluginIdsForProject(projectId)
}

export async function activatePlugin(pluginId: string): Promise<boolean> {
  if (activationPromises.has(pluginId)) {
    return activationPromises.get(pluginId) as Promise<boolean>
  }

  const map = get(installedPlugins)
  const entry = map.get(pluginId)
  if (!entry) return false

  if (entry.state === 'active' && (isPluginLoaded(pluginId) || activeBuiltinPluginModules.has(pluginId))) {
    return true
  }

  const activation = (async () => {
    const context = makePluginContextForPlugin(pluginId)
    const result = entry.isBuiltin
      ? await activateBuiltinPluginModule(pluginId, context)
      : await activateExternalPluginModule(pluginId, entry.manifest.frontend, context)
    if (result === null) return false

    try {
      clearPluginRuntimeContributions(pluginId)
      await stopPluginBackgroundServices(pluginId)

      for (const view of result.contributions.views ?? []) {
        if (view.component) {
          registerViewComponent(makePluginViewKey(pluginId, view.id), view.component)
        }
      }

      registerRenderableContributions(pluginId, 'taskPaneTabs', result.contributions.taskPaneTabs)
      registerRenderableContributions(pluginId, 'sidebarPanels', result.contributions.sidebarPanels)
      registerRenderableContributions(pluginId, 'settingsSections', result.contributions.settingsSections)
      registerCommandContributions(pluginId, result.contributions.commands)
      await startBackgroundServices(pluginId, result.contributions.backgroundServices)

      return true
    } catch (error) {
      clearPluginRuntimeContributions(pluginId)
      await stopPluginBackgroundServices(pluginId)
      await deactivateLoadedPluginModule(pluginId)
      setPluginRuntimeError(pluginId, error)
      return false
    }
  })()

  activationPromises.set(pluginId, activation)

  try {
    return await activation
  } finally {
    activationPromises.delete(pluginId)
  }
}

export async function executePluginCommand(pluginId: string, commandId: string, payload?: unknown): Promise<boolean> {
  const commandKey = toNamespacedContributionId(pluginId, commandId)

  if (!pluginCommandHandlers.has(commandKey)) {
    const activated = await activatePlugin(pluginId)
    if (!activated) {
      return false
    }
  }

  const handler = pluginCommandHandlers.get(commandKey)
  if (!handler) {
    return false
  }

  await handler(payload)
  return true
}

function makePluginContextForPlugin(pluginId: string): PluginContext {
  return {
    pluginId,
    invokeHost: async (command: string, payload?: unknown) => {
      ensurePluginHostStoreSubscriptions()
      return invokePluginHostCommand(command, payload)
    },
    invokeBackend: async (method: string, payload?: unknown) => pluginInvoke(pluginId, method, payload ?? null),
    onEvent: (event: string, handler: (payload: unknown) => void) => {
      ensurePluginHostStoreSubscriptions()
      return subscribeToPluginHostEvent(pluginId, event, handler)
    },
    storage: {
      get: async (key: string) => getPluginStorage(pluginId, key),
      set: async (key: string, value: string) => setPluginStorage(pluginId, key, value),
    },
  }
}

export async function deactivatePluginById(pluginId: string): Promise<void> {
  await deactivateLoadedPluginModule(pluginId)
  clearPluginRuntimeContributions(pluginId)
  await stopPluginBackgroundServices(pluginId)
  clearPluginHostSubscriptions(pluginId)
}

export async function installFromLocal(pluginPath: string, _projectId: string): Promise<void> {
  const row = await installPluginFromLocalIpc(pluginPath)
  upsertInstalledPlugin(row)
}

async function reconcileLoadedPlugins(): Promise<void> {
  const enabled = get(enabledPluginIds)
  const installed = get(installedPlugins)
  const loadedPluginIds = Array.from(installed.entries())
    .filter(([, entry]) => entry.state === 'active')
    .map(([pluginId]) => pluginId)

  for (const pluginId of loadedPluginIds) {
    if (!enabled.has(pluginId) || !installed.has(pluginId)) {
      await deactivatePluginById(pluginId)
    }
  }
}

enabledPluginIds.subscribe(() => {
  void reconcileLoadedPlugins()
})

installedPlugins.subscribe(() => {
  void reconcileLoadedPlugins()
})
