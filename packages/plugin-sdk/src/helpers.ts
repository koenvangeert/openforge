import type { OpenForgePackageMetadata, OpenForgePluginCapability } from './types'

export function getRequiredOpenForgeCapabilities(metadata: OpenForgePackageMetadata): OpenForgePluginCapability[] {
  return metadata.requires ?? []
}

export function hasFrontendEntry(metadata: OpenForgePackageMetadata): boolean {
  return typeof metadata.frontend === 'string' && metadata.frontend.length > 0
}

export function hasBackendEntry(metadata: OpenForgePackageMetadata): boolean {
  return typeof metadata.backend === 'string' && metadata.backend.length > 0
}
