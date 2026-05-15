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

export async function stopPluginBackgroundServices(pluginId: string): Promise<void> {
  const stopEntries = Array.from(backgroundServiceStops.entries()).filter(([key]) => key.startsWith(`${pluginId}:`))
  for (const [key, stop] of stopEntries) {
    await stop()
    backgroundServiceStops.delete(key)
  }
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

async function startBackgroundServices(pluginId: string, contributions: RuntimeBackgroundServiceContribution[] | undefined): Promise<void> {
  for (const contribution of contributions ?? []) {
    if (!contribution.started) {
      await contribution.start()
      contribution.started = true
    }
    backgroundServiceStops.set(
      toNamespacedContributionId(pluginId, contribution.id),
      async () => {
        await contribution.stop?.()
        contribution.started = false
      }
    )
  }
}

export async function applyRuntimeSnapshotContributions(pluginId: string, snapshot: RuntimeContributionSnapshot): Promise<void> {
  clearPluginRuntimeContributions(pluginId)

  setRuntimeContributionSource(pluginId, runtimeSnapshotToContributionSource(snapshot))

  for (const view of snapshot.views) {
    registerViewComponent(makePluginViewKey(pluginId, view.id), view.component as never)
  }

  registerRenderableContributions(pluginId, 'taskPaneTabs', snapshot.taskPaneTabs)
  registerRenderableContributions(pluginId, 'settingsSections', snapshot.settingsSections)
  registerCommandContributions(pluginId, snapshot.commands)
  await startBackgroundServices(pluginId, snapshot.backgroundServices)
}

export function getPluginCommandHandler(pluginId: string, commandId: string): RuntimeCommandContribution['handler'] | undefined {
  return pluginCommandHandlers.get(toNamespacedContributionId(pluginId, commandId))
}

export function hasPluginCommandHandler(pluginId: string, commandId: string): boolean {
  return pluginCommandHandlers.has(toNamespacedContributionId(pluginId, commandId))
}
