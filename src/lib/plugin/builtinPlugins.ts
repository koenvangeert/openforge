import fileViewerPackageJson from '../../../plugins/file-viewer/package.json'
import githubSyncPackageJson from '../../../plugins/github-sync/package.json'
import skillsViewerPackageJson from '../../../plugins/skills-viewer/package.json'
import terminalPackageJson from '../../../plugins/terminal/package.json'
import { getBuiltinOpenForgeMetadata, manifestFromBuiltinPackage } from './builtinPluginMetadata'
import type { OpenForgePackageMetadata } from '@openforge/plugin-sdk'
import type { PluginManifest } from './types'

const BUILTIN_PLUGIN_PACKAGES = [
  fileViewerPackageJson,
  githubSyncPackageJson,
  skillsViewerPackageJson,
  terminalPackageJson,
] as const

export const BUILTIN_PLUGIN_PACKAGE_METADATA: OpenForgePackageMetadata[] = BUILTIN_PLUGIN_PACKAGES.map(getBuiltinOpenForgeMetadata)

export const BUILTIN_PLUGIN_MANIFESTS: PluginManifest[] = BUILTIN_PLUGIN_PACKAGES.map(manifestFromBuiltinPackage)
