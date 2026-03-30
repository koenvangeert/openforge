import { DiffFile } from '@git-diff-view/core'
import { highlighter } from '@git-diff-view/lowlight'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureDiffHighlighter } from '../../../../lib/diffHighlightConfig'
import type { DiffWorkerRequest, DiffWorkerResponse } from '../../../../lib/diffWorker'
import type { PrFileDiff } from '../../../../lib/types'
import DiffViewer from './DiffViewer.svelte'

const { virtualizerScrollToIndex } = vi.hoisted(() => ({
  virtualizerScrollToIndex: vi.fn(),
}))

vi.mock('../../../../lib/useVirtualizer.svelte', () => ({
  createVirtualizer: vi.fn((opts: { getCount: () => number }) => ({
    get virtualItems() {
      const count = opts.getCount()
      return Array.from({ length: count }, (_, index) => ({
        key: index,
        index,
        start: index * 300,
        end: (index + 1) * 300,
        size: 300,
        lane: 0,
      }))
    },
    get totalSize() {
      return opts.getCount() * 300
    },
    scrollToIndex: virtualizerScrollToIndex,
    measureAction: () => ({ destroy() {} }),
  })),
}))

class MockHighlight {
  ranges: AbstractRange[]

  constructor(...ranges: AbstractRange[]) {
    this.ranges = ranges
  }
}

class InlineDiffWorker {
  onmessage: ((ev: MessageEvent<DiffWorkerResponse>) => void) | null = null
  onerror: ((ev: ErrorEvent) => void) | null = null

  postMessage(message: DiffWorkerRequest): void {
    queueMicrotask(() => {
      try {
        if (message.type !== 'process') return

        const file = new DiffFile(
          message.data.oldFile.fileName,
          message.data.oldFile.content ?? '',
          message.data.newFile.fileName,
          message.data.newFile.content ?? '',
          message.data.hunks,
          message.data.oldFile.fileLang,
          message.data.newFile.fileLang,
        )

        file.initTheme(message.theme)
        file.initRaw()
        file.initSyntax({ registerHighlighter: highlighter })
        file.buildSplitDiffLines()
        file.buildUnifiedDiffLines()

        const response: DiffWorkerResponse = {
          type: 'result',
          id: message.id,
          bundle: file._getFullBundle(),
        }

        this.onmessage?.({ data: response } as MessageEvent<DiffWorkerResponse>)
        file.clearId()
      } catch (error) {
        this.onmessage?.({
          data: {
            type: 'error',
            id: message.id,
            error: String(error),
          },
        } as MessageEvent<DiffWorkerResponse>)
      }
    })
  }

  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return false
  }
}

const originalWorker = globalThis.Worker
const originalCanvasGetContext = HTMLCanvasElement.prototype.getContext
const highlightRegistry = new Map<string, MockHighlight>()

const fileWithPatch: PrFileDiff = {
  sha: 'abc123',
  filename: 'src/example.ts',
  status: 'modified',
  additions: 2,
  deletions: 2,
  changes: 4,
  patch: '@@ -1,2 +1,2 @@\n-const answer = 1\n-console.log(answer)\n+const addedValue = 2\n+console.log(addedValue)',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

beforeAll(() => {
  configureDiffHighlighter(highlighter)

  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: vi.fn().mockReturnValue({
      font: '',
      measureText: (text: string) => ({ width: text.length * 7 }),
      fillText: vi.fn(),
      clearRect: vi.fn(),
    }),
    configurable: true,
  })

  Object.defineProperty(globalThis, 'CSS', {
    value: { highlights: highlightRegistry },
    writable: true,
    configurable: true,
  })

  globalThis.Highlight = MockHighlight as unknown as typeof Highlight
})

afterAll(() => {
  globalThis.Worker = originalWorker
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: originalCanvasGetContext,
    configurable: true,
  })
})

describe('DiffViewer integration', () => {
  beforeEach(() => {
    globalThis.Worker = InlineDiffWorker as unknown as typeof Worker
    highlightRegistry.clear()
    virtualizerScrollToIndex.mockClear()
  })

  it('renders real DiffView content from worker-precomputed bundles', async () => {
    const batchFetchFileContents = vi.fn().mockResolvedValue(new Map([
      ['src/example.ts', {
        oldContent: 'const answer = 1\nconsole.log(answer)\n',
        newContent: 'const addedValue = 2\nconsole.log(addedValue)\n',
      }],
    ]))

    const { container } = render(DiffViewer, {
      props: {
        files: [fileWithPatch],
        batchFetchFileContents,
      },
    })

    await waitFor(() => {
      expect(batchFetchFileContents).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(container.querySelectorAll('.diff-line-content-item').length).toBeGreaterThan(0)
      expect(container.querySelectorAll('.diff-line-content-item span[data-start][data-end]').length).toBeGreaterThan(0)
      expect(container.textContent).toContain('addedValue')
    })
  })

  it('supports diff search against the real rendered diff output', async () => {
    render(DiffViewer, {
      props: {
        files: [fileWithPatch],
        batchFetchFileContents: vi.fn().mockResolvedValue(new Map([
          ['src/example.ts', {
            oldContent: 'const answer = 1\nconsole.log(answer)\n',
            newContent: 'const addedValue = 2\nconsole.log(addedValue)\n',
          }],
        ])),
      },
    })

    await waitFor(() => {
      expect(document.querySelectorAll('.diff-line-content-item').length).toBeGreaterThan(0)
    })

    await fireEvent.click(screen.getByTitle('Search (⌘F)'))

    const input = await screen.findByPlaceholderText('Search diff...')
    await fireEvent.input(input, { target: { value: 'addedValue' } })

    await waitFor(
      () => {
        expect(screen.getByText('1 of 2')).toBeTruthy()
        expect(virtualizerScrollToIndex).toHaveBeenCalledWith(0, { align: 'start' })

        const searchMatches = highlightRegistry.get('diff-search-match')
        const currentMatch = highlightRegistry.get('diff-search-current')

        expect(searchMatches?.ranges).toHaveLength(2)
        expect(currentMatch?.ranges).toHaveLength(1)
      },
      { timeout: 3000 },
    )

    await fireEvent.click(screen.getByTitle('Next match (Enter)'))

    await waitFor(() => {
      expect(screen.getByText('2 of 2')).toBeTruthy()
    })
  })
})
