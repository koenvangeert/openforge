import { describe, expect, it } from 'vitest'
import { isOpenForgePackageMetadata } from '@openforge/plugin-sdk'
import { BUILTIN_PLUGIN_CATALOG, BUILTIN_PLUGIN_MANIFESTS, BUILTIN_PLUGIN_PACKAGE_METADATA } from './builtinPlugins'

describe('built-in plugin package metadata', () => {
  it('installs built-ins from package.json#openforge metadata without manifest contributions', () => {
    expect(BUILTIN_PLUGIN_PACKAGE_METADATA).not.toEqual([])
    expect(BUILTIN_PLUGIN_PACKAGE_METADATA.every(isOpenForgePackageMetadata)).toBe(true)
    expect(BUILTIN_PLUGIN_PACKAGE_METADATA.map(metadata => metadata.id)).toEqual(BUILTIN_PLUGIN_CATALOG.map(plugin => plugin.id))
    expect(BUILTIN_PLUGIN_MANIFESTS.map(manifest => manifest.id)).toEqual(BUILTIN_PLUGIN_CATALOG.map(plugin => plugin.id))
    expect(BUILTIN_PLUGIN_MANIFESTS.every(manifest => !('contributes' in manifest))).toBe(true)
    expect(BUILTIN_PLUGIN_MANIFESTS.every(manifest => manifest.frontend === './dist/frontend.js')).toBe(true)
    expect(BUILTIN_PLUGIN_CATALOG.every(plugin => plugin.directoryName.length > 0)).toBe(true)
  })
})
