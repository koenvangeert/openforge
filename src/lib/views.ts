import type { Component } from 'svelte'
import SettingsView from '../components/settings/SettingsView.svelte'
import PluginSlot from '../components/plugin/PluginSlot.svelte'
import { resolveContributions } from './plugin/contributionResolver'
import type { RuntimeContributionSource } from './plugin/contributionResolver'
import { makePluginViewKey } from './plugin/types'
import type { PluginViewKey } from './plugin/types'
import type { AppView, CoreAppView } from './types'

export interface ViewContext {
  projectId: string | null
  projectName: string
  projectPath: string
  onCloseSettings: () => void
  onProjectDeleted: () => void
}

export interface ViewEntry {
  component: Component<Record<string, unknown>>
  getProps: (context: ViewContext) => Record<string, unknown>
}

export interface PluginViewEntry {
  key: PluginViewKey
  entry: ViewEntry
}

export type StaticViewKey = Exclude<CoreAppView, 'board' | 'files'>
export type ViewRegistry = Record<StaticViewKey, ViewEntry> & Partial<Record<PluginViewKey, ViewEntry>>

export const TASK_CLEARING_VIEWS: ReadonlySet<AppView> = new Set([
  'settings',
  'global_settings',
  'files',
])

export const ICON_RAIL_HIDDEN_VIEWS: ReadonlySet<AppView> = new Set([
  'global_settings',
])

export const VIEWS: Record<StaticViewKey, ViewEntry> = {
  settings: {
    component: SettingsView,
    getProps: ({ onCloseSettings, onProjectDeleted }) => ({
      mode: 'project',
      onClose: onCloseSettings,
      onProjectDeleted,
    }),
  },
  global_settings: {
    component: SettingsView,
    getProps: ({ onCloseSettings, onProjectDeleted }) => ({
      mode: 'global',
      onClose: onCloseSettings,
      onProjectDeleted,
    }),
  },
}

export function getPluginViewEntries(contributionSources: RuntimeContributionSource[]): PluginViewEntry[] {
  const contributions = resolveContributions(contributionSources)

  return contributions.views.map((view) => ({
    key: makePluginViewKey(view.pluginId, view.contributionId),
    entry: {
      component: PluginSlot,
      getProps: ({ projectId, projectName, projectPath }) => ({
        slotType: 'views' as const,
        slotId: makePluginViewKey(view.pluginId, view.contributionId),
        projectId,
        projectName,
        projectPath,
      }),
    },
  }))
}

export function getViews(contributionSources: RuntimeContributionSource[]): ViewRegistry {
  return Object.assign({}, VIEWS, Object.fromEntries(getPluginViewEntries(contributionSources).map(({ key, entry }) => [key, entry])))
}
