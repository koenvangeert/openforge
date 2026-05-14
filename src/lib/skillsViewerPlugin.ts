import packageJson from '../../plugins/skills-viewer/package.json'
import { manifestFromBuiltinPackage } from './plugin/builtinPluginMetadata'
import { makePluginViewKey } from './plugin/types'
import type { PluginManifest, PluginViewKey } from './plugin/types'

export const SKILLS_VIEWER_PLUGIN_MANIFEST: PluginManifest = manifestFromBuiltinPackage(packageJson)
export const SKILLS_VIEWER_PLUGIN_ID = SKILLS_VIEWER_PLUGIN_MANIFEST.id
export const SKILLS_VIEWER_VIEW_ID = 'skills'
export const SKILLS_VIEWER_VIEW_KEY: PluginViewKey = makePluginViewKey(SKILLS_VIEWER_PLUGIN_ID, SKILLS_VIEWER_VIEW_ID)
