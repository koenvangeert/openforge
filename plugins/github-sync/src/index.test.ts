import { describe, expect, it, vi } from 'vitest'
import { OPENFORGE_FRONTEND_PLUGIN_MARKER } from '@openforge/plugin-sdk/frontend'
import { isOpenForgePackageMetadata } from '@openforge/plugin-sdk'
import type { FrontendOpenForgeAPI, FrontendPluginContext } from '@openforge/plugin-sdk/frontend'

const { mockPrReviewView } = vi.hoisted(() => ({
  mockPrReviewView: { name: 'PrReviewViewComponent' },
}))

vi.mock('./review/pr/PrReviewView.svelte', () => ({
  default: mockPrReviewView,
}))

import packageJson from '../package.json'

function makeRuntimeHarness() {
  const subscriptions = { add: vi.fn() }
  const invokeGlobal = vi.fn(async (command: string) => command === 'openforge.getNavigation' ? { activeProjectId: 'project-1' } : null)
  const onGlobal = vi.fn(() => ({ dispose: vi.fn() }))
  const api = {
    views: { register: vi.fn(() => ({ dispose: vi.fn() })) },
    commands: { register: vi.fn(() => ({ dispose: vi.fn() })), invokeGlobal },
    events: { onGlobal },
  } as unknown as FrontendOpenForgeAPI
  const context = { pluginId: packageJson.openforge.id, apiVersion: 1, packageMetadata: packageJson.openforge, subscriptions } as FrontendPluginContext
  return { api, context, subscriptions, invokeGlobal, onGlobal }
}

describe('github-sync plugin', () => {
  it('has valid package.json#openforge metadata without manifest contributions', () => {
    expect(isOpenForgePackageMetadata(packageJson.openforge)).toBe(true)
    expect(packageJson.openforge).not.toHaveProperty('contributes')
    expect(packageJson.openforge.frontend).toBe('./dist/frontend.js')
  })

  it('registers PR view and refresh command at runtime through defineFrontendPlugin', async () => {
    const { default: plugin, PrReviewViewComponent } = await import('./index')
    const { api, context, subscriptions, invokeGlobal, onGlobal } = makeRuntimeHarness()

    await plugin.activate(api, context)

    expect(plugin[OPENFORGE_FRONTEND_PLUGIN_MARKER]).toBe(true)
    expect(api.views.register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'pr_review',
      title: 'Pull Requests',
      icon: 'git-pull-request',
      placement: 'rail',
      order: 20,
      component: PrReviewViewComponent,
    }))
    expect(api.commands.register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'refresh',
      title: 'Refresh Pull Requests',
      handler: expect.any(Function),
    }))
    expect(PrReviewViewComponent).toBe(mockPrReviewView)
    expect(subscriptions.add).toHaveBeenCalledWith(expect.objectContaining({ dispose: expect.any(Function) }))

    const refreshRegistration = vi.mocked(api.commands.register).mock.calls[0]?.[0]
    await refreshRegistration?.handler(undefined)
    expect(invokeGlobal).toHaveBeenCalledWith('openforge.forceGithubSync', undefined)
    expect(invokeGlobal).toHaveBeenCalledWith('openforge.getNavigation', undefined)
    expect(onGlobal).toHaveBeenCalledWith('openforge.navigation-changed', expect.any(Function))
  })
})
