import { describe, expect, it, vi } from 'vitest'
import { OPENFORGE_FRONTEND_PLUGIN_MARKER } from '@openforge/plugin-sdk/frontend'
import { isOpenForgePackageMetadata } from '@openforge/plugin-sdk'
import type { FrontendOpenForgeAPI, FrontendPluginContext } from '@openforge/plugin-sdk/frontend'

const { mockSkillsView } = vi.hoisted(() => ({
  mockSkillsView: { name: 'SkillsViewComponent' },
}))

vi.mock('./SkillsView.svelte', () => ({
  default: mockSkillsView,
}))

import packageJson from '../package.json'

function makeRuntimeHarness() {
  const subscriptions = { add: vi.fn() }
  const invokeGlobal = vi.fn()
  const api = {
    views: { register: vi.fn(() => ({ dispose: vi.fn() })) },
    commands: { invokeGlobal },
    events: { emitGlobal: vi.fn() },
    system: { openUrl: vi.fn() },
    context: { getSnapshot: vi.fn(() => ({ pluginId: packageJson.openforge.id, projectId: null })) },
  } as unknown as FrontendOpenForgeAPI
  const context = { pluginId: packageJson.openforge.id, apiVersion: 1, packageMetadata: packageJson.openforge, subscriptions } as FrontendPluginContext
  return { api, context, subscriptions, invokeGlobal }
}

describe('skills-viewer plugin', () => {
  it('has valid package.json#openforge metadata without manifest contributions', () => {
    expect(isOpenForgePackageMetadata(packageJson.openforge)).toBe(true)
    expect(packageJson.openforge).not.toHaveProperty('contributes')
    expect(packageJson.openforge.frontend).toBe('./dist/frontend.js')
  })

  it('registers the Skills view at runtime through defineFrontendPlugin', async () => {
    const { default: plugin, SkillsViewComponent } = await import('./index')
    const { api, context, subscriptions } = makeRuntimeHarness()

    await plugin.activate(api, context)

    expect(plugin[OPENFORGE_FRONTEND_PLUGIN_MARKER]).toBe(true)
    expect(api.views.register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'skills',
      title: 'Skills',
      icon: 'sparkles',
      placement: 'rail',
      order: 30,
      component: SkillsViewComponent,
    }))
    expect(SkillsViewComponent).toBe(mockSkillsView)
    expect(subscriptions.add).toHaveBeenCalledWith(expect.objectContaining({ dispose: expect.any(Function) }))
  })

  it('forwards skill list and save host commands through the runtime command bridge', async () => {
    const { default: plugin } = await import('./index')
    const { listOpenCodeSkills, saveSkillContent } = await import('./lib/ipc')
    const { api, context, invokeGlobal } = makeRuntimeHarness()
    const skills = [{ name: 'reviewer', level: 'project', source_dir: '/skills', description: 'Reviews code' }]
    invokeGlobal.mockResolvedValueOnce(skills).mockResolvedValueOnce(undefined)

    await plugin.activate(api, context)

    await expect(listOpenCodeSkills('P-1')).resolves.toEqual(skills)
    await expect(saveSkillContent('P-1', 'reviewer', 'project', '/skills', 'content')).resolves.toBeUndefined()
    expect(invokeGlobal).toHaveBeenNthCalledWith(1, 'openforge.listOpenCodeSkills', { projectId: 'P-1' })
    expect(invokeGlobal).toHaveBeenNthCalledWith(2, 'openforge.saveSkillContent', {
      projectId: 'P-1',
      name: 'reviewer',
      level: 'project',
      sourceDir: '/skills',
      content: 'content',
    })
  })
})
