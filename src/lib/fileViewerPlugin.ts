import packageJson from '../../plugins/file-viewer/package.json'
import { requestFileReveal } from '../../plugins/file-viewer/src/lib/stores'
import { manifestFromBuiltinPackage } from './plugin/builtinPluginMetadata'
import { makePluginViewKey } from './plugin/types'
import type { PluginManifest, PluginViewKey } from './plugin/types'

export const FILE_VIEWER_PLUGIN_MANIFEST: PluginManifest = manifestFromBuiltinPackage(packageJson)
export const FILE_VIEWER_PLUGIN_ID = FILE_VIEWER_PLUGIN_MANIFEST.id
export const FILE_VIEWER_VIEW_ID = 'files'
export const FILE_VIEWER_VIEW_KEY: PluginViewKey = makePluginViewKey(FILE_VIEWER_PLUGIN_ID, FILE_VIEWER_VIEW_ID)

export function revealFileInFileViewer(path: string): void {
  requestFileReveal(path)
}
