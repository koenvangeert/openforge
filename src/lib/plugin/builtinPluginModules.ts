import type { LoadedPluginModule } from './pluginLoader'
import { FILE_VIEWER_PLUGIN_ID } from '../fileViewerPlugin'
import { GITHUB_SYNC_PLUGIN_ID } from '../githubSyncPlugin'
import { SKILLS_VIEWER_PLUGIN_ID } from '../skillsViewerPlugin'
import { TERMINAL_PLUGIN_ID } from '../terminalPlugin'
import fileViewerPlugin from '../../../plugins/file-viewer/src/index'
import githubSyncPlugin from '../../../plugins/github-sync/src/index'
import skillsViewerPlugin from '../../../plugins/skills-viewer/src/index'
import terminalPlugin from '../../../plugins/terminal/src/index'

const BUILTIN_PLUGIN_MODULES: Record<string, LoadedPluginModule> = {
  [FILE_VIEWER_PLUGIN_ID]: fileViewerPlugin,
  [GITHUB_SYNC_PLUGIN_ID]: githubSyncPlugin,
  [SKILLS_VIEWER_PLUGIN_ID]: skillsViewerPlugin,
  [TERMINAL_PLUGIN_ID]: terminalPlugin,
}

export function getBuiltinPluginModule(pluginId: string): LoadedPluginModule | undefined {
  return BUILTIN_PLUGIN_MODULES[pluginId]
}
