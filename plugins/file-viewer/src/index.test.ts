import { describe, expect, it, vi } from 'vitest'
import { OPENFORGE_FRONTEND_PLUGIN_MARKER } from '@openforge/plugin-sdk/frontend'
import { isOpenForgePackageMetadata } from '@openforge/plugin-sdk'
import type { FrontendOpenForgeAPI, FrontendPluginContext } from '@openforge/plugin-sdk/frontend'

const { mockFilesView } = vi.hoisted(() => ({
  mockFilesView: { name: 'FilesViewComponent' },
}))

vi.mock('./FilesView.svelte', () => ({
  default: mockFilesView,
}))

import packageJson from '../package.json'

function makeRuntimeHarness() {
  const subscriptions = { add: vi.fn() }
  const api = {
    views: { register: vi.fn(() => ({ dispose: vi.fn() })) },
  } as unknown as FrontendOpenForgeAPI
  const context = {
    pluginId: packageJson.openforge.id,
    apiVersion: 1,
    packageMetadata: packageJson.openforge,
    subscriptions,
  } as FrontendPluginContext

  return { api, context, subscriptions }
}

describe('file-viewer plugin', () => {
  it('has valid package.json#openforge metadata without manifest contributions', () => {
    expect(isOpenForgePackageMetadata(packageJson.openforge)).toBe(true)
    expect(packageJson.openforge).not.toHaveProperty('contributes')
    expect(packageJson.openforge.frontend).toBe('./dist/frontend.js')
  })

  it('registers the Files view at runtime through defineFrontendPlugin', async () => {
    const { default: plugin, FilesViewComponent } = await import('./index')
    const { api, context, subscriptions } = makeRuntimeHarness()

    await plugin.activate(api, context)

    expect(plugin[OPENFORGE_FRONTEND_PLUGIN_MARKER]).toBe(true)
    expect(api.views.register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'files',
      title: 'Files',
      icon: 'folder-open',
      placement: 'rail',
      order: 10,
      component: FilesViewComponent,
    }))
    expect(FilesViewComponent).toBe(mockFilesView)
    expect(subscriptions.add).toHaveBeenCalledWith(expect.objectContaining({ dispose: expect.any(Function) }))
  })
})
