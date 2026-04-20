import { describe, expect, it, vi } from 'vitest'

const { mockPrReviewView } = vi.hoisted(() => ({
  mockPrReviewView: { name: 'PrReviewViewComponent' },
}))

vi.mock('../../../src/components/review/pr/PrReviewView.svelte', () => ({
  default: mockPrReviewView,
}))

import manifest from '../manifest.json'
import { validatePluginManifest } from '@openforge/plugin-sdk'

describe('github-sync plugin', () => {
  it('has a valid manifest', () => {
    const errors = validatePluginManifest(manifest)
    expect(errors).toEqual([])
  })

  it('activates the PR review view contribution', async () => {
    const { activate, PrReviewViewComponent } = await import('./index')

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
    expect(result.contributions.views?.[0]?.id).toBe('pr_review')
    expect(result.contributions.views?.[0]?.component).toBe(PrReviewViewComponent)
    expect(PrReviewViewComponent).toBe(mockPrReviewView)
  })

  it('deactivates without throwing', async () => {
    const { deactivate } = await import('./index')

    await expect(deactivate()).resolves.toBeUndefined()
  })
})
