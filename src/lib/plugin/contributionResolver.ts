import { isPluginViewKey, parsePluginViewKey } from './types'
import type { CommandShortcutMetadata } from '@openforge/plugin-sdk'
import type {
  RuntimeBackgroundServiceContribution,
  RuntimeCommandContribution,
  RuntimeSettingsSectionContribution,
  RuntimeTaskPaneTabContribution,
  RuntimeViewContribution,
} from './runtimeContributionRegistry'

type RuntimeViewSource = Pick<RuntimeViewContribution, 'id' | 'title' | 'icon' | 'shortcut'> & Partial<Pick<RuntimeViewContribution, 'placement' | 'order'>>
type RuntimeTaskPaneTabSource = Pick<RuntimeTaskPaneTabContribution, 'id' | 'title' | 'icon' | 'order'>
type RuntimeCommandSource = Pick<RuntimeCommandContribution, 'id' | 'title' | 'shortcut'>
type RuntimeSettingsSectionSource = Pick<RuntimeSettingsSectionContribution, 'id' | 'title' | 'order'>
type RuntimeBackgroundServiceSource = Pick<RuntimeBackgroundServiceContribution, 'id' | 'scope'>

export interface ResolvedView {
  pluginId: string
  contributionId: string
  namespacedId: string
  title: string
  icon: string
  shortcut: string | null
  showInRail: boolean
  railOrder: number
}

export interface ResolvedTab {
  pluginId: string
  contributionId: string
  namespacedId: string
  title: string
  icon: string | null
  order: number
}

export interface ResolvedCommand {
  pluginId: string
  contributionId: string
  namespacedId: string
  title: string
  shortcut: string | null
}

export interface ResolvedSettingsSection {
  pluginId: string
  contributionId: string
  namespacedId: string
  title: string
  order: number
}

export interface ResolvedBackgroundService {
  pluginId: string
  contributionId: string
  namespacedId: string
  scope: RuntimeBackgroundServiceSource['scope']
}

export interface RuntimeContributionSource {
  pluginId: string
  views?: RuntimeViewSource[]
  taskPaneTabs?: RuntimeTaskPaneTabSource[]
  commands?: RuntimeCommandSource[]
  settingsSections?: RuntimeSettingsSectionSource[]
  backgroundServices?: RuntimeBackgroundServiceSource[]
}

export interface ResolvedContributions {
  views: ResolvedView[]
  taskPaneTabs: ResolvedTab[]
  commands: ResolvedCommand[]
  settingsSections: ResolvedSettingsSection[]
  backgroundServices: ResolvedBackgroundService[]
}

type ResolvedSlot = keyof ResolvedContributions

type ResolvedSlotItems = {
  views: ResolvedView[]
  taskPaneTabs: ResolvedTab[]
  commands: ResolvedCommand[]
  settingsSections: ResolvedSettingsSection[]
  backgroundServices: ResolvedBackgroundService[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function toNamespacedId(pluginId: string, contributionId: string): string {
  return `${pluginId}:${contributionId}`
}

function matchesSlotId(item: { contributionId: string; namespacedId: string }, slotId: string): boolean {
  if (item.contributionId === slotId || item.namespacedId === slotId) {
    return true
  }

  if (isPluginViewKey(slotId)) {
    const { pluginId, viewId } = parsePluginViewKey(slotId)
    return item.namespacedId === `${pluginId}:${viewId}`
  }

  return false
}

function normalizeShortcut(shortcut: string): string {
  let result = ''
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1)

  if (modifiers.includes('Cmd')) result += '⌘'
  if (modifiers.includes('Ctrl')) result += '⌃'
  if (modifiers.includes('Alt')) result += '⌥'
  if (modifiers.includes('Shift')) result += '⇧'

  result += key.toLowerCase()
  return result
}

function resolveView(pluginId: string, item: unknown): ResolvedView | null {
  if (!isRecord(item)) {
    return null
  }

  const { id, title, icon, shortcut, placement, order } = item
  if (!isNonEmptyString(id) || !isNonEmptyString(title) || !isNonEmptyString(icon)) {
    return null
  }

  return {
    pluginId,
    contributionId: id,
    namespacedId: toNamespacedId(pluginId, id),
    title,
    icon,
    shortcut: isNonEmptyString(shortcut) ? normalizeShortcut(shortcut) : null,
    showInRail: placement === undefined || placement === 'rail',
    railOrder: isNumber(order) ? order : 100,
  }
}

function resolveTab(pluginId: string, item: unknown): ResolvedTab | null {
  if (!isRecord(item)) {
    return null
  }

  const { id, title, icon, order } = item
  if (!isNonEmptyString(id) || !isNonEmptyString(title)) {
    return null
  }

  return {
    pluginId,
    contributionId: id,
    namespacedId: toNamespacedId(pluginId, id),
    title,
    icon: isNonEmptyString(icon) ? icon : null,
    order: isNumber(order) ? order : 0,
  }
}

function normalizeCommandShortcut(shortcut: unknown): string | null {
  if (isNonEmptyString(shortcut)) {
    return normalizeShortcut(shortcut)
  }

  const shortcutMetadata = shortcut as CommandShortcutMetadata | undefined
  if (isRecord(shortcutMetadata) && isNonEmptyString(shortcutMetadata.key)) {
    return normalizeShortcut(shortcutMetadata.key)
  }

  return null
}

function resolveCommand(pluginId: string, item: unknown): ResolvedCommand | null {
  if (!isRecord(item)) {
    return null
  }

  const { id, title, shortcut } = item
  if (!isNonEmptyString(id) || !isNonEmptyString(title)) {
    return null
  }

  return {
    pluginId,
    contributionId: id,
    namespacedId: toNamespacedId(pluginId, id),
    title,
    shortcut: normalizeCommandShortcut(shortcut),
  }
}

function resolveSettingsSection(pluginId: string, item: unknown): ResolvedSettingsSection | null {
  if (!isRecord(item)) {
    return null
  }

  const { id, title, order } = item
  if (!isNonEmptyString(id) || !isNonEmptyString(title)) {
    return null
  }

  return {
    pluginId,
    contributionId: id,
    namespacedId: toNamespacedId(pluginId, id),
    title,
    order: isNumber(order) ? order : 0,
  }
}

function resolveBackgroundService(pluginId: string, item: unknown): ResolvedBackgroundService | null {
  if (!isRecord(item)) {
    return null
  }

  const { id, scope } = item
  if (!isNonEmptyString(id) || (scope !== 'global' && scope !== 'project' && scope !== 'task')) {
    return null
  }

  return {
    pluginId,
    contributionId: id,
    namespacedId: toNamespacedId(pluginId, id),
    scope,
  }
}

function collectResolved<T>(pluginId: string, items: unknown, resolver: (pluginId: string, item: unknown) => T | null): T[] {
  if (!Array.isArray(items)) {
    return []
  }

  return items.flatMap((item) => {
    const resolved = resolver(pluginId, item)
    return resolved === null ? [] : [resolved]
  })
}

export function resolveContributions(enabledPlugins: RuntimeContributionSource[]): ResolvedContributions {
  const resolved: ResolvedContributions = {
    views: [],
    taskPaneTabs: [],
    commands: [],
    settingsSections: [],
    backgroundServices: [],
  }

  for (const plugin of enabledPlugins) {
    if (!isRecord(plugin) || !isNonEmptyString(plugin.pluginId)) {
      continue
    }

    resolved.views.push(...collectResolved(plugin.pluginId, plugin.views, resolveView))
    resolved.taskPaneTabs.push(...collectResolved(plugin.pluginId, plugin.taskPaneTabs, resolveTab))
    resolved.commands.push(...collectResolved(plugin.pluginId, plugin.commands, resolveCommand))
    resolved.settingsSections.push(...collectResolved(plugin.pluginId, plugin.settingsSections, resolveSettingsSection))
    resolved.backgroundServices.push(...collectResolved(plugin.pluginId, plugin.backgroundServices, resolveBackgroundService))
  }

  return resolved
}

export function resolveContributionsForSlot<TSlot extends ResolvedSlot>(
  contributions: ResolvedContributions,
  slotType: TSlot,
  slotId: string
): ResolvedSlotItems[TSlot] {
  const slotContributions = contributions[slotType]
  return slotContributions.filter((item): item is ResolvedSlotItems[TSlot][number] => matchesSlotId(item, slotId)) as ResolvedSlotItems[TSlot]
}
