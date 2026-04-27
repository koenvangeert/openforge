import type { Component } from 'svelte'
import SettingsView from '../components/settings/SettingsView.svelte'
import PluginSlot from '../components/plugin/PluginSlot.svelte'
import { resolveContributions } from './plugin/contributionResolver'
import { makePluginViewKey } from './plugin/types'
import type { PluginManifest, PluginViewKey } from './plugin/types'
import type { AppView, CoreAppView } from './types'

export interface ViewContext {
  projectName: string
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

export function getPluginViewEntries(manifests: PluginManifest[]): PluginViewEntry[] {
  const contributions = resolveContributions(manifests)

  return contributions.views.map((view) => ({
    key: makePluginViewKey(view.pluginId, view.contributionId),
    entry: {
      component: PluginSlot,
      getProps: ({ projectName }) => ({
        slotType: 'views' as const,
        slotId: makePluginViewKey(view.pluginId, view.contributionId),
        projectName,
      }),
    },
  }))
}

export function getViews(manifests: PluginManifest[]): ViewRegistry {
  return Object.assign({}, VIEWS, Object.fromEntries(getPluginViewEntries(manifests).map(({ key, entry }) => [key, entry])))
}
