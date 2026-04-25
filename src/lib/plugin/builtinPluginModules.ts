import type { PluginESM } from './pluginLoader'
import { FILE_VIEWER_PLUGIN_ID } from '../fileViewerPlugin'
import { GITHUB_SYNC_PLUGIN_ID } from '../githubSyncPlugin'
import { SKILLS_VIEWER_PLUGIN_ID } from '../skillsViewerPlugin'
import { TERMINAL_PLUGIN_ID } from '../terminalPlugin'
import * as fileViewerPlugin from '../../../plugins/file-viewer/src/index'
import * as githubSyncPlugin from '../../../plugins/github-sync/src/index'
import * as skillsViewerPlugin from '../../../plugins/skills-viewer/src/index'
import * as terminalPlugin from '../../../plugins/terminal/src/index'

const BUILTIN_PLUGIN_MODULES: Record<string, PluginESM> = {
  [FILE_VIEWER_PLUGIN_ID]: fileViewerPlugin,
  [GITHUB_SYNC_PLUGIN_ID]: githubSyncPlugin,
  [SKILLS_VIEWER_PLUGIN_ID]: skillsViewerPlugin,
  [TERMINAL_PLUGIN_ID]: terminalPlugin,
}

export function getBuiltinPluginModule(pluginId: string): PluginESM | undefined {
  return BUILTIN_PLUGIN_MODULES[pluginId]
}
