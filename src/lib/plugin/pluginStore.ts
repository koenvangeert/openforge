import { writable, get } from 'svelte/store'
import type { PluginEntry } from './types'
import * as ipc from '../ipc'
import { resolveContributions } from './contributionResolver'

function getOptionalIpcMethod<T>(resolve: () => T): T | undefined {
  try {
    return resolve()
  } catch {
    return undefined
  }
}

export const installedPlugins = writable<Map<string, PluginEntry>>(new Map())
export const enabledPluginIds = writable<Set<string>>(new Set())
export const loading = writable<boolean>(false)
export const error = writable<string | null>(null)

export async function loadInstalledPlugins(): Promise<void> {
  loading.set(true)
  error.set(null)
  try {
    const listPlugins = getOptionalIpcMethod(() => ipc.listPlugins)
    if (!listPlugins) {
      installedPlugins.set(new Map())
      return
    }

    const rows = await listPlugins()
    installedPlugins.set(new Map(rows.map(row => [
      row.id,
      {
        manifest: {
          id: row.id,
          name: row.name,
          version: row.version,
          apiVersion: row.apiVersion,
          description: row.description,
          permissions: JSON.parse(row.permissions),
          contributes: JSON.parse(row.contributes),
          frontend: row.frontendEntry || null,
          backend: row.backendEntry,
        },
        state: 'installed' as const,
        error: null,
        installPath: row.installPath,
        isBuiltin: row.isBuiltin,
      },
    ])))
  } catch (e) {
    error.set(e instanceof Error ? e.message : String(e))
  } finally {
    loading.set(false)
  }
}

export async function enablePlugin(projectId: string, pluginId: string): Promise<void> {
  const setPluginEnabled = getOptionalIpcMethod(() => ipc.setPluginEnabled)
  if (!setPluginEnabled) {
    return
  }

  await setPluginEnabled(projectId, pluginId, true)
  enabledPluginIds.update(set => {
    const next = new Set(set)
    next.add(pluginId)
    return next
  })
}

export async function disablePlugin(projectId: string, pluginId: string): Promise<void> {
  const setPluginEnabled = getOptionalIpcMethod(() => ipc.setPluginEnabled)
  if (!setPluginEnabled) {
    return
  }

  await setPluginEnabled(projectId, pluginId, false)
  enabledPluginIds.update(set => {
    const next = new Set(set)
    next.delete(pluginId)
    return next
  })
}

export function isPluginEnabled(pluginId: string): boolean {
  return get(enabledPluginIds).has(pluginId)
}

export function getContributions(contributionType: string): unknown[] {
  const manifests = Array.from(get(enabledPluginIds))
    .map(id => get(installedPlugins).get(id)?.manifest)
    .filter((manifest): manifest is PluginEntry['manifest'] => manifest !== undefined)
  const resolved = resolveContributions(manifests)
  const bucket = resolved[contributionType as keyof typeof resolved]
  return Array.isArray(bucket) ? bucket : []
}

export async function loadEnabledForProject(projectId: string): Promise<void> {
  const getEnabledPlugins = getOptionalIpcMethod(() => ipc.getEnabledPlugins)
  const builtinIds = Array.from(get(installedPlugins).entries())
    .filter(([, entry]) => entry.isBuiltin)
    .map(([pluginId]) => pluginId)

  if (!getEnabledPlugins) {
    enabledPluginIds.set(new Set(builtinIds))
    return
  }

  const rows = await getEnabledPlugins(projectId)
  enabledPluginIds.set(new Set([...builtinIds, ...rows.map(r => r.id)]))
}
