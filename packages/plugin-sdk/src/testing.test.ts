import { describe, expect, it } from 'vitest'

import { defineBackendPlugin } from '@openforge/plugin-sdk/backend'
import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import {
  createMockBackendOpenForgeApi,
  createMockFrontendOpenForgeApi,
  createMockOpenForgeApi,
  createOpenForgeRegistryFake,
} from '@openforge/plugin-sdk/testing'

const Component = (() => null) as never

describe('plugin SDK testing utilities', () => {
  it('creates frontend OpenForgeAPI mocks with registry fakes for plugin activation assertions', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'github', projectId: 'P-1' })
    const plugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({
          id: 'prs',
          title: 'Pull Requests',
          icon: 'git-pull-request',
          placement: 'rail',
          component: Component,
        }))
        context.subscriptions.add(openforge.commands.register({
          id: 'refresh',
          title: 'Refresh',
          handler: async (input: { force: boolean }) => ({ refreshed: input.force }),
        }))
      },
    })

    await registry.activateFrontend(plugin)

    expect(registry.snapshot.views).toMatchObject([
      { id: 'prs', qualifiedId: 'github.prs', pluginId: 'github', projectId: 'P-1', title: 'Pull Requests' },
    ])
    await expect(registry.frontendApi.commands.invoke('refresh', { force: true })).resolves.toEqual({ refreshed: true })
    expect(await registry.frontendApi.commands.list()).toMatchObject([
      { id: 'refresh', qualifiedId: 'github.refresh', title: 'Refresh' },
    ])

    await registry.disposeAll()
    expect(registry.snapshot.views).toEqual([])
    await expect(registry.frontendApi.commands.invoke('refresh', { force: true })).rejects.toThrow('Unknown command: github.refresh')
  })

  it('shares storage, backend methods, background services, and events across frontend/backend API fakes', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'sync', projectId: 'P-1' })
    const seen: unknown[] = []
    const backend = defineBackendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.backend.registerMethod('syncProject', {
          handler: async (input: { projectId: string }) => ({ synced: input.projectId }),
        }))
        context.subscriptions.add(openforge.background.register({
          id: 'poller',
          scope: 'project',
          start: async () => {
            await openforge.storage.project('P-1').set('lastRun', { ok: true })
            await openforge.events.emit('sync.started', { projectId: 'P-1' })
          },
          stop: async () => {
            seen.push('stopped')
          },
        }))
      },
    })

    registry.frontendApi.events.on('sync.started', (payload) => seen.push(payload))
    await registry.activateBackend(backend)

    await expect(registry.frontendApi.backend.invoke('syncProject', { projectId: 'P-1' })).resolves.toEqual({ synced: 'P-1' })
    await expect(registry.frontendApi.storage.project('P-1').get('lastRun')).resolves.toEqual({ ok: true })
    expect(seen).toEqual([{ projectId: 'P-1' }])
    expect(registry.snapshot.backgroundServices).toMatchObject([
      { id: 'poller', qualifiedId: 'sync.poller', scope: 'project', started: true },
    ])

    await registry.disposeAll()
    expect(seen).toEqual([{ projectId: 'P-1' }, 'stopped'])
  })

  it('offers direct createMockOpenForgeApi aliases and call recording for host capabilities', async () => {
    const api = createMockOpenForgeApi({ pluginId: 'demo', projectId: 'P-1' })
    const frontendApi = createMockFrontendOpenForgeApi({ pluginId: 'demo' })
    const backendApi = createMockBackendOpenForgeApi({ pluginId: 'demo' })

    await api.system.openUrl('https://example.com')
    await api.notifications.notify({ title: 'Ready' })
    await frontendApi.storage.global.set('flag', true)

    expect(api.__testing.calls.openUrl).toEqual(['https://example.com'])
    expect(api.__testing.calls.notify).toEqual([{ title: 'Ready' }])
    await expect(frontendApi.storage.global.get('flag')).resolves.toBe(true)
    expect(backendApi.context.getSnapshot()).toEqual({ pluginId: 'demo', projectId: null })
  })
})
