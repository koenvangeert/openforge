import { describe, expect, it, vi } from 'vitest'
import { defineBackendPlugin } from '@openforge/plugin-sdk/backend'
import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'

import { createRuntimeContributionRegistry, qualifyLocalContributionId } from './runtimeContributionRegistry'

const PluginView = vi.fn() as never
const TaskPaneTab = vi.fn() as never
const SettingsSection = vi.fn() as never

function makeRegistry() {
  return createRuntimeContributionRegistry({
    pluginId: 'github',
    projectId: 'project-1',
  })
}

describe('runtime contribution registry', () => {
  it('qualifies local contribution ids with plugin dot namespaces', () => {
    expect(qualifyLocalContributionId('github', 'sync')).toBe('github.sync')
    expect(qualifyLocalContributionId('github', 'sync.finished')).toBe('github.sync.finished')
  })

  it('records runtime contributions with project-scoped activation metadata', async () => {
    const registry = makeRegistry()

    await registry.activateFrontend(defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({
          id: 'prs',
          title: 'Pull Requests',
          icon: 'git-pull-request',
          placement: 'rail',
          order: 50,
          component: () => Promise.resolve({ default: PluginView }),
        }))
        context.subscriptions.add(openforge.taskPane.registerTab({
          id: 'activity',
          title: 'Activity',
          icon: 'sparkles',
          order: 10,
          component: TaskPaneTab,
        }))
        context.subscriptions.add(openforge.settings.registerSection({
          id: 'github-settings',
          title: 'GitHub Settings',
          order: 20,
          component: SettingsSection,
        }))
        context.subscriptions.add(openforge.commands.register({
          id: 'sync',
          title: 'Sync Pull Requests',
          handler: async () => ({ synced: true }),
        }))
        context.subscriptions.add(openforge.events.on('sync.finished', vi.fn()))
      },
    }))

    await registry.activateBackend(defineBackendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.backend.registerMethod('syncProject', {
          input: { type: 'object' },
          output: { type: 'object' },
          handler: async () => ({ synced: 1 }),
        }))
        context.subscriptions.add(openforge.background.register({
          id: 'poller',
          scope: 'project',
          start: async () => undefined,
          stop: async () => undefined,
        }))
      },
    }))

    expect(registry.getSnapshot()).toMatchObject({
      pluginId: 'github',
      projectId: 'project-1',
      views: [
        { id: 'prs', qualifiedId: 'github.prs', pluginId: 'github', projectId: 'project-1', title: 'Pull Requests' },
      ],
      taskPaneTabs: [
        { id: 'activity', qualifiedId: 'github.activity', pluginId: 'github', projectId: 'project-1', title: 'Activity' },
      ],
      settingsSections: [
        { id: 'github-settings', qualifiedId: 'github.github-settings', pluginId: 'github', projectId: 'project-1', title: 'GitHub Settings' },
      ],
      commands: [
        { id: 'sync', qualifiedId: 'github.sync', pluginId: 'github', projectId: 'project-1', title: 'Sync Pull Requests' },
      ],
      eventListeners: [
        { id: 'sync.finished', qualifiedId: 'github.sync.finished', pluginId: 'github', projectId: 'project-1' },
      ],
      backendMethods: [
        { id: 'syncProject', qualifiedId: 'github.syncProject', pluginId: 'github', projectId: 'project-1' },
      ],
      backgroundServices: [
        { id: 'poller', qualifiedId: 'github.poller', pluginId: 'github', projectId: 'project-1', scope: 'project' },
      ],
    })
  })

  it('cleans up only disposables added to context.subscriptions and ignores activation-returned cleanup', async () => {
    const registry = makeRegistry()
    const returnedCleanup = vi.fn()

    await registry.activateFrontend(defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.commands.register({
          id: 'sync',
          title: 'Sync Pull Requests',
          handler: async () => undefined,
        }))

        return { dispose: returnedCleanup } as never
      },
    }))

    expect(registry.getSnapshot().commands).toHaveLength(1)

    await registry.deactivate()
    await registry.deactivate()

    expect(returnedCleanup).not.toHaveBeenCalled()
    expect(registry.getSnapshot().commands).toEqual([])
  })

  it('rejects reserved openforge.* plugin-local registrations while allowing explicit global host listeners', () => {
    const registry = makeRegistry()
    const frontend = registry.getFrontendApi()

    expect(() => frontend.commands.register({
      id: 'openforge.sync',
      title: 'Sync',
      handler: async () => undefined,
    })).toThrow(/openforge\.\*.*reserved/i)

    expect(() => frontend.events.on('openforge.task.selected', vi.fn())).toThrow(/openforge\.\*.*reserved/i)

    expect(() => frontend.events.onGlobal('openforge.task.selected', vi.fn())).not.toThrow()
  })

  it('rejects duplicate ids within a plugin activation, including command ids shared across frontend and backend runtimes', async () => {
    const registry = makeRegistry()

    await registry.activateFrontend(defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.commands.register({
          id: 'sync',
          title: 'Sync Pull Requests',
          handler: async () => undefined,
        }))
      },
    }))

    await expect(registry.activateBackend(defineBackendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.commands.register({
          id: 'sync',
          title: 'Backend Sync',
          handler: async () => undefined,
        }))
      },
    }))).rejects.toThrow(/duplicate.*github\.sync/i)
  })

  it.each([
    {
      label: 'command id',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getFrontendApi().commands.register({ id: '', title: 'Sync', handler: async () => undefined }),
      error: /commands.*id/i,
    },
    {
      label: 'command handler',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getFrontendApi().commands.register({ id: 'sync', title: 'Sync' } as never),
      error: /commands.*handler/i,
    },
    {
      label: 'event handler',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getFrontendApi().events.on('sync.finished', undefined as never),
      error: /events.*handler/i,
    },
    {
      label: 'view title',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getFrontendApi().views.register({ id: 'prs', title: '', icon: 'git-pull-request', placement: 'rail', component: PluginView }),
      error: /views.*title/i,
    },
    {
      label: 'view component',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getFrontendApi().views.register({ id: 'prs', title: 'Pull Requests', icon: 'git-pull-request', placement: 'rail' } as never),
      error: /views.*component/i,
    },
    {
      label: 'task pane title',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getFrontendApi().taskPane.registerTab({ id: 'activity', title: '', component: TaskPaneTab }),
      error: /taskPane.*title/i,
    },
    {
      label: 'settings component',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getFrontendApi().settings.registerSection({ id: 'github-settings', title: 'GitHub Settings' } as never),
      error: /settings.*component/i,
    },
    {
      label: 'background scope',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getBackendApi().background.register({ id: 'poller', scope: 'workspace', start: async () => undefined } as never),
      error: /background.*scope/i,
    },
    {
      label: 'background start',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getBackendApi().background.register({ id: 'poller', scope: 'project' } as never),
      error: /background.*start/i,
    },
    {
      label: 'backend method handler',
      register: (registry: ReturnType<typeof makeRegistry>) => registry.getBackendApi().backend.registerMethod('syncProject', {} as never),
      error: /backend.*handler/i,
    },
  ])('validates runtime registration shape for $label', ({ register, error }) => {
    expect(() => register(makeRegistry())).toThrow(error)
  })
})
