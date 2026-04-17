import type { PluginActivationResult, PluginContext } from '../../../src/lib/plugin/types'

export async function activate(_context: PluginContext): Promise<PluginActivationResult> {
  return {
    contributions: {}
  }
}

export async function deactivate(): Promise<void> {}
