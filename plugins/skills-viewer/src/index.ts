import type { PluginActivationResult, PluginContext } from '@openforge/plugin-sdk'
import SkillsView from '../../../src/components/SkillsView.svelte'

type SkillsViewerActivationResult = PluginActivationResult

export const SkillsViewComponent = SkillsView

export async function activate(_context: PluginContext): Promise<SkillsViewerActivationResult> {
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
