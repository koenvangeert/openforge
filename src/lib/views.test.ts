import { describe, expect, it, vi } from 'vitest'
import type { PluginManifest } from './plugin/types'
import { ICON_RAIL_HIDDEN_VIEWS, TASK_CLEARING_VIEWS, VIEWS, getPluginViewEntries, getViews } from './views'

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'plugin.example',
    name: 'Example Plugin',
    version: '1.0.0',
    apiVersion: 1,
    description: 'Example plugin',
    permissions: [],
    contributes: {},
    frontend: 'dist/index.js',
    backend: null,
    ...overrides,
  }
}

describe('views registry', () => {
  it('registers all non-board top-level views', () => {
    expect(Object.keys(VIEWS).sort()).toEqual([
      'global_settings',
      'pr_review',
      'settings',
      'skills',
      'workqueue',
    ])
  })

  it('builds props for settings views correctly', () => {
    const onCloseSettings = vi.fn()
    const onProjectDeleted = vi.fn()
    const onRunAction = vi.fn()

    const settingsProps = VIEWS.settings.getProps({
      projectName: 'Project Alpha',
      onCloseSettings,
      onProjectDeleted,
      onRunAction,
    })
    const globalSettingsProps = VIEWS.global_settings.getProps({
      projectName: 'Project Alpha',
      onCloseSettings,
      onProjectDeleted,
      onRunAction,
    })

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
      'pr_review',
      'settings',
      'workqueue',
    ])

    expect([...ICON_RAIL_HIDDEN_VIEWS].sort()).toEqual([
      'global_settings',
      'workqueue',
    ])
  })

  it('preserves the static views map when resolving all views', () => {
    const resolvedViews = getViews([])

    expect(Object.keys(resolvedViews).sort()).toEqual(Object.keys(VIEWS).sort())
    expect(resolvedViews.settings).toBe(VIEWS.settings)
    expect('files' in resolvedViews).toBe(false)
  })

  it('returns no plugin view entries when no manifests are enabled', () => {
    expect(getPluginViewEntries([])).toEqual([])
  })

  it('merges plugin views with the static registry', () => {
    const pluginViews = getViews([
      makeManifest({
        id: 'plugin.analytics',
        contributes: {
          views: [
            {
              id: 'dashboard',
              title: 'Analytics',
              icon: 'plug',
              showInRail: true,
            },
          ],
        },
      }),
    ])

    expect(pluginViews['plugin:plugin.analytics:dashboard']).toBeDefined()
  })

  it('resolves the file viewer view through plugin entries', () => {
    const pluginViews = getViews([
      makeManifest({
        id: 'com.openforge.file-viewer',
        contributes: {
          views: [
            {
              id: 'files',
              title: 'Files',
              icon: 'folder-open',
              shortcut: 'Cmd+O',
              showInRail: true,
              railOrder: 10,
            },
          ],
        },
      }),
    ])

    expect(pluginViews['plugin:com.openforge.file-viewer:files']).toBeDefined()
    expect('files' in pluginViews).toBe(false)
  })
})
