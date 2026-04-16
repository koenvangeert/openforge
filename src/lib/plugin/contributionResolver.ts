import { ALLOWED_ICON_KEYS, normalizeShortcut } from './manifest'
import { isPluginViewKey, parsePluginViewKey } from './types'
import type { PluginManifest } from './types'

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

export interface ResolvedPanel {
  pluginId: string
  contributionId: string
  namespacedId: string
  title: string
  side: 'left' | 'right'
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
}

export interface ResolvedBackgroundService {
  pluginId: string
  contributionId: string
  namespacedId: string
  name: string
}

export interface ResolvedContributions {
  views: ResolvedView[]
  taskPaneTabs: ResolvedTab[]
  sidebarPanels: ResolvedPanel[]
  commands: ResolvedCommand[]
  settingsSections: ResolvedSettingsSection[]
  backgroundServices: ResolvedBackgroundService[]
}

type ResolvedSlot = keyof ResolvedContributions

type ResolvedSlotItems = {
  views: ResolvedView[]
  taskPaneTabs: ResolvedTab[]
  sidebarPanels: ResolvedPanel[]
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

function resolveView(pluginId: string, item: unknown): ResolvedView | null {
  if (!isRecord(item)) {
    return null
  }

  const { id, title, icon, shortcut, showInRail, railOrder } = item
  if (!isNonEmptyString(id) || !isNonEmptyString(title) || !isNonEmptyString(icon) || !ALLOWED_ICON_KEYS.has(icon)) {
    return null
  }

  return {
    pluginId,
    contributionId: id,
    namespacedId: toNamespacedId(pluginId, id),
    title,
    icon,
    shortcut: isNonEmptyString(shortcut) ? normalizeShortcut(shortcut) : null,
    showInRail: typeof showInRail === 'boolean' ? showInRail : true,
    railOrder: isNumber(railOrder) ? railOrder : 100,
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

function resolvePanel(pluginId: string, item: unknown): ResolvedPanel | null {
  if (!isRecord(item)) {
    return null
  }

  const { id, title, side, order } = item
  if (!isNonEmptyString(id) || !isNonEmptyString(title) || (side !== 'left' && side !== 'right')) {
    return null
  }

  return {
    pluginId,
    contributionId: id,
    namespacedId: toNamespacedId(pluginId, id),
    title,
    side,
    order: isNumber(order) ? order : 0,
  }
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
    shortcut: isNonEmptyString(shortcut) ? normalizeShortcut(shortcut) : null,
  }
}

function resolveSettingsSection(pluginId: string, item: unknown): ResolvedSettingsSection | null {
  if (!isRecord(item)) {
    return null
  }

  const { id, title } = item
  if (!isNonEmptyString(id) || !isNonEmptyString(title)) {
    return null
  }

  return {
    pluginId,
    contributionId: id,
    namespacedId: toNamespacedId(pluginId, id),
    title,
  }
}

function resolveBackgroundService(pluginId: string, item: unknown): ResolvedBackgroundService | null {
  if (!isRecord(item)) {
    return null
  }

  const { id, name } = item
  if (!isNonEmptyString(id) || !isNonEmptyString(name)) {
    return null
  }

  return {
    pluginId,
    contributionId: id,
    namespacedId: toNamespacedId(pluginId, id),
    name,
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

export function resolveContributions(enabledPlugins: PluginManifest[]): ResolvedContributions {
  const resolved: ResolvedContributions = {
    views: [],
    taskPaneTabs: [],
    sidebarPanels: [],
    commands: [],
    settingsSections: [],
    backgroundServices: [],
  }

  for (const plugin of enabledPlugins) {
    if (!isRecord(plugin) || !isNonEmptyString(plugin.id)) {
      continue
    }

    const contributes = isRecord(plugin.contributes) ? plugin.contributes : null
    if (contributes === null) {
      continue
    }

    resolved.views.push(...collectResolved(plugin.id, contributes.views, resolveView))
    resolved.taskPaneTabs.push(...collectResolved(plugin.id, contributes.taskPaneTabs, resolveTab))
    resolved.sidebarPanels.push(...collectResolved(plugin.id, contributes.sidebarPanels, resolvePanel))
    resolved.commands.push(...collectResolved(plugin.id, contributes.commands, resolveCommand))
    resolved.settingsSections.push(...collectResolved(plugin.id, contributes.settingsSections, resolveSettingsSection))
    resolved.backgroundServices.push(...collectResolved(plugin.id, contributes.backgroundServices, resolveBackgroundService))
  }

  return resolved
}

export function resolveContributionsForSlot<TSlot extends ResolvedSlot>(
  contributions: ResolvedContributions,
  slotType: TSlot,
  slotId: string
): ResolvedSlotItems[TSlot] {
  const slotContributions = contributions[slotType]
  return slotContributions.filter((item) => matchesSlotId(item, slotId))
}
