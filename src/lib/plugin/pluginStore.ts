import { writable, get } from 'svelte/store'
import { isOpenForgePackageMetadata } from '@openforge/plugin-sdk'
import type { OpenForgePackageMetadata } from '@openforge/plugin-sdk'
import type { PluginEntry, PluginManifest } from './types'
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

export function parsePackageMetadata(raw: string | null | undefined): OpenForgePackageMetadata | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return isOpenForgePackageMetadata(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function manifestFromPluginRow(row: ipc.NormalizedPluginRow): { manifest: PluginManifest; packageMetadata: OpenForgePackageMetadata | null } {
  const packageMetadata = parsePackageMetadata(row.packageMetadata)
  const manifest: PluginManifest = {
    id: packageMetadata?.id ?? row.id,
    name: packageMetadata?.displayName ?? row.name,
    version: row.version,
    apiVersion: packageMetadata?.apiVersion ?? row.apiVersion,
    description: packageMetadata?.description ?? row.description,
    permissions: [],
    contributes: {},
    frontend: (packageMetadata?.frontend ?? row.frontendEntry) || null,
    backend: packageMetadata?.backend ?? row.backendEntry,
  }

  if (!packageMetadata) {
    manifest.permissions = JSON.parse(row.permissions)
    manifest.contributes = JSON.parse(row.contributes)
  }

  return { manifest, packageMetadata }
}

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
    installedPlugins.set(new Map(rows.map(row => {
      const { manifest, packageMetadata } = manifestFromPluginRow(row)
      return [
        row.id,
        {
          manifest,
          state: 'installed' as const,
          error: null,
          installPath: row.installPath,
          isBuiltin: row.isBuiltin,
          packageMetadata,
          sourceKind: row.sourceKind,
          sourceSpec: row.sourceSpec,
          installedAt: row.installedAt,
        },
      ]
    })))
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
  if (!getEnabledPlugins) {
    enabledPluginIds.set(new Set())
    return
  }

  const rows = await getEnabledPlugins(projectId)
  enabledPluginIds.set(new Set(rows.map(r => r.id)))
}
