import { DiffFile } from '@git-diff-view/core'
import { toGitDiffViewData, type FileContents } from './diffAdapter'
import type { PrFileDiff } from '@openforge/plugin-sdk/domain'
import type { DiffWorkerResponse } from './diffWorker'

export interface DiffWorkerState {
  getDiffFile(filename: string): DiffFile | undefined
  readonly processing: boolean
}

export function createDiffWorker(deps: {
  getFiles: () => PrFileDiff[]
  getFileContentsMap: () => Map<string, FileContents>
  getDiffTheme: () => 'light' | 'dark'
}): DiffWorkerState {
  let diffFileMap = $state<Map<string, DiffFile>>(new Map())
  let pendingCount = $state(0)

  const sentKeys = new Map<string, FileContents | undefined>()
  let lastSentTheme: string | null = null

  const worker = new Worker(
    new URL('./diffWorker.ts', import.meta.url),
    { type: 'module' }
  )

  worker.onmessage = (e: MessageEvent<DiffWorkerResponse>) => {
    const msg = e.data
    if (msg.type === 'result') {
      const diffFile = DiffFile.createInstance({}, msg.bundle)
      const next = new Map(diffFileMap)
      next.set(msg.id, diffFile)
      diffFileMap = next
      pendingCount = Math.max(0, pendingCount - 1)
    } else if (msg.type === 'error') {
      console.error(`[DiffWorker] Failed to process ${msg.id}:`, msg.error)
      pendingCount = Math.max(0, pendingCount - 1)
    }
  }

  $effect(() => {
    const files = deps.getFiles()
    const contentsMap = deps.getFileContentsMap()
    const theme = deps.getDiffTheme()

    const themeChanged = lastSentTheme !== null && lastSentTheme !== theme
    if (themeChanged) sentKeys.clear()
    lastSentTheme = theme

    const currentFilenames = new Set(files.map(f => f.filename))
    for (const key of sentKeys.keys()) {
      if (!currentFilenames.has(key)) {
        sentKeys.delete(key)
        if (diffFileMap.has(key)) {
          const next = new Map(diffFileMap)
          next.get(key)?.clearId()
          next.delete(key)
          diffFileMap = next
        }
      }
    }

    for (const file of files) {
      if (!file.patch) continue

      const contents = contentsMap.get(file.filename)
      if (sentKeys.has(file.filename) && sentKeys.get(file.filename) === contents) continue

      sentKeys.set(file.filename, contents)

      const data = toGitDiffViewData(file, contents)

      worker.postMessage({
        type: 'process',
        id: file.filename,
        data,
        theme,
      })
      pendingCount++
    }
  })

  $effect(() => {
    return () => {
      worker.terminate()
      for (const df of diffFileMap.values()) {
        df.clearId()
      }
    }
  })

  return {
    getDiffFile(filename: string) { return diffFileMap.get(filename) },
    get processing() { return pendingCount > 0 },
  }
}
