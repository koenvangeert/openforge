import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

const pluginSrcDir = dirname(fileURLToPath(import.meta.url))

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
  it('does not retain stale host PluginContext state in the skills viewer plugin entry', () => {
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

  it('forwards skill list and save through explicit openforge.* runtime commands', async () => {
    const { listOpenCodeSkills, saveSkillContent } = await import('./lib/ipc')
    const { api, invokeGlobal } = makeRuntimeHarness()
    const skills = [{ name: 'reviewer', level: 'project' as const, source_dir: '/skills', description: 'Reviews code' }]
    invokeGlobal.mockResolvedValueOnce(skills).mockResolvedValueOnce(undefined)

    await expect(listOpenCodeSkills(api, 'P-1')).resolves.toEqual(skills)
    await expect(saveSkillContent(api, 'P-1', 'reviewer', 'project', '/skills', 'content')).resolves.toBeUndefined()
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
