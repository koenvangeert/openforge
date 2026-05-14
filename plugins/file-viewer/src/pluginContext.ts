import type { PluginStorage } from '@openforge/plugin-sdk'

export interface PluginContext {
  pluginId: string
  invokeHost(command: string, payload?: unknown): Promise<unknown>
  invokeBackend(method: string, payload?: unknown): Promise<unknown>
  onEvent(event: string, handler: (payload: unknown) => void): () => void
  storage: PluginStorage
}

let pluginContext: PluginContext | null = null

export function setPluginContext(context: PluginContext): void {
  pluginContext = context
}

export function getPluginContext(): PluginContext {
  if (!pluginContext) {
    throw new Error('Plugin context is not initialized')
  }
  return pluginContext
}
