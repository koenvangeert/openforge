import { render, screen, waitFor } from '@testing-library/svelte'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import PluginSlot from './PluginSlot.svelte'
import PluginSlotTestView from './PluginSlotTestView.svelte'
import PluginSlotCrashingView from './PluginSlotCrashingView.svelte'
import PluginSlotRuntimePropsView from './PluginSlotRuntimePropsView.svelte'
import { installedPlugins, enabledPluginIds, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import type { RuntimeContributionSource } from '../../lib/plugin/contributionResolver'
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

function makeManifest(pluginId: string = 'test-plugin'): PluginManifest {
  return {
    id: pluginId,
    name: 'Test',
    version: '1.0.0',
    apiVersion: 1,
    description: 'Test plugin',
    permissions: [],
    frontend: 'index.js',
    backend: null,
  }
}

function makeViewSource(pluginId: string = 'test-plugin'): RuntimeContributionSource {
  return {
    pluginId,
    views: [
      {
        id: 'main',
        title: 'Main',
        icon: 'plug',
        placement: 'rail',
      },
    ],
  }
}

function enablePlugin(entry: PluginEntry, source?: RuntimeContributionSource): void {
  installedPlugins.set(new Map([[entry.manifest.id, entry]]))
  enabledPluginIds.set(new Set([entry.manifest.id]))
  runtimeContributionSources.set(source ? new Map([[entry.manifest.id, source]]) : new Map())
}

describe('PluginSlot', () => {
  beforeEach(() => {
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    runtimeContributionSources.set(new Map())
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
    const { container } = render(PluginSlot, { props: { slotType: 'settingsSections', slotId: 'section-1' } })
    const div = container.querySelector('div')
    expect(div?.getAttribute('data-slot-type')).toBe('settingsSections')
    expect(div?.getAttribute('data-slot-id')).toBe('section-1')
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

  it('handles slot with no runtime contributions', async () => {
    enablePlugin({ manifest: makeManifest(), state: 'installed', error: null })

    const { container } = render(PluginSlot, { props: { slotType: 'views' } })
    await new Promise(r => setTimeout(r, 10))
    const div = container.querySelector('div')
    expect(div?.children.length).toBe(0)
  })

  it('renders a registered plugin view component through the slot', async () => {
    const manifest = makeManifest()

    registerViewComponent(makePluginViewKey('test-plugin', 'main'), PluginSlotTestView)
    enablePlugin({ manifest, state: 'active', error: null }, makeViewSource())

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
    const manifest = makeManifest()

    activatePluginMock.mockImplementationOnce(async () => {
      registerViewComponent(makePluginViewKey('test-plugin', 'main'), PluginSlotTestView)
      return true
    })

    enablePlugin({ manifest, state: 'installed', error: null }, makeViewSource())

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
    const manifest = makeManifest()
    enablePlugin({ manifest, state: 'active', error: null }, makeViewSource())
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
    const manifest = makeManifest()

    registerViewComponent(makePluginViewKey('test-plugin', 'main'), PluginSlotCrashingView)
    enablePlugin({ manifest, state: 'active', error: null }, makeViewSource())

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
    const manifest = makeManifest()
    enablePlugin(
      { manifest, state: 'active', error: null },
      { pluginId: 'test-plugin', taskPaneTabs: [{ id: 'activity', title: 'Activity' }] }
    )
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

  it('renders a registered settings section contribution component', async () => {
    const manifest = makeManifest('plugin.settings')
    enablePlugin(
      { manifest, state: 'active', error: null },
      {
        pluginId: 'plugin.settings',
        settingsSections: [{ id: 'preferences', title: 'Preferences' }],
      }
    )
    registerRenderableContributionComponent('settingsSections', 'plugin.settings:preferences', PluginSlotTestView)

    render(PluginSlot, {
      props: {
        slotType: 'settingsSections',
        slotId: 'plugin.settings:preferences',
        projectName: 'Project Delta',
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('plugin-slot-view').textContent).toContain('Project Delta')
    })
  })
})
