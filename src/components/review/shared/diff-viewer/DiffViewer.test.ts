import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toGitDiffViewData } from '../../../../lib/diffAdapter'
import type { PrFileDiff } from '../../../../lib/types'
import DiffViewer from './DiffViewer.svelte'

const { mockDiffView, mockDiffHighlighter } = vi.hoisted(() => ({
  mockDiffView: vi.fn().mockReturnValue(null),
  mockDiffHighlighter: { name: 'test-highlighter', type: 'class' },
}))
// ============================================================================
// Module Mocks
// ============================================================================

vi.mock('@git-diff-view/svelte', () => ({
  DiffView: mockDiffView,
  DiffModeEnum: { Split: 0, Unified: 1 },
  SplitSide: { old: 1, new: 2 },
}))

vi.mock('../../../../lib/useDiffWorker.svelte', () => ({
  createDiffWorker: vi.fn().mockReturnValue({
    getDiffFile: () => undefined,
    processing: false,
  }),
}))

vi.mock('../../../../lib/diffSearch', () => ({
  findMatchesInContainer: vi.fn().mockReturnValue([]),
  applySearchHighlights: vi.fn(),
  applyOccurrenceHighlights: vi.fn(),
  clearSearchHighlights: vi.fn(),
  clearOccurrenceHighlights: vi.fn(),
  getWordAtSelection: vi.fn().mockReturnValue(null),
  scrollToMatch: vi.fn(),
  countMatchesInPatch: vi.fn().mockReturnValue(0),
}))

vi.mock('../../../../lib/diffAdapter', () => ({
  toGitDiffViewData: vi.fn().mockReturnValue({}),
  isTruncated: vi.fn().mockReturnValue(false),
  getTruncationStats: vi.fn().mockReturnValue(null),
}))

vi.mock('../../../../lib/diffComments', () => ({
  buildExtendData: vi.fn().mockReturnValue({}),
}))

vi.mock('../../../../lib/diffHighlighter', () => ({
  diffHighlighter: mockDiffHighlighter,
}))

vi.mock('../../../../lib/useVirtualizer.svelte', () => ({
  createVirtualizer: vi.fn((opts: { getCount: () => number }) => ({
    get virtualItems() {
      const count = opts.getCount()
      return Array.from({ length: count }, (_, i) => ({
        key: i, index: i, start: i * 300, end: (i + 1) * 300, size: 300, lane: 0,
      }))
    },
    totalSize: 0,
    scrollToIndex: vi.fn(),
    measureAction: () => ({ destroy() {} }),
  })),
}))

// CSS Custom Highlight API — not available in jsdom
const mockHighlights = new Map()
Object.defineProperty(globalThis, 'CSS', {
  value: { highlights: mockHighlights },
  writable: true,
  configurable: true,
})

globalThis.Highlight = class MockHighlight {
  ranges: AbstractRange[]
  constructor(...ranges: AbstractRange[]) {
    this.ranges = ranges
  }
} as unknown as typeof Highlight

// ============================================================================
// Search Toolbar Tests
// ============================================================================

describe('DiffViewer Search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the configured registerHighlighter through to DiffView', async () => {
    const diffFile = { clearId: vi.fn() }
    const { createDiffWorker } = await import('../../../../lib/useDiffWorker.svelte')
    vi.mocked(createDiffWorker).mockReturnValue({
      getDiffFile: () => diffFile as never,
      processing: false,
    })

    render(DiffViewer, { props: { files: [fileWithPatch] } })

    await waitFor(() => {
      expect(mockDiffView).toHaveBeenCalled()
    })

    const lastCall = mockDiffView.mock.calls.at(-1)
    expect(lastCall?.[1]?.registerHighlighter).toBe(mockDiffHighlighter)
  })

  // --------------------------------------------------------------------------
  // toolbar visibility
  // --------------------------------------------------------------------------

  describe('toolbar visibility', () => {
    it('search input is hidden by default', () => {
      render(DiffViewer, { props: { files: [] } })
      expect(screen.queryByPlaceholderText('Search diff...')).toBeNull()
    })

    it('renders "No files to display" when files is empty', () => {
      render(DiffViewer, { props: { files: [] } })
      expect(screen.getByText('No files to display')).toBeTruthy()
    })

    it('makes search input visible after clicking search icon button', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(screen.queryByPlaceholderText('Search diff...')).not.toBeNull()
    })

    it('shows navigation buttons when search is open', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(screen.getByTitle('Previous match (Shift+Enter)')).toBeTruthy()
      expect(screen.getByTitle('Next match (Enter)')).toBeTruthy()
      expect(screen.getByTitle('Close search (Escape)')).toBeTruthy()
    })

    it('toolbar always renders Split and Unified mode buttons', () => {
      render(DiffViewer, { props: { files: [] } })
      expect(screen.getByText('Split')).toBeTruthy()
      expect(screen.getByText('Unified')).toBeTruthy()
    })
  })

  // --------------------------------------------------------------------------
  // keyboard shortcuts
  // --------------------------------------------------------------------------

  describe('keyboard shortcuts', () => {
    it('Cmd+F opens the search bar', async () => {
      const { container } = render(DiffViewer, { props: { files: [] } })

      const rootDiv = container.firstElementChild as HTMLElement
      await fireEvent.keyDown(rootDiv, { key: 'f', metaKey: true })
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(screen.queryByPlaceholderText('Search diff...')).not.toBeNull()
    })

    it('Ctrl+F opens the search bar', async () => {
      const { container } = render(DiffViewer, { props: { files: [] } })

      const rootDiv = container.firstElementChild as HTMLElement
      await fireEvent.keyDown(rootDiv, { key: 'f', ctrlKey: true })
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(screen.queryByPlaceholderText('Search diff...')).not.toBeNull()
    })

    it('Escape hides the search bar when open', async () => {
      render(DiffViewer, { props: { files: [] } })

      // Open search via button click
      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Verify search is open
      const input = screen.getByPlaceholderText('Search diff...')
      expect(input).toBeTruthy()

      // Press Escape on the input
      await fireEvent.keyDown(input, { key: 'Escape' })
      await new Promise(resolve => setTimeout(resolve, 10))

      // Input should be gone
      expect(screen.queryByPlaceholderText('Search diff...')).toBeNull()
    })

    it('Enter key on search input does not crash when no matches', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      const input = screen.getByPlaceholderText('Search diff...')
      await fireEvent.keyDown(input, { key: 'Enter' })

      // Search bar still open — no crash
      expect(screen.getByPlaceholderText('Search diff...')).toBeTruthy()
    })

    it('Shift+Enter key on search input does not crash when no matches', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      const input = screen.getByPlaceholderText('Search diff...')
      await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

      // Search bar still open — no crash
      expect(screen.getByPlaceholderText('Search diff...')).toBeTruthy()
    })
  })

  // --------------------------------------------------------------------------
  // search input behavior
  // --------------------------------------------------------------------------

  describe('search input behavior', () => {
    it('updates value as user types', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      const input = screen.getByPlaceholderText('Search diff...') as HTMLInputElement
      await fireEvent.input(input, { target: { value: 'hello' } })

      expect(input.value).toBe('hello')
    })

    it('shows "0 results" when query has no matches', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      const input = screen.getByPlaceholderText('Search diff...') as HTMLInputElement
      await fireEvent.input(input, { target: { value: 'xyz' } })

      // Wait for debounce (200ms) + rendering microtasks
      await new Promise(resolve => setTimeout(resolve, 350))

      expect(screen.getByText('0 results')).toBeTruthy()
    })

    it('close button (✕) hides search bar', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(screen.queryByPlaceholderText('Search diff...')).not.toBeNull()

      const closeBtn = screen.getByTitle('Close search (Escape)')
      await fireEvent.click(closeBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(screen.queryByPlaceholderText('Search diff...')).toBeNull()
    })

    it('navigation buttons are disabled when there are no matches', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      const prevBtn = screen.getByTitle('Previous match (Shift+Enter)') as HTMLButtonElement
      const nextBtn = screen.getByTitle('Next match (Enter)') as HTMLButtonElement

      expect(prevBtn.disabled).toBe(true)
      expect(nextBtn.disabled).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // search icon button
  // --------------------------------------------------------------------------

  describe('search icon button', () => {
    it('search icon button is always visible in toolbar', () => {
      render(DiffViewer, { props: { files: [] } })
      const searchBtn = screen.getByTitle('Search (⌘F)')
      expect(searchBtn).toBeTruthy()
    })

    it('search icon button has correct title attribute', () => {
      render(DiffViewer, { props: { files: [] } })
      const searchBtn = screen.getByTitle('Search (⌘F)') as HTMLButtonElement
      expect(searchBtn.title).toBe('Search (⌘F)')
    })

    it('search icon button remains visible when search bar is also open', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Button still in the DOM — search bar opened alongside it
      expect(screen.getByTitle('Search (⌘F)')).toBeTruthy()
      expect(screen.getByPlaceholderText('Search diff...')).toBeTruthy()
    })

    it('Wrap toggle button is always visible alongside the search icon', () => {
      render(DiffViewer, { props: { files: [] } })
      expect(screen.getByTitle('Enable line wrapping')).toBeTruthy()
      expect(screen.getByTitle('Search (⌘F)')).toBeTruthy()
    })
  })
})


// ============================================================================
// File Content Fetching Tests
// ============================================================================

const fileWithPatch: PrFileDiff = {
  sha: 'abc123',
  filename: 'src/test.ts',
  status: 'modified',
  additions: 2,
  deletions: 1,
  changes: 3,
  patch: '@@ -1,3 +1,4 @@\n line1\n+added\n line2',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

const fileWithPatch2: PrFileDiff = {
  sha: 'def456',
  filename: 'src/other.ts',
  status: 'added',
  additions: 5,
  deletions: 0,
  changes: 5,
  patch: '@@ -0,0 +1,5 @@\n+line1\n+line2',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

describe('DiffViewer file content fetching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('batch fetch is called with files that have patches', async () => {
    const batchFn = vi.fn().mockResolvedValue(new Map([
      ['src/test.ts', { oldContent: 'old', newContent: 'new' }],
    ]))

    render(DiffViewer, {
      props: {
        files: [fileWithPatch],
        batchFetchFileContents: batchFn,
      },
    })

    await waitFor(() => {
      expect(batchFn).toHaveBeenCalledTimes(1)
    })

    const [calledFiles] = batchFn.mock.calls[0] as [PrFileDiff[]]
    expect(calledFiles.map((f: PrFileDiff) => f.filename)).toContain('src/test.ts')
  })

  it('batch fetch is preferred over per-file fetch when both are provided', async () => {
    const batchFn = vi.fn().mockResolvedValue(new Map([
      ['src/test.ts', { oldContent: '', newContent: 'content' }],
    ]))
    const perFileFn = vi.fn().mockResolvedValue({ oldContent: '', newContent: 'content' })

    render(DiffViewer, {
      props: {
        files: [fileWithPatch],
        batchFetchFileContents: batchFn,
        fetchFileContents: perFileFn,
      },
    })

    await waitFor(() => {
      expect(batchFn).toHaveBeenCalledTimes(1)
    })

    expect(perFileFn).not.toHaveBeenCalled()
  })

  it('per-file fetch is used when no batch fetch is provided', async () => {
    const perFileFn = vi.fn().mockResolvedValue({ oldContent: '', newContent: 'content' })

    render(DiffViewer, {
      props: {
        files: [fileWithPatch],
        fetchFileContents: perFileFn,
      },
    })

    await waitFor(() => {
      expect(perFileFn).toHaveBeenCalledTimes(1)
    })

    const [calledFile] = perFileFn.mock.calls[0] as [PrFileDiff]
    expect(calledFile.filename).toBe('src/test.ts')
  })

  it('files without patches are not passed to batch fetch', async () => {
    const fileNoPatch: PrFileDiff = {
      ...fileWithPatch,
      filename: 'src/nopatch.ts',
      patch: null,
    }
    const batchFn = vi.fn().mockResolvedValue(new Map())

    render(DiffViewer, {
      props: {
        files: [fileNoPatch],
        batchFetchFileContents: batchFn,
      },
    })

    // Give the effect time to run
    await new Promise(resolve => setTimeout(resolve, 50))

    // batchFn should not be called because no files have patches
    expect(batchFn).not.toHaveBeenCalled()
  })

  it('re-fetches when includeUncommitted prop changes', async () => {
    const batchFn = vi.fn().mockResolvedValue(new Map([
      ['src/test.ts', { oldContent: '', newContent: 'content' }],
    ]))

    const { rerender } = render(DiffViewer, {
      props: {
        files: [fileWithPatch],
        batchFetchFileContents: batchFn,
        includeUncommitted: false,
      },
    })

    // Wait for initial fetch
    await waitFor(() => {
      expect(batchFn).toHaveBeenCalledTimes(1)
    })

    // Change includeUncommitted — should trigger re-fetch
    await rerender({
      files: [fileWithPatch],
      batchFetchFileContents: batchFn,
      includeUncommitted: true,
    })

    await waitFor(() => {
      expect(batchFn).toHaveBeenCalledTimes(2)
    })
  })

  it('batch fetch called once for multiple files in a single render', async () => {
    const batchFn = vi.fn().mockResolvedValue(new Map([
      ['src/test.ts', { oldContent: '', newContent: 'a' }],
      ['src/other.ts', { oldContent: '', newContent: 'b' }],
    ]))

    render(DiffViewer, {
      props: {
        files: [fileWithPatch, fileWithPatch2],
        batchFetchFileContents: batchFn,
      },
    })

    await waitFor(() => {
      expect(batchFn).toHaveBeenCalledTimes(1)
    })

    // Both files should be in the single batch call
    const [calledFiles] = batchFn.mock.calls[0] as [PrFileDiff[]]
    expect(calledFiles).toHaveLength(2)
    const filenames = calledFiles.map((f: PrFileDiff) => f.filename)
    expect(filenames).toContain('src/test.ts')
    expect(filenames).toContain('src/other.ts')
  })
})

// ============================================================================

// ============================================================================
// DiffViewData Memoization Tests
// ============================================================================

describe('DiffViewData memoization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not call toGitDiffViewData again on rerender when files and contents are unchanged', async () => {
    const mockToGitDiffViewData = vi.mocked(toGitDiffViewData)

    const { rerender } = render(DiffViewer, {
      props: { files: [fileWithPatch] },
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    const initialCallCount = mockToGitDiffViewData.mock.calls.length

    await rerender({ files: [fileWithPatch] })
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(mockToGitDiffViewData.mock.calls.length).toBe(initialCallCount)
  })

  it('memoization prevents unnecessary toGitDiffViewData calls on rerender with same files', async () => {
    const mockToGitDiffViewData = vi.mocked(toGitDiffViewData)
    const batchFn = vi.fn().mockResolvedValue(new Map([
      ['src/test.ts', { oldContent: 'old', newContent: 'new' }],
    ]))

    const { rerender } = render(DiffViewer, {
      props: {
        files: [fileWithPatch],
        batchFetchFileContents: batchFn,
      },
    })

    await waitFor(() => {
      expect(batchFn).toHaveBeenCalledTimes(1)
    })
    
    const callsAfterFirstRender = mockToGitDiffViewData.mock.calls.length

    // Rerender with same files and same batch function
    await rerender({
      files: [fileWithPatch],
      batchFetchFileContents: batchFn,
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    // toGitDiffViewData should not be called again because:
    // 1. Files array is the same
    // 2. fileContentsMap hasn't changed (batch fetch was already done)
    // 3. Cache should return the same DiffViewData object
    expect(mockToGitDiffViewData.mock.calls.length).toBe(callsAfterFirstRender)
  })
})
