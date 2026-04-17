import manifestJson from '../../plugins/github-sync/manifest.json'
import { makePluginViewKey } from './plugin/types'
import type { PluginManifest, PluginViewKey } from './plugin/types'

export const GITHUB_SYNC_PLUGIN_MANIFEST: PluginManifest = manifestJson
export const GITHUB_SYNC_PLUGIN_ID = GITHUB_SYNC_PLUGIN_MANIFEST.id
export const GITHUB_SYNC_VIEW_ID = 'pr_review'
export const GITHUB_SYNC_VIEW_KEY: PluginViewKey = makePluginViewKey(GITHUB_SYNC_PLUGIN_ID, GITHUB_SYNC_VIEW_ID)
