import type { PluginActivationResult, PluginContext } from '../../../src/lib/plugin/types'
import FilesView from './FilesView.svelte'
import { setPluginContext } from './pluginContext'

type FileViewerActivationResult = PluginActivationResult

export const FilesViewComponent = FilesView

export async function activate(context: PluginContext): Promise<FileViewerActivationResult> {
  setPluginContext(context)
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
