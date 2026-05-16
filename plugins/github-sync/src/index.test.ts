import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

const pluginSrcDir = dirname(fileURLToPath(import.meta.url))

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
  it('does not retain stale host PluginContext state in the GitHub sync plugin entry', () => {
    const indexSource = readFileSync(join(pluginSrcDir, 'index.ts'), 'utf8')

    expect(indexSource).not.toContain('./pluginContext')
    expect(indexSource).not.toContain('setPluginContext')
    expect(existsSync(join(pluginSrcDir, 'pluginContext.ts'))).toBe(false)
  })

  it('has valid package.json#openforge metadata without manifest contributions', () => {
    expect(isOpenForgePackageMetadata(packageJson.openforge)).toBe(true)
    expect(packageJson.openforge).not.toHaveProperty('contributes')
    expect(packageJson.openforge.frontend).toBe('./dist/frontend.js')
  })

  it('uses shared PR review UI components instead of plugin-local duplicate leaf components', () => {
    const prReviewSource = readFileSync(join(pluginSrcDir, 'review/pr/PrReviewView.svelte'), 'utf8')

    expect(prReviewSource).toContain('@openforge/pr-review-ui/PrOverviewTab.svelte')
    expect(prReviewSource).toContain('@openforge/pr-review-ui/ReviewSubmitPanel.svelte')
    expect(prReviewSource).toContain('@openforge/pr-review-ui/ReviewPrCard.svelte')
    expect(prReviewSource).toContain('@openforge/pr-review-ui/AuthoredPrCard.svelte')
    expect(prReviewSource).toContain('@openforge/pr-review-ui/FileTree.svelte')
    expect(existsSync(join(pluginSrcDir, 'lib/ipc.ts'))).toBe(false)
    expect(existsSync(join(pluginSrcDir, 'review/pr/PrOverviewTab.svelte'))).toBe(false)
    expect(existsSync(join(pluginSrcDir, 'review/pr/ReviewSubmitPanel.svelte'))).toBe(false)
    expect(existsSync(join(pluginSrcDir, 'review/pr/ReviewPrCard.svelte'))).toBe(false)
    expect(existsSync(join(pluginSrcDir, 'review/pr/AuthoredPrCard.svelte'))).toBe(false)
    expect(existsSync(join(pluginSrcDir, 'review/shared/FileTree.svelte'))).toBe(false)
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
    expect(invokeGlobal).toHaveBeenCalledWith('openforge.forceGithubSync')
    expect(invokeGlobal).toHaveBeenCalledWith('openforge.getNavigation')
    expect(onGlobal).toHaveBeenCalledWith('openforge.navigation-changed', expect.any(Function))
  })
})
