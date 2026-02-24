import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushSync } from 'svelte'
import type { PrFileDiff } from './types'
import type { FileContents } from './diffAdapter'

import { createFileContentsFetcher } from './useFileContentsFetcher.svelte'
import type { FileContentsFetcherState } from './useFileContentsFetcher.svelte'

// ============================================================================
// Fixtures
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

const fileNoPatch: PrFileDiff = {
  sha: 'ghi789',
  filename: 'src/nopatch.ts',
  status: 'renamed',
  additions: 0,
  deletions: 0,
  changes: 0,
  patch: null,
  previous_filename: 'src/old.ts',
  is_truncated: false,
  patch_line_count: null,
}

// ============================================================================
// Tests
// ============================================================================

describe('createFileContentsFetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Initial state
  // --------------------------------------------------------------------------

  it('starts with an empty fileContentsMap', () => {
    let fetcher!: FileContentsFetcherState
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => undefined,
      })
    })

    expect(fetcher.fileContentsMap.size).toBe(0)
    cleanup()
  })

  it('does not fetch when no fetcher is provided', async () => {
    let fetcher!: FileContentsFetcherState
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => undefined,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(fetcher.fileContentsMap.size).toBe(0)
    cleanup()
  })

  it('does not fetch when files list is empty', async () => {
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map())

    const cleanup = $effect.root(() => {
      createFileContentsFetcher({
        getFiles: () => [],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).not.toHaveBeenCalled()
    cleanup()
  })

  it('does not fetch for files without patches', async () => {
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map())

    let fetcher!: FileContentsFetcherState
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileNoPatch],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).not.toHaveBeenCalled()
    expect(fetcher.fileContentsMap.size).toBe(0)
    cleanup()
  })

  // --------------------------------------------------------------------------
  // Batch fetching
  // --------------------------------------------------------------------------

  it('calls batchFetchFileContents with files that have patches', async () => {
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map([
        ['src/test.ts', { oldContent: 'old', newContent: 'new' }],
      ]))

    const cleanup = $effect.root(() => {
      createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).toHaveBeenCalledTimes(1)
    const [calledFiles] = batchFn.mock.calls[0] as [PrFileDiff[]]
    expect(calledFiles.map(f => f.filename)).toContain('src/test.ts')
    cleanup()
  })

  it('populates fileContentsMap after batch fetch', async () => {
    const contents: FileContents = { oldContent: 'old', newContent: 'new' }
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map([['src/test.ts', contents]]))

    let fetcher!: FileContentsFetcherState
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(fetcher.fileContentsMap.get('src/test.ts')).toBe(contents)
    cleanup()
  })

  it('batches all files in a single call', async () => {
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map([
        ['src/test.ts', { oldContent: '', newContent: 'a' }],
        ['src/other.ts', { oldContent: '', newContent: 'b' }],
      ]))

    const cleanup = $effect.root(() => {
      createFileContentsFetcher({
        getFiles: () => [fileWithPatch, fileWithPatch2],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).toHaveBeenCalledTimes(1)
    const [calledFiles] = batchFn.mock.calls[0] as [PrFileDiff[]]
    expect(calledFiles).toHaveLength(2)
    cleanup()
  })

  it('prefers batch fetch over per-file fetch when both are provided', async () => {
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map([['src/test.ts', { oldContent: '', newContent: 'a' }]]))
    const perFileFn = vi.fn<(file: PrFileDiff) => Promise<FileContents>>()
      .mockResolvedValue({ oldContent: '', newContent: 'a' })

    const cleanup = $effect.root(() => {
      createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => perFileFn,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).toHaveBeenCalledTimes(1)
    expect(perFileFn).not.toHaveBeenCalled()
    cleanup()
  })

  // --------------------------------------------------------------------------
  // Per-file fetching
  // --------------------------------------------------------------------------

  it('calls fetchFileContents for each file when no batch fetcher is provided', async () => {
    const perFileFn = vi.fn<(file: PrFileDiff) => Promise<FileContents>>()
      .mockResolvedValue({ oldContent: '', newContent: 'content' })

    const cleanup = $effect.root(() => {
      createFileContentsFetcher({
        getFiles: () => [fileWithPatch, fileWithPatch2],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => perFileFn,
        getBatchFetchFileContents: () => undefined,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(perFileFn).toHaveBeenCalledTimes(2)
    cleanup()
  })

  it('populates fileContentsMap after per-file fetch', async () => {
    const contents: FileContents = { oldContent: 'a', newContent: 'b' }
    const perFileFn = vi.fn<(file: PrFileDiff) => Promise<FileContents>>()
      .mockResolvedValue(contents)

    let fetcher!: FileContentsFetcherState
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => perFileFn,
        getBatchFetchFileContents: () => undefined,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(fetcher.fileContentsMap.get('src/test.ts')).toBe(contents)
    cleanup()
  })

  // --------------------------------------------------------------------------
  // Generation tracking (stale request detection)
  // --------------------------------------------------------------------------

  it('discards stale batch results when generation changes', async () => {
    let resolveFirst!: (value: Map<string, FileContents>) => void
    const firstPromise = new Promise<Map<string, FileContents>>(r => { resolveFirst = r })

    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValue(new Map([['src/test.ts', { oldContent: 'fresh', newContent: 'fresh' }]]))

    let includeUncommitted = $state(false)
    let fetcher!: FileContentsFetcherState

    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => includeUncommitted,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    // Effect runs — first fetch started (pending)
    await new Promise(resolve => setTimeout(resolve, 0))

    // Toggle includeUncommitted → resets and triggers new generation + new fetch
    includeUncommitted = true
    flushSync()
    await new Promise(resolve => setTimeout(resolve, 10))

    // Now resolve the first (stale) promise — should be discarded
    resolveFirst(new Map([['src/test.ts', { oldContent: 'stale', newContent: 'stale' }]]))
    await new Promise(resolve => setTimeout(resolve, 10))

    // The fresh fetch result should win, not the stale one
    const result = fetcher.fileContentsMap.get('src/test.ts')
    expect(result?.newContent).not.toBe('stale')
    cleanup()
  })

  // --------------------------------------------------------------------------
  // includeUncommitted toggle
  // --------------------------------------------------------------------------

  it('resets fetch state when includeUncommitted changes', async () => {
    let includeUncommitted = $state(false)

    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map([
        ['src/test.ts', { oldContent: '', newContent: 'content' }],
      ]))

    const cleanup = $effect.root(() => {
      createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => includeUncommitted,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    // Wait for initial fetch
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).toHaveBeenCalledTimes(1)

    // Change includeUncommitted — should reset and re-fetch
    includeUncommitted = true
    flushSync()

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).toHaveBeenCalledTimes(2)
    cleanup()
  })

  it('clears fileContentsMap when includeUncommitted toggles', async () => {
    let includeUncommitted = $state(false)

    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValueOnce(new Map([
        ['src/test.ts', { oldContent: '', newContent: 'first' }],
      ]))
      .mockResolvedValue(new Map())

    let fetcher!: FileContentsFetcherState
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => includeUncommitted,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(fetcher.fileContentsMap.size).toBe(1)

    // Toggle — map should clear
    includeUncommitted = true
    flushSync()
    // After flushSync, the reset effect has run, clearing fileContentsMap
    expect(fetcher.fileContentsMap.size).toBe(0)
    cleanup()
  })

  it('does not reset on first render (prevIncludeUncommitted guard)', async () => {
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map([
        ['src/test.ts', { oldContent: '', newContent: 'content' }],
      ]))

    let fetcher!: FileContentsFetcherState
    // includeUncommitted starts as true — should NOT trigger a reset
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => true,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    // Only one fetch (initial), not two (no spurious reset)
    expect(batchFn).toHaveBeenCalledTimes(1)
    expect(fetcher.fileContentsMap.size).toBe(1)
    cleanup()
  })
})
