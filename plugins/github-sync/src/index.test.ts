import { describe, expect, it, vi } from 'vitest'

const { mockPrReviewView } = vi.hoisted(() => ({
  mockPrReviewView: { name: 'PrReviewViewComponent' },
}))

vi.mock('./review/pr/PrReviewView.svelte', () => ({
  default: mockPrReviewView,
}))

import manifest from '../manifest.json'
import { validatePluginManifest } from '../../../src/lib/plugin/manifest'

describe('github-sync plugin', () => {
  it('has a valid manifest', () => {
    const errors = validatePluginManifest(manifest)
    expect(errors).toEqual([])
  })

  it('activates the PR review view contribution', async () => {
    const { activate, PrReviewViewComponent } = await import('./index')

    const invokeHost = vi.fn(async (command: string) => {
      if (command === 'getNavigation') {
        return { activeProjectId: 'project-1' }
      }

      return null
    })
    const unsubscribe = vi.fn()

    const result = await activate({
      pluginId: 'test-plugin',
      invokeHost,
      invokeBackend: async () => null,
      onEvent: () => unsubscribe,
      storage: {
        get: async () => null,
        set: async () => {},
      },
    })

    expect(result.contributions.views).toHaveLength(1)
    expect(result.contributions.views?.[0]?.id).toBe('pr_review')
    expect(result.contributions.views?.[0]?.component).toBe(PrReviewViewComponent)
    expect(PrReviewViewComponent).toBe(mockPrReviewView)

    expect(result.contributions.commands).toHaveLength(1)
    await result.contributions.commands?.[0]?.execute()
    expect(invokeHost).toHaveBeenCalledWith('forceGithubSync')

    expect(result.contributions.backgroundServices).toHaveLength(1)
    await result.contributions.backgroundServices?.[0]?.start()
    expect(invokeHost).toHaveBeenCalledWith('getNavigation')
    expect(invokeHost).toHaveBeenCalledTimes(3)
    await result.contributions.backgroundServices?.[0]?.stop?.()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('deactivates without throwing', async () => {
    const { deactivate } = await import('./index')

    await expect(deactivate()).resolves.toBeUndefined()
  })
})
