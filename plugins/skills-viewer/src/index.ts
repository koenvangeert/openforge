import type { PluginActivationResult, PluginContext } from '../../../src/lib/plugin/types'
import SkillsView from './SkillsView.svelte'
import { setPluginContext } from './pluginContext'

type SkillsViewerActivationResult = PluginActivationResult

export const SkillsViewComponent = SkillsView

export async function activate(context: PluginContext): Promise<SkillsViewerActivationResult> {
  setPluginContext(context)
  return {
    contributions: {
      views: [
        {
          id: 'skills',
          component: SkillsView,
        },
      ],
    },
  }
}

export async function deactivate(): Promise<void> {}
