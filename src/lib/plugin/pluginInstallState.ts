import { get } from 'svelte/store'
import {
  installPluginFromGit as installPluginFromGitIpc,
  installPluginFromLocal as installPluginFromLocalIpc,
  installPluginFromNpm as installPluginFromNpmIpc,
  registerBuiltinPlugin,
} from '../ipc'
import { BUILTIN_PLUGIN_MANIFESTS, BUILTIN_PLUGIN_PACKAGE_METADATA } from './builtinPlugins'
import { installedPlugins, manifestFromPluginRow } from './pluginStore'
import type { PluginManifest } from './types'
import type { OpenForgePackageMetadata } from '@openforge/plugin-sdk'

type InstalledPluginRow = {
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
  sourceKind?: string
  sourceSpec?: string
  packageMetadata?: string
  installedAt?: number
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function setPluginRuntimeState(pluginId: string, state: 'installed' | 'active' | 'error', error: string | null): void {
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

export function setPluginRuntimeError(pluginId: string, error: unknown): void {
  setPluginRuntimeState(pluginId, 'error', normalizeErrorMessage(error))
}

export function getPackageMetadataForPlugin(pluginId: string, manifest: PluginManifest): OpenForgePackageMetadata {
  const entry = get(installedPlugins).get(pluginId)
  const builtinMetadata = BUILTIN_PLUGIN_PACKAGE_METADATA.find(metadata => metadata.id === pluginId)
  return entry?.packageMetadata ?? builtinMetadata ?? {
    id: pluginId,
    apiVersion: 1,
    displayName: manifest.name,
    description: manifest.description,
    frontend: manifest.frontend ?? undefined,
    backend: manifest.backend ?? undefined,
  }
}

export function upsertInstalledPlugin(row: InstalledPluginRow): void {
  const { manifest, packageMetadata } = manifestFromPluginRow({
    sourceKind: 'legacy',
    sourceSpec: '',
    packageMetadata: '{}',
    installedAt: 0,
    ...row,
  })

  installedPlugins.update(map => {
    const next = new Map(map)
    next.set(row.id, {
      manifest,
      state: 'installed',
      error: null,
      installPath: row.installPath,
      isBuiltin: row.isBuiltin,
      packageMetadata,
      sourceKind: row.sourceKind,
      sourceSpec: row.sourceSpec,
      installedAt: row.installedAt,
    })
    return next
  })
}

export async function installPluginFromNpm(packageName: string): Promise<void> {
  const row = await installPluginFromNpmIpc(packageName)
  upsertInstalledPlugin(row)
}

export async function installPluginFromGit(gitSpec: string): Promise<void> {
  const row = await installPluginFromGitIpc(gitSpec)
  upsertInstalledPlugin(row)
}

export async function installFromLocal(pluginPath: string, _projectId: string): Promise<void> {
  const row = await installPluginFromLocalIpc(pluginPath)
  upsertInstalledPlugin(row)
}

export async function installPluginFromManifest(_manifest: PluginManifest, _installPath: string): Promise<void> {
  throw new Error('Legacy manifest.json plugin installation is no longer supported; install package.json#openforge plugins and register contributions at runtime')
}

export async function initializePluginRuntime(): Promise<void> {
  const { loadInstalledPlugins } = await import('./pluginStore')
  await loadInstalledPlugins()

  for (const manifest of BUILTIN_PLUGIN_MANIFESTS) {
    const packageMetadata = getPackageMetadataForPlugin(manifest.id, manifest)
    await registerBuiltinPlugin({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      apiVersion: manifest.apiVersion,
      description: manifest.description,
      permissions: JSON.stringify(manifest.permissions),
      contributes: '{}',
      frontendEntry: manifest.frontend ?? '',
      backendEntry: manifest.backend,
      installPath: `builtin:${manifest.id}`,
      sourceKind: 'builtin',
      sourceSpec: manifest.id,
      packageMetadata: JSON.stringify(packageMetadata),
      installedAt: Date.now(),
      isBuiltin: true,
    })
  }

  await loadInstalledPlugins()
}
