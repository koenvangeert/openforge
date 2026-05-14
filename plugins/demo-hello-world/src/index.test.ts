import { describe, it, expect, vi } from 'vitest'
import { OPENFORGE_FRONTEND_PLUGIN_MARKER } from '@openforge/plugin-sdk/frontend'
import { isOpenForgePackageMetadata } from '@openforge/plugin-sdk'
import type { FrontendOpenForgeAPI, FrontendPluginContext } from '@openforge/plugin-sdk/frontend'
import packageJson from '../package.json'

const { mockHelloWorldView, mockDemoTab } = vi.hoisted(() => ({
  mockHelloWorldView: { name: 'HelloWorldViewComponent' },
  mockDemoTab: { name: 'DemoTabComponent' },
}))

vi.mock('./components/HelloWorldView.svelte', () => ({ default: mockHelloWorldView }))
vi.mock('./components/DemoTab.svelte', () => ({ default: mockDemoTab }))

function makeRuntimeHarness() {
  const subscriptions = { add: vi.fn() }
  const api = {
    views: { register: vi.fn(() => ({ dispose: vi.fn() })) },
    taskPane: { registerTab: vi.fn(() => ({ dispose: vi.fn() })) },
    commands: { register: vi.fn(() => ({ dispose: vi.fn() })) },
    settings: { registerSection: vi.fn(() => ({ dispose: vi.fn() })) },
  } as unknown as FrontendOpenForgeAPI
  const context = { pluginId: packageJson.openforge.id, apiVersion: 1, packageMetadata: packageJson.openforge, subscriptions } as FrontendPluginContext
  return { api, context, subscriptions }
}

describe('demo-hello-world plugin', () => {
  it('has valid package.json#openforge metadata without manifest contributions', () => {
    expect(isOpenForgePackageMetadata(packageJson.openforge)).toBe(true)
    expect(packageJson.openforge).not.toHaveProperty('contributes')
    expect(packageJson.openforge.frontend).toBe('./dist/frontend.js')
  })

  it('registers demo view, task pane, command, and settings at runtime', async () => {
    const { default: plugin } = await import('./index')
    const { api, context, subscriptions } = makeRuntimeHarness()

    await plugin.activate(api, context)

    expect(plugin[OPENFORGE_FRONTEND_PLUGIN_MARKER]).toBe(true)
    expect(api.views.register).toHaveBeenCalledWith(expect.objectContaining({ id: 'hello', component: mockHelloWorldView }))
    expect(api.taskPane.registerTab).toHaveBeenCalledWith(expect.objectContaining({ id: 'demo-tab', component: mockDemoTab }))
    expect(api.commands.register).toHaveBeenCalledWith(expect.objectContaining({ id: 'say-hello', handler: expect.any(Function) }))
    expect(api.settings.registerSection).toHaveBeenCalledWith(expect.objectContaining({ id: 'demo-settings', component: mockDemoTab }))
    expect(subscriptions.add).toHaveBeenCalledTimes(4)
  })
})
