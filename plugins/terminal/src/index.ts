import type { PluginActivationResult, PluginContext } from '@openforge/plugin-sdk'

export async function activate(_context: PluginContext): Promise<PluginActivationResult> {
  return {
    contributions: {}
  }
}

export async function deactivate(): Promise<void> {}
