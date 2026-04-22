import type { Component } from 'svelte'
import type { PluginViewKey, PluginViewProps } from './types'

const registry = new Map<PluginViewKey, Component<PluginViewProps>>()

export function registerViewComponent(key: PluginViewKey, component: Component<PluginViewProps>): void {
  registry.set(key, component)
}

export function getRegisteredComponent(key: PluginViewKey): Component<PluginViewProps> | undefined {
  return registry.get(key)
}

export function unregisterViewComponentsForPlugin(pluginId: string): void {
  const prefix = `plugin:${pluginId}:`
  for (const key of Array.from(registry.keys())) {
    if (key.startsWith(prefix)) {
      registry.delete(key)
    }
  }
}

export function clearComponentRegistry(): void {
  registry.clear()
}
