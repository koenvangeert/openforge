import type { PrFileDiff } from './types'
import type { FileContents } from './diffAdapter'

export interface FileContentsFetcherState {
  readonly fileContentsMap: Map<string, FileContents>
}

/**
 * Manages batch and per-file content fetching with generation tracking to
 * discard stale results. Resets fetch state when includeUncommitted changes.
 */
export function createFileContentsFetcher(deps: {
  getFiles: () => PrFileDiff[]
  getIncludeUncommitted: () => boolean
  getFetchFileContents: () => ((file: PrFileDiff) => Promise<FileContents>) | undefined
  getBatchFetchFileContents: () => ((files: PrFileDiff[]) => Promise<Map<string, FileContents>>) | undefined
}): FileContentsFetcherState {
  let fileContentsMap = $state<Map<string, FileContents>>(new Map())
  let fetchedKeys = new Set<string>()
  let fetchGeneration = 0
  let prevIncludeUncommitted: boolean | undefined = undefined
  // Incremented on reset to force the fetch effect to re-run

  let resetSignal = $state(0)
  // Reset file contents when includeUncommitted changes (non-destructive: preserves collapsedFiles/scroll)
  $effect(() => {
    const current = deps.getIncludeUncommitted()
    if (prevIncludeUncommitted !== undefined && prevIncludeUncommitted !== current) {
      // Clear fetch state to trigger re-fetch with new includeUncommitted value
      fetchedKeys = new Set<string>()
      fileContentsMap = new Map()
      fetchGeneration++ // invalidate any in-flight fetches
      resetSignal++ // signal fetch effect to re-run
    }
    prevIncludeUncommitted = current
  })

  $effect(() => {
    const files = deps.getFiles()
    void resetSignal // track reset signal to re-run on includeUncommitted change
    const batchFetchFileContents = deps.getBatchFetchFileContents()
    const fetchFileContents = deps.getFetchFileContents()
    const hasFetcher = batchFetchFileContents || fetchFileContents
    if (!hasFetcher || files.length === 0) return

    const pendingFiles = files.filter(f => f.patch && !fetchedKeys.has(f.filename))
    if (pendingFiles.length === 0) return

    const thisGeneration = ++fetchGeneration

    if (batchFetchFileContents) {
      // ===========================================================================
      // Batch mode: single IPC call → single Map update → single re-render
      // ===========================================================================
      batchFetchFileContents(pendingFiles).then(results => {
        if (thisGeneration !== fetchGeneration) return // stale, discard
        const next = new Map(fileContentsMap)
        for (const [filename, contents] of results) {
          next.set(filename, contents)
          fetchedKeys.add(filename)
        }
        fileContentsMap = next
      }).catch(err => {
        console.error('Failed to batch-fetch file contents:', err)
      })
    } else {
      // ===========================================================================
      // Fallback: per-file fetching (used by PrReviewView)
      // ===========================================================================
      const fetcher = fetchFileContents!
      for (const file of pendingFiles) {
        fetchedKeys.add(file.filename)
        fetcher(file).then(contents => {
          fileContentsMap = new Map(fileContentsMap).set(file.filename, contents)
        }).catch(err => {
          console.error(`Failed to fetch content for ${file.filename}:`, err)
        })
      }
    }
  })

  return {
    get fileContentsMap() { return fileContentsMap },
  }
}
