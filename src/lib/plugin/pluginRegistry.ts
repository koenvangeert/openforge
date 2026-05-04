import { listenDesktopEvent } from '../desktopIpc'
import type { PluginManifest } from './types'
import { MAX_SUPPORTED_API_VERSION } from './types'
import { isPluginViewKey } from './types'
import { makePluginViewKey } from './types'
import {
  abortAgentReview,
  fetchAuthoredPrs,
  fetchReviewPrs,
  forceGithubSync,
  fsReadDir,
  fsReadFile,
  getAgentReviewComments,
  getAuthoredPrs,
  getConfig,
  getFileAtRef,
  getFileContent,
  getPluginStorage,
  getPrFileDiffs,
  getPrOverviewComments,
  getProjectConfig,
  getPtyBuffer,
  getReviewComments,
  getReviewPrs,
  getTaskWorkspace,
  installPlugin,
  killPty,
  listOpenCodeSkills,
  markReviewPrViewed,
  installPluginFromLocal as installPluginFromLocalIpc,
  installPluginFromNpm as installPluginFromNpmIpc,
  openUrl,
  pluginInvoke,
  resizePty,
  saveSkillContent,
  setConfig,
  setPluginStorage,
  setProjectConfig,
  spawnShellPty,
  startAgentReview,
  submitPrReview,
  uninstallPlugin as uninstallPluginIpc,
  updateAgentReviewCommentStatus,
  writePty,
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

const STATIC_APP_VIEWS = new Set<AppView>(['board', 'settings', 'global_settings', 'files'])

function isAppView(value: unknown): value is AppView {
  return typeof value === 'string' && (STATIC_APP_VIEWS.has(value as AppView) || isPluginViewKey(value))
}

type PluginHostEventName = string

type PluginHostContextSnapshot = {
  activeProjectId: string | null
  currentView: string
  selectedTaskId: string | null
}

type PluginHostListener = (payload: unknown) => void

type DesktopEventSubscription = {
  listeners: Set<PluginHostListener>
  ready: Promise<void>
  unlisten: (() => void) | null
  disposed: boolean
}

const HOST_EVENT_NAMES = new Set(['context-changed', 'navigation-changed', 'selection-changed'])
const pluginHostListeners = new Map<PluginHostEventName, Set<PluginHostListener>>()
const desktopEventSubscriptions = new Map<string, DesktopEventSubscription>()
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

function hasContributions<T>(items: T[] | undefined): boolean {
  return Array.isArray(items) && items.length > 0
}

function hasRenderableContributions(manifest: PluginManifest): boolean {
  return hasContributions(manifest.contributes.views)
    || hasContributions(manifest.contributes.taskPaneTabs)
    || hasContributions(manifest.contributes.sidebarPanels)
    || hasContributions(manifest.contributes.settingsSections)
}

function validateExternalPluginIntegration(manifest: PluginManifest): void {
  if (!manifest.frontend && !manifest.backend) {
    throw new Error('External plugins require a frontend or backend entry')
  }

  if (!manifest.frontend && hasRenderableContributions(manifest)) {
    throw new Error('Renderable plugin contributions require a frontend entry')
  }

  if (!manifest.frontend && hasContributions(manifest.contributes.backgroundServices)) {
    throw new Error('Frontendless background service contributions are not supported')
  }
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

async function activateExternalPluginModule(pluginId: string, manifest: PluginManifest, context: PluginContext): Promise<PluginActivationResult | null> {
  if (!manifest.frontend) {
    if (!manifest.backend) {
      setPluginRuntimeError(pluginId, new Error(`Plugin ${pluginId} manifest is missing a frontend or backend entry`))
      return null
    }

    setPluginRuntimeState(pluginId, 'active', null)
    return {
      contributions: {
        commands: manifest.contributes.commands?.map((command) => ({
          ...command,
          execute: async (payload?: unknown) => {
            await context.invokeBackend(command.id, payload ?? null)
          },
        })),
      },
    }
  }

  const loaded = await loadPluginFrontend(pluginId, `plugin://${pluginId}/${manifest.frontend}`)
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

function isBackendOnlyExternalPlugin(pluginId: string): boolean {
  const entry = get(installedPlugins).get(pluginId)
  return Boolean(entry && !entry.isBuiltin && !entry.manifest.frontend && entry.manifest.backend)
}

async function deactivateLoadedPluginModule(pluginId: string): Promise<void> {
  if (activeBuiltinPluginModules.has(pluginId)) {
    await deactivateBuiltinPluginModule(pluginId)
    return
  }

  if (isBackendOnlyExternalPlugin(pluginId)) {
    setPluginRuntimeState(pluginId, 'installed', null)
    return
  }

  await deactivatePluginLoader(pluginId)
}

function ensureDesktopEventSubscription(event: string): DesktopEventSubscription {
  const existing = desktopEventSubscriptions.get(event)
  if (existing) return existing

  const subscription: DesktopEventSubscription = {
    listeners: new Set(),
    ready: Promise.resolve(),
    unlisten: null,
    disposed: false,
  }

  subscription.ready = listenDesktopEvent(event, (desktopEvent) => {
    for (const listener of Array.from(subscription.listeners)) {
      listener(desktopEvent.payload)
    }
  }).then((unlisten) => {
    subscription.unlisten = unlisten
    if (subscription.disposed || subscription.listeners.size === 0) {
      unlisten()
      desktopEventSubscriptions.delete(event)
    }
  }).catch((error) => {
    desktopEventSubscriptions.delete(event)
    console.error(`[pluginRegistry] Failed to subscribe to host event ${event}:`, error)
  })

  desktopEventSubscriptions.set(event, subscription)
  return subscription
}

function removeDesktopEventListener(event: string, handler: PluginHostListener): void {
  const subscription = desktopEventSubscriptions.get(event)
  if (!subscription) return

  subscription.listeners.delete(handler)
  if (subscription.listeners.size > 0) return

  if (subscription.unlisten) {
    subscription.unlisten()
    desktopEventSubscriptions.delete(event)
    return
  }

  subscription.disposed = true
}

async function waitForDesktopEventSubscription(event: string): Promise<void> {
  await desktopEventSubscriptions.get(event)?.ready
}

async function waitForTerminalEventSubscriptions(commandPayload: Record<string, unknown> | undefined): Promise<void> {
  const taskId = typeof commandPayload?.taskId === 'string' ? commandPayload.taskId : ''
  const terminalIndex = Number(commandPayload?.terminalIndex)
  if (!taskId || !Number.isInteger(terminalIndex) || terminalIndex < 0) return

  const terminalKey = `${taskId}-shell-${terminalIndex}`
  await Promise.all([
    waitForDesktopEventSubscription(`pty-output-${terminalKey}`),
    waitForDesktopEventSubscription(`pty-exit-${terminalKey}`),
  ])
}

function subscribeToPluginHostEvent(pluginId: string, event: string, handler: PluginHostListener): () => void {
  const cleanupCallbacks = pluginHostUnsubscribers.get(pluginId) ?? new Set<() => void>()
  let unsubscribe = () => {}

  if (HOST_EVENT_NAMES.has(event)) {
    const typedEvent = event as PluginHostEventName
    const listeners = pluginHostListeners.get(typedEvent) ?? new Set<PluginHostListener>()
    listeners.add(handler)
    pluginHostListeners.set(typedEvent, listeners)
    unsubscribe = () => {
      const currentListeners = pluginHostListeners.get(typedEvent)
      currentListeners?.delete(handler)
      if (currentListeners && currentListeners.size === 0) {
        pluginHostListeners.delete(typedEvent)
      }
    }
  } else {
    const subscription = ensureDesktopEventSubscription(event)
    subscription.listeners.add(handler)
    unsubscribe = () => removeDesktopEventListener(event, handler)
  }

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
    case 'openUrl':
      return openUrl(String(commandPayload?.url ?? ''))
    case 'fsReadDir':
      return fsReadDir(String(commandPayload?.projectId ?? ''), typeof commandPayload?.dirPath === 'string' ? commandPayload.dirPath : null)
    case 'fsReadFile':
      return fsReadFile(String(commandPayload?.projectId ?? ''), String(commandPayload?.filePath ?? ''))
    case 'listOpenCodeSkills':
      return listOpenCodeSkills(String(commandPayload?.projectId ?? ''))
    case 'saveSkillContent':
      return saveSkillContent(
        String(commandPayload?.projectId ?? ''),
        String(commandPayload?.name ?? ''),
        commandPayload?.level === 'user' ? 'user' : 'project',
        String(commandPayload?.sourceDir ?? ''),
        String(commandPayload?.content ?? '')
      )
    case 'fetchReviewPrs':
      return fetchReviewPrs()
    case 'getReviewPrs':
      return getReviewPrs()
    case 'fetchAuthoredPrs':
      return fetchAuthoredPrs()
    case 'getAuthoredPrs':
      return getAuthoredPrs()
    case 'markReviewPrViewed':
      return markReviewPrViewed(Number(commandPayload?.prId), String(commandPayload?.headSha ?? ''))
    case 'getPrFileDiffs':
      return getPrFileDiffs(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), Number(commandPayload?.prNumber))
    case 'getFileContent':
      return getFileContent(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), String(commandPayload?.sha ?? ''))
    case 'getFileAtRef':
      return getFileAtRef(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), String(commandPayload?.path ?? ''), String(commandPayload?.refSha ?? ''))
    case 'getReviewComments':
      return getReviewComments(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), Number(commandPayload?.prNumber))
    case 'getPrOverviewComments':
      return getPrOverviewComments(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), Number(commandPayload?.prNumber))
    case 'submitPrReview':
      return submitPrReview(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), Number(commandPayload?.prNumber), String(commandPayload?.event ?? ''), String(commandPayload?.body ?? ''), Array.isArray(commandPayload?.comments) ? commandPayload.comments as never : [], String(commandPayload?.commitId ?? ''))
    case 'startAgentReview':
      return startAgentReview(String(commandPayload?.repoOwner ?? ''), String(commandPayload?.repoName ?? ''), Number(commandPayload?.prNumber), String(commandPayload?.headRef ?? ''), String(commandPayload?.baseRef ?? ''), String(commandPayload?.prTitle ?? ''), typeof commandPayload?.prBody === 'string' ? commandPayload.prBody : null, Number(commandPayload?.reviewPrId))
    case 'getAgentReviewComments':
      return getAgentReviewComments(Number(commandPayload?.reviewPrId))
    case 'updateAgentReviewCommentStatus':
      return updateAgentReviewCommentStatus(Number(commandPayload?.commentId), String(commandPayload?.status ?? ''))
    case 'abortAgentReview':
      return abortAgentReview(String(commandPayload?.reviewSessionKey ?? ''))
    case 'getProjectConfig':
      return getProjectConfig(String(commandPayload?.projectId ?? ''), String(commandPayload?.key ?? ''))
    case 'setProjectConfig':
      return setProjectConfig(String(commandPayload?.projectId ?? ''), String(commandPayload?.key ?? ''), String(commandPayload?.value ?? ''))
    case 'spawnShellPty':
      await waitForTerminalEventSubscriptions(commandPayload)
      return spawnShellPty(String(commandPayload?.taskId ?? ''), String(commandPayload?.cwd ?? ''), Number(commandPayload?.cols), Number(commandPayload?.rows), Number(commandPayload?.terminalIndex))
    case 'writePty':
      return writePty(String(commandPayload?.taskId ?? ''), String(commandPayload?.data ?? ''))
    case 'resizePty':
      return resizePty(String(commandPayload?.taskId ?? ''), Number(commandPayload?.cols), Number(commandPayload?.rows))
    case 'killPty':
      return killPty(String(commandPayload?.taskId ?? ''))
    case 'getPtyBuffer':
      return getPtyBuffer(String(commandPayload?.taskId ?? ''))
    case 'getTaskWorkspace':
      return getTaskWorkspace(String(commandPayload?.taskId ?? ''))
    case 'getConfig':
      return getConfig(String(commandPayload?.key ?? ''))
    case 'setConfig':
      return setConfig(String(commandPayload?.key ?? ''), String(commandPayload?.value ?? ''))
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
    frontend: row.frontendEntry || null,
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

  validateExternalPluginIntegration(manifest)

  await installPlugin({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    description: manifest.description,
    permissions: JSON.stringify(manifest.permissions),
    contributes: JSON.stringify(manifest.contributes),
    frontendEntry: manifest.frontend ?? '',
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
      frontendEntry: manifest.frontend ?? '',
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
      : await activateExternalPluginModule(pluginId, entry.manifest, context)
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
