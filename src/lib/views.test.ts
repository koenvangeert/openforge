import { describe, expect, it, vi } from 'vitest'
import PluginSlot from '../components/plugin/PluginSlot.svelte'
import type { RuntimeContributionSource } from './plugin/contributionResolver'
import { ICON_RAIL_HIDDEN_VIEWS, TASK_CLEARING_VIEWS, VIEWS, getPluginViewEntries, getViews } from './views'
import type { ViewContext } from './views'

function makeSource(overrides: Partial<RuntimeContributionSource> = {}): RuntimeContributionSource {
  return {
    pluginId: 'plugin.example',
    ...overrides,
  }
}

describe('views registry', () => {
  it('registers all non-board top-level views', () => {
    expect(Object.keys(VIEWS).sort()).toEqual([
      'global_settings',
      'settings',
    ])
  })

  it('builds props for settings views without task run callbacks', () => {
    const onCloseSettings = vi.fn()
    const onProjectDeleted = vi.fn()
    const viewContext = {
      projectId: 'proj-alpha',
      projectName: 'Project Alpha',
      projectPath: '/workspace/project-alpha',
      onCloseSettings,
      onProjectDeleted,
    } satisfies ViewContext

    const settingsProps = VIEWS.settings.getProps(viewContext)
    const globalSettingsProps = VIEWS.global_settings.getProps(viewContext)

    expect(settingsProps).toMatchObject({
      mode: 'project',
      onClose: onCloseSettings,
      onProjectDeleted,
    })
    expect(globalSettingsProps).toMatchObject({
      mode: 'global',
      onClose: onCloseSettings,
      onProjectDeleted,
    })
  })

  it('tracks navigation metadata for view behavior', () => {
    expect([...TASK_CLEARING_VIEWS].sort()).toEqual([
      'files',
      'global_settings',
      'settings',
    ])

    expect([...ICON_RAIL_HIDDEN_VIEWS].sort()).toEqual([
      'global_settings',
    ])
  })

  it('preserves the static views map when resolving all views', () => {
    const resolvedViews = getViews([])

    expect(Object.keys(resolvedViews).sort()).toEqual(Object.keys(VIEWS).sort())
    expect(resolvedViews.settings).toBe(VIEWS.settings)
    expect('files' in resolvedViews).toBe(false)
  })

  it('returns no plugin view entries when no runtime contributions are enabled', () => {
    expect(getPluginViewEntries([])).toEqual([])
  })

  it('merges plugin views with the static registry', () => {
    const pluginViews = getViews([
      makeSource({
        pluginId: 'plugin.analytics',
        views: [
          {
            id: 'dashboard',
            title: 'Analytics',
            icon: 'plug',
            placement: 'rail',
          },
        ],
      }),
    ])

    expect(pluginViews['plugin:plugin.analytics:dashboard']).toBeDefined()
  })

  it('resolves builtin package runtime views through plugin entries', () => {
    const pluginViews = getViews([
      makeSource({
        pluginId: 'com.openforge.file-viewer',
        views: [
          {
            id: 'files',
            title: 'Files',
            icon: 'folder-open',
            shortcut: 'Cmd+O',
            placement: 'rail',
            order: 10,
          },
        ],
      }),
      makeSource({
        pluginId: 'com.openforge.skills-viewer',
        views: [
          {
            id: 'skills',
            title: 'Skills',
            icon: 'sparkles',
            shortcut: 'Cmd+L',
            placement: 'rail',
            order: 30,
          },
        ],
      }),
      makeSource({
        pluginId: 'com.openforge.github-sync',
        views: [
          {
            id: 'pr_review',
            title: 'Pull Requests',
            icon: 'git-pull-request',
            shortcut: 'Cmd+G',
            placement: 'rail',
            order: 20,
          },
        ],
      }),
      makeSource({
        pluginId: 'com.openforge.terminal',
        views: [
          {
            id: 'terminal',
            title: 'Terminal',
            icon: 'terminal',
            shortcut: 'Cmd+J',
            placement: 'rail',
            order: 40,
          },
        ],
      }),
    ])

    expect(pluginViews['plugin:com.openforge.file-viewer:files']).toBeDefined()
    expect(pluginViews['plugin:com.openforge.skills-viewer:skills']).toBeDefined()
    expect(pluginViews['plugin:com.openforge.github-sync:pr_review']).toBeDefined()
    expect(pluginViews['plugin:com.openforge.terminal:terminal']).toBeDefined()
    expect('files' in pluginViews).toBe(false)
    expect(pluginViews['plugin:com.openforge.file-viewer:files']?.component).toBe(PluginSlot)
  })

  it('passes plugin slot props for builtin fullpage views', () => {
    const pluginViews = getViews([
      makeSource({
        pluginId: 'com.openforge.file-viewer',
        views: [
          {
            id: 'files',
            title: 'Files',
            icon: 'folder-open',
            placement: 'rail',
          },
        ],
      }),
    ])

    const props = pluginViews['plugin:com.openforge.file-viewer:files']?.getProps({
      projectId: 'proj-alpha',
      projectName: 'Project Alpha',
      projectPath: '/workspace/project-alpha',
      onCloseSettings: vi.fn(),
      onProjectDeleted: vi.fn(),
    })

    expect(props).toEqual({
      slotType: 'views',
      slotId: 'plugin:com.openforge.file-viewer:files',
      projectId: 'proj-alpha',
      projectName: 'Project Alpha',
      projectPath: '/workspace/project-alpha',
    })
  })
})
