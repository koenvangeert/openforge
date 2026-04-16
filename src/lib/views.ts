import type { Component } from 'svelte'
import SettingsView from '../components/settings/SettingsView.svelte'
import PrReviewView from '../components/review/pr/PrReviewView.svelte'
import SkillsView from '../components/SkillsView.svelte'
import WorkQueueView from '../components/work-queue/WorkQueueView.svelte'
import FilesView from '../components/FilesView.svelte'
import PluginSlot from '../components/plugin/PluginSlot.svelte'
import { resolveContributions } from './plugin/contributionResolver'
import { makePluginViewKey } from './plugin/types'
import type { PluginManifest, PluginViewKey } from './plugin/types'
import type { AppView, CoreAppView } from './types'

export type RunActionHandler = (data: { taskId: string; actionPrompt: string; agent: string | null }) => void | Promise<void>

export interface ViewContext {
  projectName: string
  onCloseSettings: () => void
  onProjectDeleted: () => void
  onRunAction: RunActionHandler
}

export interface ViewEntry {
  component: Component<Record<string, unknown>>
  getProps: (context: ViewContext) => Record<string, unknown>
}

export interface PluginViewEntry {
  key: PluginViewKey
  entry: ViewEntry
}

export type StaticViewKey = Exclude<CoreAppView, 'board'>
export type ViewRegistry = Record<StaticViewKey, ViewEntry> & Partial<Record<PluginViewKey, ViewEntry>>

export const TASK_CLEARING_VIEWS: ReadonlySet<AppView> = new Set([
  'pr_review',
  'settings',
  'workqueue',
  'global_settings',
  'files',
])

export const ICON_RAIL_HIDDEN_VIEWS: ReadonlySet<AppView> = new Set([
  'workqueue',
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
  pr_review: {
    component: PrReviewView,
    getProps: ({ projectName }) => ({ projectName }),
  },
  skills: {
    component: SkillsView,
    getProps: ({ projectName }) => ({ projectName }),
  },
  workqueue: {
    component: WorkQueueView,
    getProps: ({ onRunAction }) => ({ onRunAction }),
  },
  files: {
    component: FilesView,
    getProps: ({ projectName }) => ({ projectName }),
  },
}

export function getPluginViewEntries(manifests: PluginManifest[]): PluginViewEntry[] {
  const contributions = resolveContributions(manifests)

  return contributions.views.map((view) => ({
    key: makePluginViewKey(view.pluginId, view.contributionId),
    entry: {
      component: PluginSlot,
      getProps: () => ({
        slotType: 'views' as const,
        slotId: makePluginViewKey(view.pluginId, view.contributionId),
      }),
    },
  }))
}

export function getViews(manifests: PluginManifest[]): ViewRegistry {
  return Object.assign({}, VIEWS, Object.fromEntries(getPluginViewEntries(manifests).map(({ key, entry }) => [key, entry])))
}
