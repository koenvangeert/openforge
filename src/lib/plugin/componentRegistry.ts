import type { Component } from 'svelte'
import type { PluginViewKey, PluginViewProps } from './types'

const registry = new Map<PluginViewKey, Component<PluginViewProps>>()

export function registerViewComponent(key: PluginViewKey, component: Component<PluginViewProps>): void {
  registry.set(key, component)
}

export function getRegisteredComponent(key: PluginViewKey): Component<PluginViewProps> | undefined {
  return registry.get(key)
}

export function clearComponentRegistry(): void {
  registry.clear()
}
