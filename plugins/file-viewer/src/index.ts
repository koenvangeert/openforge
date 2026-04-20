import type { PluginActivationResult, PluginContext } from '@openforge/plugin-sdk'
import FilesView from '../../../src/components/FilesView.svelte'

interface ActivatedViewContribution {
  id: string
  component: typeof FilesView
}

type FileViewerActivationResult = PluginActivationResult

export const FilesViewComponent = FilesView

export async function activate(_context: PluginContext): Promise<FileViewerActivationResult> {
  return {
    contributions: {
      views: [
        {
          id: 'files',
          component: FilesView,
        },
      ],
    },
  }
}

export async function deactivate(): Promise<void> {}
