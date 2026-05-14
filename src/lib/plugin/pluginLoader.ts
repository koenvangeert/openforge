import { installedPlugins } from './pluginStore'
import { OPENFORGE_FRONTEND_PLUGIN_MARKER } from '@openforge/plugin-sdk/frontend'
import type { FrontendPlugin } from '@openforge/plugin-sdk/frontend'
import type { PluginState } from './types'

export interface PluginESM {
  activate(context: unknown): Promise<unknown> | unknown
  deactivate?(): Promise<void> | void
}

export type FrontendPluginESM = FrontendPlugin & {
  readonly [OPENFORGE_FRONTEND_PLUGIN_MARKER]?: true
  deactivate?(): Promise<void> | void
}

export type LoadedPluginModule = PluginESM | FrontendPluginESM

export interface LoadedPlugin {
  pluginId: string
  module: LoadedPluginModule
}

const loadedPlugins = new Map<string, LoadedPlugin>()

let moduleLoader: (path: string) => Promise<unknown> = path => import(/* @vite-ignore */ path) as Promise<unknown>

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function setPluginState(pluginId: string, state: PluginState, error: string | null): void {
  installedPlugins.update(map => {
    const entry = map.get(pluginId)
    if (!entry) return map

    const next = new Map(map)
    next.set(pluginId, { ...entry, state, error })
    return next
  })
}

function getModuleCandidate(module: unknown): unknown {
  if (typeof module === 'object' && module !== null && 'default' in module) {
    const defaultExport = (module as { default?: unknown }).default
    if (isPluginModule(defaultExport)) {
      return defaultExport
    }
  }

  return module
}

function isPluginModule(module: unknown): module is LoadedPluginModule {
  return typeof module === 'object' && module !== null && typeof (module as { activate?: unknown }).activate === 'function'
}

export function isFrontendPluginModule(module: unknown): module is FrontendPluginESM {
  if (typeof module !== 'object' || module === null || typeof (module as { activate?: unknown }).activate !== 'function') {
    return false
  }

  return (module as { [OPENFORGE_FRONTEND_PLUGIN_MARKER]?: unknown })[OPENFORGE_FRONTEND_PLUGIN_MARKER] === true
    || (module as { activate: (...args: never[]) => unknown }).activate.length >= 2
}

export function _setModuleLoader(loader: (path: string) => Promise<unknown>): void {
  moduleLoader = loader
}

export function _resetPluginLoaderForTests(): void {
  loadedPlugins.clear()
  moduleLoader = path => import(/* @vite-ignore */ path) as Promise<unknown>
}

export async function loadPluginFrontend(pluginId: string, installPath: string): Promise<LoadedPlugin | null> {
  const existing = loadedPlugins.get(pluginId)
  if (existing) return existing

  try {
    const loadedModule = getModuleCandidate(await moduleLoader(installPath))
    if (!isPluginModule(loadedModule)) {
      throw new Error(`Plugin ${pluginId} frontend is missing an activate() export`)
    }

    const loadedPlugin: LoadedPlugin = {
      pluginId,
      module: loadedModule,
    }

    loadedPlugins.set(pluginId, loadedPlugin)
    setPluginState(pluginId, 'installed', null)
    return loadedPlugin
  } catch (error) {
    setPluginState(pluginId, 'error', normalizeErrorMessage(error))
    return null
  }
}

export async function activatePlugin(pluginId: string): Promise<null> {
  const loadedPlugin = loadedPlugins.get(pluginId)
  if (!loadedPlugin) return null

  const message = isFrontendPluginModule(loadedPlugin.module)
    ? `Plugin ${pluginId} uses defineFrontendPlugin and must be activated by the frontend runtime`
    : `Plugin ${pluginId} uses the legacy activate(context) API, which is no longer supported; export defineFrontendPlugin(...) and register contributions at runtime`
  setPluginState(pluginId, 'error', message)
  return null
}

export async function deactivatePlugin(pluginId: string): Promise<void> {
  const loadedPlugin = loadedPlugins.get(pluginId)
  if (!loadedPlugin) return

  try {
    await loadedPlugin.module.deactivate?.()
  } catch (error) {
    console.error(`[pluginLoader] Failed to deactivate plugin ${pluginId}:`, error)
  } finally {
    loadedPlugins.delete(pluginId)
    setPluginState(pluginId, 'installed', null)
  }
}

export function isPluginLoaded(pluginId: string): boolean {
  return loadedPlugins.has(pluginId)
}

export function getLoadedPlugin(pluginId: string): LoadedPlugin | undefined {
  return loadedPlugins.get(pluginId)
}
