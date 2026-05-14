import { describe, expect, it } from 'vitest'

import { resolveContributions, resolveContributionsForSlot } from './contributionResolver'
import type { RuntimeContributionSource } from './contributionResolver'
import type {
  PluginBackgroundService,
  PluginCommandContribution,
  PluginSettingsSection,
  PluginSidebarPanelContribution,
  PluginTaskPaneTabContribution,
  PluginViewContribution,
} from './types'

function makeSource(overrides: Partial<RuntimeContributionSource> = {}): RuntimeContributionSource {
  return {
    pluginId: 'plugin.test',
    ...overrides,
  }
}

function makeView(overrides: Partial<PluginViewContribution> = {}): PluginViewContribution {
  return {
    id: 'main',
    title: 'Main View',
    icon: 'plug',
    ...overrides,
  }
}

function makeTab(overrides: Partial<PluginTaskPaneTabContribution> = {}): PluginTaskPaneTabContribution {
  return {
    id: 'details',
    title: 'Details',
    ...overrides,
  }
}

function makePanel(overrides: Partial<PluginSidebarPanelContribution> = {}): PluginSidebarPanelContribution {
  return {
    id: 'inspector',
    title: 'Inspector',
    side: 'right',
    ...overrides,
  }
}

function makeCommand(overrides: Partial<PluginCommandContribution> = {}): PluginCommandContribution {
  return {
    id: 'open',
    title: 'Open',
    ...overrides,
  }
}

function makeSettingsSection(overrides: Partial<PluginSettingsSection> = {}): PluginSettingsSection {
  return {
    id: 'general',
    title: 'General',
    ...overrides,
  }
}

function makeBackgroundService(overrides: Partial<PluginBackgroundService> = {}): PluginBackgroundService {
  return {
    id: 'sync',
    name: 'Sync Service',
    ...overrides,
  }
}

describe('resolveContributions', () => {
  it('resolves views from a single plugin runtime source', () => {
    const source = makeSource({
      pluginId: 'plugin.alpha',
      views: [
        makeView({ id: 'one', title: 'One' }),
        makeView({ id: 'two', title: 'Two', icon: 'folder-open' }),
      ],
    })

    const result = resolveContributions([source])

    expect(result.views).toHaveLength(2)
    expect(result.views).toEqual([
      expect.objectContaining({
        pluginId: 'plugin.alpha',
        contributionId: 'one',
        namespacedId: 'plugin.alpha:one',
        title: 'One',
      }),
      expect.objectContaining({
        pluginId: 'plugin.alpha',
        contributionId: 'two',
        namespacedId: 'plugin.alpha:two',
        title: 'Two',
      }),
    ])
  })

  it('resolves views from multiple plugins', () => {
    const pluginA = makeSource({
      pluginId: 'plugin.a',
      views: [makeView({ id: 'main', title: 'Plugin A' })],
    })
    const pluginB = makeSource({
      pluginId: 'plugin.b',
      views: [makeView({ id: 'main', title: 'Plugin B', icon: 'folder-open' })],
    })

    const result = resolveContributions([pluginA, pluginB])

    expect(result.views).toHaveLength(2)
    expect(result.views.map((view) => view.namespacedId)).toEqual(['plugin.a:main', 'plugin.b:main'])
  })

  it('resolves task-pane tabs', () => {
    const source = makeSource({
      pluginId: 'plugin.tabs',
      taskPaneTabs: [makeTab({ id: 'activity', title: 'Activity', icon: 'sparkles', order: 5 })],
    })

    const result = resolveContributions([source])

    expect(result.taskPaneTabs).toEqual([
      {
        pluginId: 'plugin.tabs',
        contributionId: 'activity',
        namespacedId: 'plugin.tabs:activity',
        title: 'Activity',
        icon: 'sparkles',
        order: 5,
      },
    ])
  })

  it('handles empty contribution sources gracefully', () => {
    const result = resolveContributions([makeSource()])

    expect(result).toEqual({
      views: [],
      taskPaneTabs: [],
      sidebarPanels: [],
      commands: [],
      settingsSections: [],
      backgroundServices: [],
    })
  })

  it('handles duplicate slot contributions by namespacing', () => {
    const pluginA = makeSource({
      pluginId: 'plugin-a',
      views: [makeView({ id: 'main', title: 'Main A' })],
    })
    const pluginB = makeSource({
      pluginId: 'plugin-b',
      views: [makeView({ id: 'main', title: 'Main B' })],
    })

    const result = resolveContributions([pluginA, pluginB])

    expect(result.views.map((view) => view.namespacedId)).toEqual(['plugin-a:main', 'plugin-b:main'])
  })

  it('filters views with invalid icons', () => {
    const source = makeSource({
      views: [makeView({ id: 'bad', icon: 'nonexistent' }), makeView({ id: 'good', icon: 'plug' })],
    })

    const result = resolveContributions([source])

    expect(result.views).toHaveLength(1)
    expect(result.views[0]?.contributionId).toBe('good')
  })

  it('normalizes view shortcuts', () => {
    const source = makeSource({ views: [makeView({ shortcut: 'Cmd+O' })] })

    const result = resolveContributions([source])

    expect(result.views[0]?.shortcut).toBe('⌘o')
  })

  it('normalizes command shortcut metadata', () => {
    const source = makeSource({ commands: [makeCommand({ shortcut: { key: 'Cmd+K', scope: 'project' } })] })

    const result = resolveContributions([source])

    expect(result.commands[0]?.shortcut).toBe('⌘k')
  })

  it('defaults showInRail to true', () => {
    const source = makeSource({ views: [makeView()] })

    const result = resolveContributions([source])

    expect(result.views[0]?.showInRail).toBe(true)
  })

  it('defaults railOrder to 100', () => {
    const source = makeSource({ views: [makeView()] })

    const result = resolveContributions([source])

    expect(result.views[0]?.railOrder).toBe(100)
  })

  it('skips malformed contributions missing required id', () => {
    const malformedView = makeView({ title: 'Broken' })
    Reflect.deleteProperty(malformedView, 'id')

    const source = makeSource({ views: [malformedView, makeView({ id: 'valid', title: 'Valid' })] })

    const result = resolveContributions([source])

    expect(result.views).toHaveLength(1)
    expect(result.views[0]?.contributionId).toBe('valid')
  })

  it('resolves all contribution types in one call', () => {
    const contributions: Partial<RuntimeContributionSource> = {
      views: [makeView({ id: 'view' })],
      taskPaneTabs: [makeTab({ id: 'tab' })],
      sidebarPanels: [makePanel({ id: 'panel', side: 'left', order: 2 })],
      commands: [makeCommand({ id: 'command', shortcut: 'Cmd+K' })],
      settingsSections: [makeSettingsSection({ id: 'settings' })],
      backgroundServices: [makeBackgroundService({ id: 'service', name: 'Worker' })],
    }
    const source = makeSource({ pluginId: 'plugin.all', ...contributions })

    const result = resolveContributions([source])

    expect(result.views).toHaveLength(1)
    expect(result.taskPaneTabs).toHaveLength(1)
    expect(result.sidebarPanels).toHaveLength(1)
    expect(result.commands).toHaveLength(1)
    expect(result.settingsSections).toHaveLength(1)
    expect(result.backgroundServices).toHaveLength(1)
    expect(result.backgroundServices[0]?.namespacedId).toBe('plugin.all:service')
  })
})

describe('resolveContributionsForSlot', () => {
  it('matches contributions by contributionId, namespacedId, or plugin view key', () => {
    const resolved = resolveContributions([
      makeSource({
        pluginId: 'plugin.slot',
        views: [makeView({ id: 'main' })],
        taskPaneTabs: [makeTab({ id: 'details' })],
      }),
    ])

    expect(resolveContributionsForSlot(resolved, 'views', 'main')).toHaveLength(1)
    expect(resolveContributionsForSlot(resolved, 'views', 'plugin.slot:main')).toHaveLength(1)
    expect(resolveContributionsForSlot(resolved, 'views', 'plugin:plugin.slot:main')).toHaveLength(1)
    expect(resolveContributionsForSlot(resolved, 'taskPaneTabs', 'plugin.slot:details')).toHaveLength(1)
    expect(resolveContributionsForSlot(resolved, 'views', 'missing')).toEqual([])
  })
})
