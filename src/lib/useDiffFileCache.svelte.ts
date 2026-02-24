import { toGitDiffViewData, type FileContents, type DiffViewData } from './diffAdapter'
import type { PrFileDiff } from './types'

export interface DiffFileCacheState {
  getStableDiffData: (file: PrFileDiff) => DiffViewData
}

/**
 * Memoizes per-file DiffViewData to prevent DiffFile recreation which breaks
 * syntax highlighting. Cache is invalidated when file contents change, and
 * stale entries are cleaned up when files are removed from the diff.
 */
export function createDiffFileCache(deps: {
  getFiles: () => PrFileDiff[]
  getFileContentsMap: () => Map<string, FileContents>
}): DiffFileCacheState {
  const diffDataCache = new Map<string, { data: DiffViewData; contents: FileContents | undefined }>()

  // Clean up cache entries for files no longer in the diff
  $effect(() => {
    const currentFiles = new Set(deps.getFiles().map(f => f.filename))
    for (const key of diffDataCache.keys()) {
      if (!currentFiles.has(key)) diffDataCache.delete(key)
    }
  })

  function getStableDiffData(file: PrFileDiff): DiffViewData {
    const contents = deps.getFileContentsMap().get(file.filename)
    const cached = diffDataCache.get(file.filename)
    if (cached && cached.contents === contents) return cached.data
    const data = toGitDiffViewData(file, contents)
    diffDataCache.set(file.filename, { data, contents })
    return data
  }

  return { getStableDiffData }
}
