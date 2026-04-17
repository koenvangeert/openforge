import type { Component } from 'svelte'
import SettingsView from '../components/settings/SettingsView.svelte'
import WorkQueueView from '../components/work-queue/WorkQueueView.svelte'
import PluginSlot from '../components/plugin/PluginSlot.svelte'
import { FilesViewComponent } from '../../plugins/file-viewer/src/index'
import { PrReviewViewComponent } from '../../plugins/github-sync/src/index'
import { SkillsViewComponent } from '../../plugins/skills-viewer/src/index'
import { resolveContributions } from './plugin/contributionResolver'
import { makePluginViewKey } from './plugin/types'
import { FILE_VIEWER_PLUGIN_ID, FILE_VIEWER_VIEW_ID } from './fileViewerPlugin'
import { GITHUB_SYNC_PLUGIN_ID, GITHUB_SYNC_VIEW_ID } from './githubSyncPlugin'
import { SKILLS_VIEWER_PLUGIN_ID, SKILLS_VIEWER_VIEW_ID } from './skillsViewerPlugin'
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

export type StaticViewKey = Exclude<CoreAppView, 'board' | 'files' | 'skills'>
export type ViewRegistry = Record<StaticViewKey, ViewEntry> & Partial<Record<PluginViewKey, ViewEntry>>

export const TASK_CLEARING_VIEWS: ReadonlySet<AppView> = new Set([
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
  workqueue: {
    component: WorkQueueView,
    getProps: ({ onRunAction }) => ({ onRunAction }),
  },
}

export function getPluginViewEntries(manifests: PluginManifest[]): PluginViewEntry[] {
  const contributions = resolveContributions(manifests)

  return contributions.views.map((view) => ({
    key: makePluginViewKey(view.pluginId, view.contributionId),
    entry: {
      component: isBuiltinHostView(view.pluginId, view.contributionId)
        ? getBuiltinHostViewComponent(view.pluginId, view.contributionId)
        : PluginSlot,
      getProps: ({ projectName }) =>
        isBuiltinHostView(view.pluginId, view.contributionId)
          ? { projectName }
          : {
              slotType: 'views' as const,
              slotId: makePluginViewKey(view.pluginId, view.contributionId),
            },
    },
  }))
}

function isBuiltinHostView(pluginId: string, contributionId: string): boolean {
  return (
    (pluginId === FILE_VIEWER_PLUGIN_ID && contributionId === FILE_VIEWER_VIEW_ID) ||
    (pluginId === GITHUB_SYNC_PLUGIN_ID && contributionId === GITHUB_SYNC_VIEW_ID) ||
    (pluginId === SKILLS_VIEWER_PLUGIN_ID && contributionId === SKILLS_VIEWER_VIEW_ID)
  )
}

function getBuiltinHostViewComponent(pluginId: string, contributionId: string): Component<Record<string, unknown>> {
  if (pluginId === FILE_VIEWER_PLUGIN_ID && contributionId === FILE_VIEWER_VIEW_ID) {
    return FilesViewComponent
  }

  if (pluginId === GITHUB_SYNC_PLUGIN_ID && contributionId === GITHUB_SYNC_VIEW_ID) {
    return PrReviewViewComponent
  }

  return SkillsViewComponent
}

export function getViews(manifests: PluginManifest[]): ViewRegistry {
  return Object.assign({}, VIEWS, Object.fromEntries(getPluginViewEntries(manifests).map(({ key, entry }) => [key, entry])))
}
