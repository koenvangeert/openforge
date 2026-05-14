import packageJson from '../../plugins/terminal/package.json'
import { manifestFromBuiltinPackage } from './plugin/builtinPluginMetadata'
import { makePluginViewKey } from './plugin/types'
import type { PluginManifest, PluginViewKey } from './plugin/types'

export const TERMINAL_PLUGIN_MANIFEST: PluginManifest = manifestFromBuiltinPackage(packageJson)
export const TERMINAL_PLUGIN_ID = TERMINAL_PLUGIN_MANIFEST.id
export const TERMINAL_VIEW_ID = 'terminal'
export const TERMINAL_VIEW_KEY: PluginViewKey = makePluginViewKey(TERMINAL_PLUGIN_ID, TERMINAL_VIEW_ID)
