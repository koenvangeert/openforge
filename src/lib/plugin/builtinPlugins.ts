import builtinPluginCatalogJson from '../../../builtin-plugins.json'
import { getBuiltinOpenForgeMetadata, manifestFromBuiltinPackage } from './builtinPluginMetadata'
import type { OpenForgePackageMetadata } from '@openforge/plugin-sdk'
import type { PluginManifest } from './types'

type BuiltinPluginCatalogEntry = {
  id: string
  directoryName: string
}

type BuiltinPluginCatalog = {
  plugins: BuiltinPluginCatalogEntry[]
}

type BuiltinPluginPackageJson = Parameters<typeof getBuiltinOpenForgeMetadata>[0]

const builtinPluginCatalog = builtinPluginCatalogJson as BuiltinPluginCatalog
const builtinPluginPackagesByPath = import.meta.glob<BuiltinPluginPackageJson>('../../../plugins/*/package.json', {
  eager: true,
  import: 'default',
})

export const BUILTIN_PLUGIN_CATALOG: BuiltinPluginCatalogEntry[] = builtinPluginCatalog.plugins

function packageJsonForBuiltinPlugin(plugin: BuiltinPluginCatalogEntry): BuiltinPluginPackageJson {
  const packageJson = builtinPluginPackagesByPath[`../../../plugins/${plugin.directoryName}/package.json`]
  if (!packageJson) {
    throw new Error(`Missing package.json import for builtin plugin ${plugin.id} at plugins/${plugin.directoryName}`)
  }

  const metadata = getBuiltinOpenForgeMetadata(packageJson)
  if (metadata.id !== plugin.id) {
    throw new Error(`Builtin plugin catalog id ${plugin.id} does not match plugins/${plugin.directoryName}/package.json id ${metadata.id}`)
  }

  return packageJson
}

const BUILTIN_PLUGIN_PACKAGES = BUILTIN_PLUGIN_CATALOG.map(packageJsonForBuiltinPlugin)

export const BUILTIN_PLUGIN_PACKAGE_METADATA: OpenForgePackageMetadata[] = BUILTIN_PLUGIN_PACKAGES.map(getBuiltinOpenForgeMetadata)

export const BUILTIN_PLUGIN_MANIFESTS: PluginManifest[] = BUILTIN_PLUGIN_PACKAGES.map(manifestFromBuiltinPackage)
