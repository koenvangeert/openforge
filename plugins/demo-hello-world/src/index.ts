import type { PluginActivationResult, PluginContext } from '../../../src/lib/plugin/types'
import HelloWorldView from './components/HelloWorldView.svelte'

export async function activate(context: PluginContext): Promise<PluginActivationResult> {
  return {
    contributions: {
      views: [
        {
          id: 'hello',
          title: 'Hello World',
          icon: 'plug',
          component: HelloWorldView,
        },
      ],
    },
  }
}

export async function deactivate(): Promise<void> {}
