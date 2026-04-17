import type { PluginActivationResult, PluginContext } from '../../../src/lib/plugin/types'
import FilesView from '../../../src/components/FilesView.svelte'

interface ActivatedViewContribution {
  id: string
  component: typeof FilesView
}

interface FileViewerActivationResult {
  contributions: Omit<PluginActivationResult['contributions'], 'views'> & {
    views: ActivatedViewContribution[]
  }
}

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
