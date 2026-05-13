import { describe, expect, it } from 'vitest'

import {
  MAX_SUPPORTED_API_VERSION,
  OPENFORGE_PACKAGE_METADATA_SCHEMA,
  OPENFORGE_PLUGIN_API_VERSION,
  isOpenForgePackageMetadata,
  validateOpenForgePackageMetadata,
} from './index'

describe('Plugin SDK root export', () => {
  it('exports shared package contract helpers', () => {
    expect(OPENFORGE_PLUGIN_API_VERSION).toBe(1)
    expect(MAX_SUPPORTED_API_VERSION).toBeGreaterThan(0)
    expect(typeof validateOpenForgePackageMetadata).toBe('function')
    expect(typeof isOpenForgePackageMetadata).toBe('function')
    expect(OPENFORGE_PACKAGE_METADATA_SCHEMA.title).toBe('OpenForge package metadata')
  })

  it('does not expose legacy manifest contribution validation from the root contract', async () => {
    const sdk = await import('./index')

    expect(sdk).not.toHaveProperty('validatePluginManifest')
    expect(sdk).not.toHaveProperty('PluginContextImpl')
    expect(sdk).not.toHaveProperty('getViewContributions')
  })
})
