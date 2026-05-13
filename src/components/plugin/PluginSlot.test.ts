import { render, screen, waitFor } from '@testing-library/svelte'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import PluginSlot from './PluginSlot.svelte'
import PluginSlotTestView from './PluginSlotTestView.svelte'
import PluginSlotCrashingView from './PluginSlotCrashingView.svelte'
import PluginSlotRuntimePropsView from './PluginSlotRuntimePropsView.svelte'
import { installedPlugins, enabledPluginIds } from '../../lib/plugin/pluginStore'
import type { PluginEntry, PluginManifest } from '../../lib/plugin/types'
import { clearComponentRegistry, registerRenderableContributionComponent, registerViewComponent } from '../../lib/plugin/componentRegistry'
import { makePluginViewKey } from '../../lib/plugin/types'

const { activatePluginMock } = vi.hoisted(() => ({
  activatePluginMock: vi.fn(async () => true),
}))

vi.mock('../../lib/plugin/pluginRegistry', () => ({
  activatePlugin: activatePluginMock,
  getPluginRenderProps: (pluginId: string, options: { projectId: string | null; taskId?: string | null }) => ({
    api: {},
    context: { pluginId, projectId: options.projectId, taskId: options.taskId ?? null },
  }),
}))

function makeViewManifest(pluginId: string = 'test-plugin'): PluginManifest {
  return {
    id: pluginId,
    name: 'Test',
    version: '1.0.0',
    apiVersion: 1,
    description: 'Test plugin',
    permissions: [],
    contributes: {
      views: [
        {
          id: 'main',
          title: 'Main',
          icon: 'plug',
          showInRail: true,
        },
      ],
    },
    frontend: 'index.js',
    backend: null,
  }
}

function makeManifestWithContribution(contributes: PluginManifest['contributes'], pluginId: string = 'test-plugin'): PluginManifest {
  return {
    ...makeViewManifest(pluginId),
    contributes,
  }
}

describe('PluginSlot', () => {
  beforeEach(() => {
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    vi.clearAllMocks()
    clearComponentRegistry()
  })

  it('renders nothing for empty slot', () => {
    const { container } = render(PluginSlot, { props: { slotType: 'views' } })
    const div = container.querySelector('div')
    expect(div).toBeTruthy()
    expect(div?.children.length).toBe(0)
    expect(div?.getAttribute('data-slot-type')).toBe('views')
  })

  it('renders container with data attributes', () => {
    const { container } = render(PluginSlot, { props: { slotType: 'sidebarPanels', slotId: 'panel-1' } })
    const div = container.querySelector('div')
    expect(div?.getAttribute('data-slot-type')).toBe('sidebarPanels')
    expect(div?.getAttribute('data-slot-id')).toBe('panel-1')
  })

  it('marks task pane tab slots as fill-layout hosts', () => {
    const { container } = render(PluginSlot, { props: { slotType: 'taskPaneTabs', slotId: 'test-plugin:activity' } })
    const div = container.querySelector('div')
    expect(div?.getAttribute('data-slot-layout')).toBe('fill')
  })

  it('marks view slots as fill-layout hosts', () => {
    const { container } = render(PluginSlot, { props: { slotType: 'views', slotId: 'plugin:test-plugin:main' } })
    const div = container.querySelector('div')
    expect(div?.getAttribute('data-slot-layout')).toBe('fill')
  })

  it('handles slot with no contributions', async () => {
    const manifest: PluginManifest = {
      ...makeViewManifest(),
      contributes: {},
    }

    const entry: PluginEntry = {
      manifest,
      state: 'installed',
      error: null,
    }

    installedPlugins.set(new Map([['test-plugin', entry]]))
    enabledPluginIds.set(new Set(['test-plugin']))

    const { container } = render(PluginSlot, { props: { slotType: 'views' } })
    await new Promise(r => setTimeout(r, 10))
    const div = container.querySelector('div')
    expect(div?.children.length).toBe(0)
  })

  it('renders a registered plugin view component through the slot', async () => {
    const manifest = makeViewManifest()
    const entry: PluginEntry = {
      manifest,
      state: 'active',
      error: null,
    }

    registerViewComponent(makePluginViewKey('test-plugin', 'main'), PluginSlotTestView)
    installedPlugins.set(new Map([['test-plugin', entry]]))
    enabledPluginIds.set(new Set(['test-plugin']))

    render(PluginSlot, {
      props: {
        slotType: 'views',
        slotId: 'plugin:test-plugin:main',
        projectName: 'Project Alpha',
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('plugin-slot-view').textContent).toContain('Project Alpha')
    })
    expect(activatePluginMock).not.toHaveBeenCalled()
  })

  it('activates a plugin when a view component is not registered yet', async () => {
    const manifest = makeViewManifest()
    const entry: PluginEntry = {
      manifest,
      state: 'installed',
      error: null,
    }

    activatePluginMock.mockImplementationOnce(async () => {
      registerViewComponent(makePluginViewKey('test-plugin', 'main'), PluginSlotTestView)
      return true
    })

    installedPlugins.set(new Map([['test-plugin', entry]]))
    enabledPluginIds.set(new Set(['test-plugin']))

    render(PluginSlot, {
      props: {
        slotType: 'views',
        slotId: 'plugin:test-plugin:main',
        projectName: 'Project Beta',
      },
    })

    await waitFor(() => {
      expect(activatePluginMock).toHaveBeenCalledWith('test-plugin')
      expect(screen.getByTestId('plugin-slot-view').textContent).toContain('Project Beta')
    })
  })

  it('resolves lazy plugin component factories and injects API/context props', async () => {
    const manifest = makeViewManifest()
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'active', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    registerViewComponent(
      makePluginViewKey('test-plugin', 'main'),
      () => Promise.resolve({ default: PluginSlotRuntimePropsView })
    )

    render(PluginSlot, {
      props: {
        slotType: 'views',
        slotId: 'plugin:test-plugin:main',
        projectId: 'P-1',
        taskId: 'T-1',
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('plugin-runtime-props').textContent).toContain('test-plugin:P-1:T-1:T-1:P-1:api')
    })
  })

  it('shows plugin fallback UI when the rendered plugin view throws', async () => {
    const manifest = makeViewManifest()
    const entry: PluginEntry = {
      manifest,
      state: 'active',
      error: null,
    }

    registerViewComponent(makePluginViewKey('test-plugin', 'main'), PluginSlotCrashingView)
    installedPlugins.set(new Map([['test-plugin', entry]]))
    enabledPluginIds.set(new Set(['test-plugin']))

    render(PluginSlot, {
      props: {
        slotType: 'views',
        slotId: 'plugin:test-plugin:main',
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('plugin render failed')
    })
  })

  it('renders a registered task pane tab contribution component', async () => {
    const manifest = makeManifestWithContribution({
      taskPaneTabs: [{ id: 'activity', title: 'Activity' }],
    })

    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'active', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    registerRenderableContributionComponent('taskPaneTabs', 'test-plugin:activity', PluginSlotTestView)

    render(PluginSlot, {
      props: {
        slotType: 'taskPaneTabs',
        slotId: 'test-plugin:activity',
        projectName: 'Project Gamma',
        taskId: 'T-42',
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('plugin-slot-view').textContent).toContain('Project Gamma')
    })
  })

  it('renders registered settings section and sidebar panel components', async () => {
    const manifest = makeManifestWithContribution({
      settingsSections: [{ id: 'preferences', title: 'Preferences' }],
      sidebarPanels: [{ id: 'inspector', title: 'Inspector', side: 'right' }],
    }, 'plugin.settings')

    installedPlugins.set(new Map([['plugin.settings', { manifest, state: 'active', error: null }]]))
    enabledPluginIds.set(new Set(['plugin.settings']))
    registerRenderableContributionComponent('settingsSections', 'plugin.settings:preferences', PluginSlotTestView)
    registerRenderableContributionComponent('sidebarPanels', 'plugin.settings:inspector', PluginSlotTestView)

    const { rerender } = render(PluginSlot, {
      props: {
        slotType: 'settingsSections',
        slotId: 'plugin.settings:preferences',
        projectName: 'Project Delta',
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('plugin-slot-view').textContent).toContain('Project Delta')
    })

    await rerender({
      slotType: 'sidebarPanels',
      slotId: 'plugin.settings:inspector',
      projectName: 'Project Delta',
    })

    await waitFor(() => {
      expect(screen.getByTestId('plugin-slot-view').textContent).toContain('Project Delta')
    })
  })
})
