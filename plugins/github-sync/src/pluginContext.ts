import type { PluginContext } from '../../../src/lib/plugin/types'

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
