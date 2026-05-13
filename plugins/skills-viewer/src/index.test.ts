import { describe, expect, it, vi } from 'vitest'

const { mockSkillsView } = vi.hoisted(() => ({
  mockSkillsView: { name: 'SkillsViewComponent' },
}))

vi.mock('./SkillsView.svelte', () => ({
  default: mockSkillsView,
}))

import manifest from '../manifest.json'
import { validatePluginManifest } from '../../../src/lib/plugin/manifest'

describe('skills-viewer plugin', () => {
  it('has a valid manifest', () => {
    const errors = validatePluginManifest(manifest)
    expect(errors).toEqual([])
  })

  it('activates the Skills view contribution', async () => {
    const { activate, SkillsViewComponent } = await import('./index')

    const result = await activate({
      pluginId: 'test-plugin',
      invokeHost: async () => null,
      invokeBackend: async () => null,
      onEvent: () => () => {},
      storage: {
        get: async () => null,
        set: async () => {},
      },
    })

    expect(result.contributions.views).toHaveLength(1)
    expect(result.contributions.views?.[0]?.id).toBe('skills')
    expect(result.contributions.views?.[0]?.component).toBe(SkillsViewComponent)
    expect(SkillsViewComponent).toBe(mockSkillsView)
  })

  it('deactivates without throwing', async () => {
    const { deactivate } = await import('./index')

    await expect(deactivate()).resolves.toBeUndefined()
  })
})
