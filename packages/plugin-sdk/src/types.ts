import type { Component } from 'svelte'

export interface PluginStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: number
  description: string
  permissions: string[]
  contributes: PluginContributionPoints
  frontend: string | null
  backend: string | null
}

export interface PluginContributionPoints {
  views?: PluginViewContribution[]
  taskPaneTabs?: PluginTaskPaneTabContribution[]
  sidebarPanels?: PluginSidebarPanelContribution[]
  commands?: PluginCommandContribution[]
  settingsSections?: PluginSettingsSection[]
  backgroundServices?: PluginBackgroundService[]
}

export interface PluginViewContribution {
  id: string
  title: string
  icon: string
  shortcut?: string
  showInRail?: boolean
  railOrder?: number
}

export interface PluginTaskPaneTabContribution {
  id: string
  title: string
  icon?: string
  order?: number
}

export interface PluginSidebarPanelContribution {
  id: string
  title: string
  side: 'left' | 'right'
  order?: number
}

export interface PluginCommandContribution {
  id: string
  title: string
  shortcut?: string
}

export interface PluginSettingsSection {
  id: string
  title: string
}

export interface PluginBackgroundService {
  id: string
  name: string
}

export type PluginViewKey = `plugin:${string}:${string}`

export function makePluginViewKey(pluginId: string, viewId: string): PluginViewKey {
  return `plugin:${pluginId}:${viewId}`
}

export function isPluginViewKey(value: string): value is PluginViewKey {
  return value.startsWith('plugin:') && value.match(/^plugin:[^:]+:[^:]+$/) !== null
}

export function parsePluginViewKey(key: PluginViewKey): { pluginId: string; viewId: string } {
  const parts = key.split(':')
  return { pluginId: parts[1], viewId: parts[2] }
}

export interface PluginContext {
  pluginId: string
  invokeHost(command: string, payload?: unknown): Promise<unknown>
  invokeBackend(method: string, payload?: unknown): Promise<unknown>
  onEvent(event: string, handler: (payload: unknown) => void): () => void
  storage: PluginStorage
}

export interface PluginViewProps extends Record<string, unknown> {
  projectId?: string | null
  projectName?: string
}

export interface PluginTaskPaneProps extends Record<string, unknown> {
  taskId: string
  projectId?: string | null
  projectName?: string
}

export interface PluginActivatedViewContribution extends Partial<PluginViewContribution> {
  id: string
  component: Component<Record<string, unknown>>
}

export interface PluginActivatedTaskPaneTabContribution extends Partial<PluginTaskPaneTabContribution> {
  id: string
  component: Component<Record<string, unknown>>
}

export interface PluginActivatedSidebarPanelContribution extends Partial<PluginSidebarPanelContribution> {
  id: string
  component: Component<Record<string, unknown>>
}

export interface PluginActivatedSettingsSectionContribution extends Partial<PluginSettingsSection> {
  id: string
  component: Component<Record<string, unknown>>
}

export interface PluginActivatedCommandContribution extends Partial<PluginCommandContribution> {
  id: string
  execute(payload?: unknown): Promise<void> | void
}

export interface PluginActivatedBackgroundService extends Partial<PluginBackgroundService> {
  id: string
  start(): Promise<void> | void
  stop?(): Promise<void> | void
}

export interface PluginActivationResult {
  contributions: Omit<PluginContributionPoints, 'views' | 'taskPaneTabs' | 'sidebarPanels' | 'commands' | 'settingsSections' | 'backgroundServices'> & {
    views?: PluginActivatedViewContribution[]
    taskPaneTabs?: PluginActivatedTaskPaneTabContribution[]
    sidebarPanels?: PluginActivatedSidebarPanelContribution[]
    commands?: PluginActivatedCommandContribution[]
    settingsSections?: PluginActivatedSettingsSectionContribution[]
    backgroundServices?: PluginActivatedBackgroundService[]
  }
}

export type PluginState = 'installed' | 'active' | 'error' | 'disabled'

export interface PluginEntry {
  manifest: PluginManifest
  state: PluginState
  error: string | null
  installPath?: string
  isBuiltin?: boolean
}

export const MAX_SUPPORTED_API_VERSION = 1
