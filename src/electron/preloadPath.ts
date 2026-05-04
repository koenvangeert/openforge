import { join } from 'node:path'

export const PRELOAD_BUNDLE_FILENAME = 'preload.cjs'

export function createPreloadPath(currentDirectory: string): string {
  return join(currentDirectory, PRELOAD_BUNDLE_FILENAME)
}
