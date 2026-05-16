import { DiffFile, setEnableFastDiffTemplate } from '@git-diff-view/core'
import { highlighter } from '@git-diff-view/lowlight'
import { configureDiffHighlighter } from './diffHighlightConfig'

setEnableFastDiffTemplate(true)
configureDiffHighlighter(highlighter)

export interface DiffWorkerRequest {
  type: 'process'
  id: string
  data: {
    oldFile: { fileName: string; fileLang: string; content: string | null }
    newFile: { fileName: string; fileLang: string; content: string | null }
    hunks: string[]
  }
  theme: 'light' | 'dark'
}

export interface DiffWorkerResult {
  type: 'result'
  id: string
  bundle: ReturnType<DiffFile['_getFullBundle']>
}

export interface DiffWorkerError {
  type: 'error'
  id: string
  error: string
}

export type DiffWorkerResponse = DiffWorkerResult | DiffWorkerError

self.onmessage = (e: MessageEvent<DiffWorkerRequest>) => {
  const { type, id, data, theme } = e.data

  if (type === 'process') {
    try {
      const file = new DiffFile(
        data.oldFile?.fileName || '',
        data.oldFile?.content || '',
        data.newFile?.fileName || '',
        data.newFile?.content || '',
        data.hunks || [],
        data.oldFile?.fileLang || '',
        data.newFile?.fileLang || ''
      )

      file.initTheme(theme || 'light')
      file.initRaw()
      file.initSyntax({ registerHighlighter: highlighter })
      file.buildSplitDiffLines()
      file.buildUnifiedDiffLines()

      const bundle = file._getFullBundle()

      self.postMessage({
        type: 'result',
        id,
        bundle,
      } satisfies DiffWorkerResult)

      file.clearId()
    } catch (err) {
      self.postMessage({
        type: 'error',
        id,
        error: String(err),
      } satisfies DiffWorkerError)
    }
  }
}
