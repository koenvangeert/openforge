import { describe, expect, it } from 'vitest'
import { validatePluginManifest } from '@openforge/plugin-sdk'
import manifest from '../manifest.json'

describe('terminal plugin', () => {
  it('has a valid manifest', () => {
    const errors = validatePluginManifest(manifest)
    expect(errors).toEqual([])
  })

  it('activates without error', async () => {
    const { activate } = await import('./index')
    const result = await activate({
      pluginId: 'test-plugin',
      invokeHost: async () => null,
      invokeBackend: async () => null,
      onEvent: () => () => {},
      storage: { get: async () => null, set: async () => {} },
    })
    expect(result).toBeDefined()
  })

  it('deactivates without error', async () => {
    const { deactivate } = await import('./index')
    await expect(deactivate()).resolves.toBeUndefined()
  })
})
