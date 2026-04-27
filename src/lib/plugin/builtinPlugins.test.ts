import { describe, expect, it } from 'vitest'
import { BUILTIN_PLUGIN_MANIFESTS } from './builtinPlugins'

describe('BUILTIN_PLUGIN_MANIFESTS', () => {
  it('do not advertise unused standalone frontend bundle paths', () => {
    expect(BUILTIN_PLUGIN_MANIFESTS).not.toEqual([])
    expect(BUILTIN_PLUGIN_MANIFESTS.every(manifest => manifest.frontend === null)).toBe(true)
  })
})
