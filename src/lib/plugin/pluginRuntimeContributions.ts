import { registerRenderableContributionComponent, registerViewComponent, unregisterViewComponentsForPlugin } from './componentRegistry'
import { clearRuntimeContributionSource, setRuntimeContributionSource } from './pluginStore'
import { makePluginViewKey } from './types'
import type {
  RuntimeBackgroundServiceContribution,
  RuntimeCommandContribution,
  RuntimeContributionSnapshot,
  RuntimeSettingsSectionContribution,
  RuntimeTaskPaneTabContribution,
} from './runtimeContributionRegistry'

const pluginCommandHandlers = new Map<string, RuntimeCommandContribution['handler']>()
const backgroundServiceStops = new Map<string, () => Promise<void>>()

export function toNamespacedContributionId(pluginId: string, contributionId: string): string {
  return `${pluginId}:${contributionId}`
}

function runtimeSnapshotToContributionSource(snapshot: RuntimeContributionSnapshot) {
  return {
    views: snapshot.views.map((view) => ({
      id: view.id,
      title: view.title,
      icon: view.icon,
      shortcut: view.shortcut,
      placement: view.placement,
      order: view.order,
    })),
    taskPaneTabs: snapshot.taskPaneTabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      icon: tab.icon,
      order: tab.order,
    })),
    settingsSections: snapshot.settingsSections.map((section) => ({
      id: section.id,
      title: section.title,
      order: section.order,
    })),
    commands: snapshot.commands.map((command) => ({
      id: command.id,
      title: command.title,
      shortcut: command.shortcut,
    })),
    backgroundServices: snapshot.backgroundServices.map((service) => ({
      id: service.id,
      scope: service.scope,
    })),
  }
}

export function clearPluginRuntimeContributions(pluginId: string): void {
  unregisterViewComponentsForPlugin(pluginId)
  clearRuntimeContributionSource(pluginId)

  for (const key of Array.from(pluginCommandHandlers.keys())) {
    if (key.startsWith(`${pluginId}:`)) {
      pluginCommandHandlers.delete(key)
    }
  }
}

async function stopBackgroundServiceEntries(stopEntries: Array<[string, () => Promise<void>]>): Promise<void> {
  let firstError: unknown = null
  for (const [key, stop] of stopEntries.reverse()) {
    try {
      await stop()
    } catch (error) {
      firstError ??= error
    } finally {
      backgroundServiceStops.delete(key)
    }
  }

  if (firstError) {
    throw firstError
  }
}

export async function stopPluginBackgroundServices(pluginId: string): Promise<void> {
  const stopEntries = Array.from(backgroundServiceStops.entries()).filter(([key]) => key.startsWith(`${pluginId}:`))
  if (stopEntries.length === 0) return
  return stopBackgroundServiceEntries(stopEntries)
}

function registerRenderableContributions<T extends RuntimeTaskPaneTabContribution | RuntimeSettingsSectionContribution>(
  pluginId: string,
  slotType: 'taskPaneTabs' | 'settingsSections',
  contributions: T[] | undefined
): void {
  for (const contribution of contributions ?? []) {
    registerRenderableContributionComponent(slotType, toNamespacedContributionId(pluginId, contribution.id), contribution.component as never)
  }
}

function registerCommandContributions(pluginId: string, contributions: RuntimeCommandContribution[] | undefined): void {
  for (const contribution of contributions ?? []) {
    pluginCommandHandlers.set(toNamespacedContributionId(pluginId, contribution.id), contribution.handler)
  }
}

async function startBackgroundServices(
  pluginId: string,
  contributions: RuntimeBackgroundServiceContribution[] | undefined,
  registeredStopKeys: string[]
): Promise<void> {
  for (const contribution of contributions ?? []) {
    if (!contribution.started) {
      await contribution.start()
      contribution.started = true
    }

    const stopKey = toNamespacedContributionId(pluginId, contribution.id)
    backgroundServiceStops.set(
      stopKey,
      async () => {
        await contribution.stop?.()
        contribution.started = false
      }
    )
    registeredStopKeys.push(stopKey)
  }
}

async function rollbackAppliedRuntimeContributions(pluginId: string, registeredStopKeys: string[]): Promise<void> {
  const stopEntries = registeredStopKeys
    .map((key): [string, () => Promise<void>] | null => {
      const stop = backgroundServiceStops.get(key)
      return stop ? [key, stop] : null
    })
    .filter((entry): entry is [string, () => Promise<void>] => entry !== null)

  try {
    await stopBackgroundServiceEntries(stopEntries)
  } finally {
    clearPluginRuntimeContributions(pluginId)
  }
}

export async function applyRuntimeSnapshotContributions(pluginId: string, snapshot: RuntimeContributionSnapshot): Promise<void> {
  await stopPluginBackgroundServices(pluginId)
  clearPluginRuntimeContributions(pluginId)

  const registeredStopKeys: string[] = []

  try {
    setRuntimeContributionSource(pluginId, runtimeSnapshotToContributionSource(snapshot))

    for (const view of snapshot.views) {
      registerViewComponent(makePluginViewKey(pluginId, view.id), view.component as never)
    }

    registerRenderableContributions(pluginId, 'taskPaneTabs', snapshot.taskPaneTabs)
    registerRenderableContributions(pluginId, 'settingsSections', snapshot.settingsSections)
    registerCommandContributions(pluginId, snapshot.commands)
    await startBackgroundServices(pluginId, snapshot.backgroundServices, registeredStopKeys)
  } catch (error) {
    await rollbackAppliedRuntimeContributions(pluginId, registeredStopKeys)
    throw error
  }
}

export function getPluginCommandHandler(pluginId: string, commandId: string): RuntimeCommandContribution['handler'] | undefined {
  return pluginCommandHandlers.get(toNamespacedContributionId(pluginId, commandId))
}

export function hasPluginCommandHandler(pluginId: string, commandId: string): boolean {
  return pluginCommandHandlers.has(toNamespacedContributionId(pluginId, commandId))
}
