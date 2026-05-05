import type { PluginActivationResult, PluginContext } from '@openforge/plugin-sdk'
import TerminalTaskPane from './TerminalTaskPane.svelte'
import TerminalProjectView from './TerminalProjectView.svelte'

export async function activate(_context: PluginContext): Promise<PluginActivationResult> {
  return {
    contributions: {
      views: [
        {
          id: 'terminal',
          component: TerminalProjectView,
        },
      ],
      taskPaneTabs: [
        {
          id: 'terminal',
          component: TerminalTaskPane,
        },
      ],
      backgroundServices: [
        {
          id: 'pty-manager',
          start: async () => {},
          stop: async () => {},
        },
      ],
    }
  }
}

export async function deactivate(): Promise<void> {}
