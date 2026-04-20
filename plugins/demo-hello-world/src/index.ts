import type { PluginActivationResult, PluginContext } from '@openforge/plugin-sdk'
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
