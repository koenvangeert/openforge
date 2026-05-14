import { isOpenForgePackageMetadata } from '@openforge/plugin-sdk'
import type { OpenForgePackageMetadata } from '@openforge/plugin-sdk'
import type { PluginManifest } from './types'

type BuiltinPluginPackageJson = {
  name: string
  version: string
  openforge: unknown
}

export function getBuiltinOpenForgeMetadata(packageJson: BuiltinPluginPackageJson): OpenForgePackageMetadata {
  if (!isOpenForgePackageMetadata(packageJson.openforge)) {
    throw new Error(`Invalid package.json#openforge metadata for ${packageJson.name}`)
  }

  return packageJson.openforge
}

export function manifestFromBuiltinPackage(packageJson: BuiltinPluginPackageJson): PluginManifest {
  const metadata = getBuiltinOpenForgeMetadata(packageJson)

  return {
    id: metadata.id,
    name: metadata.displayName,
    version: packageJson.version,
    apiVersion: metadata.apiVersion,
    description: metadata.description,
    permissions: [],
    contributes: {},
    frontend: metadata.frontend ?? null,
    backend: metadata.backend ?? null,
  }
}
