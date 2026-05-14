import packageJson from '../../plugins/github-sync/package.json'
import { manifestFromBuiltinPackage } from './plugin/builtinPluginMetadata'
import { makePluginViewKey } from './plugin/types'
import type { PluginManifest, PluginViewKey } from './plugin/types'

export const GITHUB_SYNC_PLUGIN_MANIFEST: PluginManifest = manifestFromBuiltinPackage(packageJson)
export const GITHUB_SYNC_PLUGIN_ID = GITHUB_SYNC_PLUGIN_MANIFEST.id
export const GITHUB_SYNC_VIEW_ID = 'pr_review'
export const GITHUB_SYNC_VIEW_KEY: PluginViewKey = makePluginViewKey(GITHUB_SYNC_PLUGIN_ID, GITHUB_SYNC_VIEW_ID)
