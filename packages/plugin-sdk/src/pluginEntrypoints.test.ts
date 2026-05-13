import { describe, expect, it, vi } from 'vitest'

import { defineBackendPlugin } from '@openforge/plugin-sdk/backend'
import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'

import type {
  BackendOpenForgeAPI,
  BackendPluginContext,
  Disposable,
  FrontendOpenForgeAPI,
  FrontendPluginContext,
} from './types'

function disposable(): Disposable {
  return { dispose: vi.fn() }
}

describe('frontend/backend plugin entrypoints', () => {
  it('defines frontend plugins through the frontend export', async () => {
    const activate = vi.fn((openforge: FrontendOpenForgeAPI, context: FrontendPluginContext) => {
      context.subscriptions.add(openforge.views.register({
        id: 'prs',
        title: 'Pull Requests',
        icon: 'git-pull-request',
        placement: 'rail',
        order: 50,
        component: () => Promise.resolve({ default: vi.fn() }),
      }))
    })
    const plugin = defineFrontendPlugin({ activate })
    const views = { register: vi.fn(() => disposable()) }
    const subscriptions = { add: vi.fn() }

    await plugin.activate({ views } as unknown as FrontendOpenForgeAPI, { subscriptions } as unknown as FrontendPluginContext)

    expect(plugin.activate).toBe(activate)
    expect(views.register).toHaveBeenCalledWith(expect.objectContaining({ id: 'prs' }))
    expect(subscriptions.add).toHaveBeenCalledWith(expect.objectContaining({ dispose: expect.any(Function) }))
  })

  it('defines backend plugins through the backend export', async () => {
    const activate = vi.fn((openforge: BackendOpenForgeAPI, context: BackendPluginContext) => {
      context.subscriptions.add(openforge.backend.registerMethod('syncProject', {
        input: { type: 'object' },
        output: { type: 'object' },
        handler: async ({ projectId }: { projectId: string }) => ({ projectId, synced: 1 }),
      }))
    })
    const plugin = defineBackendPlugin({ activate })
    const backend = { registerMethod: vi.fn(() => disposable()) }
    const subscriptions = { add: vi.fn() }

    await plugin.activate({ backend } as unknown as BackendOpenForgeAPI, { subscriptions } as unknown as BackendPluginContext)

    expect(plugin.activate).toBe(activate)
    expect(backend.registerMethod).toHaveBeenCalledWith('syncProject', expect.objectContaining({ handler: expect.any(Function) }))
    expect(subscriptions.add).toHaveBeenCalledWith(expect.objectContaining({ dispose: expect.any(Function) }))
  })
})
