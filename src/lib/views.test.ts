import { describe, expect, it, vi } from 'vitest'
import { ICON_RAIL_HIDDEN_VIEWS, TASK_CLEARING_VIEWS, VIEWS } from './views'

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
})
