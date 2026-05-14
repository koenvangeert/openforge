import type { JsonValue, PluginStorage, PluginStorageScope } from '@openforge/plugin-sdk'
import {
  deletePluginStorage,
  getPluginStorage,
  setPluginStorage,
  type PluginStorageScopeKind,
} from '../ipc'

function assertJsonSerializable(value: JsonValue): void {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      throw new Error('value is not JSON-serializable')
    }
  } catch (error) {
    throw new Error(`Plugin storage values must be JSON-serializable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function createIpcPluginStorageScope(pluginId: string, scope: PluginStorageScopeKind, scopeId: string | null): PluginStorageScope {
  return {
    get: async <T extends JsonValue = JsonValue>(key: string): Promise<T | null> => getPluginStorage(pluginId, scope, scopeId, key) as Promise<T | null>,
    set: async <T extends JsonValue = JsonValue>(key: string, value: T): Promise<void> => {
      assertJsonSerializable(value)
      await setPluginStorage(pluginId, scope, scopeId, key, value)
    },
    delete: async (key: string): Promise<void> => deletePluginStorage(pluginId, scope, scopeId, key),
  }
}

export function createIpcPluginStorage(pluginId: string): PluginStorage {
  return {
    global: createIpcPluginStorageScope(pluginId, 'global', null),
    project: (projectId: string) => createIpcPluginStorageScope(pluginId, 'project', projectId),
    task: (taskId: string) => createIpcPluginStorageScope(pluginId, 'task', taskId),
  }
}
