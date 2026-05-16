import type { OpenForgePackageMetadata } from '@openforge/plugin-sdk'

export { MAX_SUPPORTED_API_VERSION } from '@openforge/plugin-sdk'

export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: number
  description: string
  permissions: string[]
  frontend: string | null
  backend: string | null
}

export type PluginViewKey = `plugin:${string}:${string}`

export function makePluginViewKey(pluginId: string, viewId: string): PluginViewKey {
  return `plugin:${pluginId}:${viewId}`
}

export function isPluginViewKey(value: string): value is PluginViewKey {
  return value.startsWith('plugin:') && value.match(/^plugin:[^:]+:[^:]+$/) !== null
}

export function parsePluginViewKey(key: PluginViewKey): { pluginId: string; viewId: string } {
  const parts = key.split(':')
  return { pluginId: parts[1], viewId: parts[2] }
}

export type PluginState = 'installed' | 'active' | 'error' | 'disabled'

export interface PluginEntry {
  manifest: PluginManifest
  state: PluginState
  error: string | null
  installPath?: string
  isBuiltin?: boolean
  packageMetadata?: OpenForgePackageMetadata | null
  sourceKind?: string
  sourceSpec?: string
  installedAt?: number
}

