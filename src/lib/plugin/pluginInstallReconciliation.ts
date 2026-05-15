import { get } from 'svelte/store'
import {
  getPlugin as getPluginIpc,
  uninstallPlugin as uninstallPluginIpc,
} from '../ipc'
import {
  enabledPluginIds,
  disablePlugin as disablePluginInStore,
  enablePlugin as enablePluginInStore,
  installedPlugins,
  loadEnabledPluginIdsForProject,
} from './pluginStore'
import { activatePlugin, deactivatePluginById } from './pluginActivationLifecycle'
import { upsertInstalledPlugin } from './pluginInstallState'

export async function uninstallPlugin(pluginId: string): Promise<void> {
  await deactivatePluginById(pluginId)
  await uninstallPluginIpc(pluginId)
  installedPlugins.update(map => {
    const next = new Map(map)
    next.delete(pluginId)
    return next
  })
}

export async function loadEnabledForProject(projectId: string): Promise<void> {
  await loadEnabledPluginIdsForProject(projectId)

  for (const pluginId of Array.from(get(enabledPluginIds))) {
    void activatePlugin(pluginId)
  }
}

export async function enablePluginForProject(projectId: string, pluginId: string): Promise<boolean> {
  await enablePluginInStore(projectId, pluginId)
  return activatePlugin(pluginId)
}

export async function disablePluginForProject(projectId: string, pluginId: string): Promise<void> {
  await disablePluginInStore(projectId, pluginId)
  await deactivatePluginById(pluginId)
}

export async function reloadPluginForProject(projectId: string, pluginId: string): Promise<boolean> {
  await deactivatePluginById(pluginId)

  const refreshedPlugin = await getPluginIpc(pluginId)
  if (!refreshedPlugin) {
    installedPlugins.update(map => {
      const next = new Map(map)
      next.delete(pluginId)
      return next
    })
    await loadEnabledPluginIdsForProject(projectId)
    return false
  }

  upsertInstalledPlugin(refreshedPlugin)
  await loadEnabledPluginIdsForProject(projectId)

  if (!get(enabledPluginIds).has(pluginId)) {
    return false
  }

  return activatePlugin(pluginId)
}

async function reconcileLoadedPlugins(): Promise<void> {
  const enabled = get(enabledPluginIds)
  const installed = get(installedPlugins)
  const loadedPluginIds = Array.from(installed.entries())
    .filter(([, entry]) => entry.state === 'active')
    .map(([pluginId]) => pluginId)

  for (const pluginId of loadedPluginIds) {
    if (!enabled.has(pluginId) || !installed.has(pluginId)) {
      await deactivatePluginById(pluginId)
    }
  }
}

enabledPluginIds.subscribe(() => {
  void reconcileLoadedPlugins()
})

installedPlugins.subscribe(() => {
  void reconcileLoadedPlugins()
})
