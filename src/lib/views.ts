import type { Component } from 'svelte'
import SettingsView from '../components/SettingsView.svelte'
import PrReviewView from '../components/PrReviewView.svelte'
import SkillsView from '../components/SkillsView.svelte'
import WorkQueueView from '../components/WorkQueueView.svelte'
import FilesView from '../components/FilesView.svelte'
import type { AppView } from './types'

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

export const VIEWS: Record<Exclude<AppView, 'board'>, ViewEntry> = {
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
