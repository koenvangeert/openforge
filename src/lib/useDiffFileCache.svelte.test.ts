import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushSync } from 'svelte'
import type { PrFileDiff } from './types'
import type { FileContents, DiffViewData } from './diffAdapter'

// ============================================================================
// Module Mocks
// ============================================================================

vi.mock('./diffAdapter', () => ({
  toGitDiffViewData: vi.fn<(file: PrFileDiff, contents?: FileContents) => DiffViewData>(),
}))

import { createDiffFileCache } from './useDiffFileCache.svelte'
import type { DiffFileCacheState } from './useDiffFileCache.svelte'
import * as diffAdapter from './diffAdapter'

const mockToGitDiffViewData = vi.mocked(diffAdapter.toGitDiffViewData)

// ============================================================================
// Fixtures
// ============================================================================

const mockDiffData: DiffViewData = {
  oldFile: { fileName: 'test.ts', fileLang: 'typescript' },
  newFile: { fileName: 'test.ts', fileLang: 'typescript' },
  hunks: ['@@ -1 +1 @@\n-old\n+new'],
}

const baseFile: PrFileDiff = {
  sha: 'abc',
  filename: 'test.ts',
  status: 'modified',
  additions: 1,
  deletions: 0,
  changes: 1,
  patch: '@@ -1 +1 @@\n-old\n+new',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

const otherFile: PrFileDiff = {
  sha: 'def',
  filename: 'other.ts',
  status: 'added',
  additions: 2,
  deletions: 0,
  changes: 2,
  patch: '@@ -0,0 +1,2 @@\n+line1\n+line2',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

// ============================================================================
// Tests
// ============================================================================

describe('createDiffFileCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockToGitDiffViewData.mockReturnValue(mockDiffData)
  })

  // --------------------------------------------------------------------------
  // Memoization
  // --------------------------------------------------------------------------

  it('calls toGitDiffViewData on first access', () => {
    let cache!: DiffFileCacheState
    const cleanup = $effect.root(() => {
      cache = createDiffFileCache({
        getFiles: () => [baseFile],
        getFileContentsMap: () => new Map(),
      })
    })

    cache.getStableDiffData(baseFile)

    expect(mockToGitDiffViewData).toHaveBeenCalledTimes(1)
    expect(mockToGitDiffViewData).toHaveBeenCalledWith(baseFile, undefined)
    cleanup()
  })

  it('returns the same cached object on repeated calls with same file and no contents', () => {
    let cache!: DiffFileCacheState
    const cleanup = $effect.root(() => {
      cache = createDiffFileCache({
        getFiles: () => [baseFile],
        getFileContentsMap: () => new Map(),
      })
    })

    const first = cache.getStableDiffData(baseFile)
    const second = cache.getStableDiffData(baseFile)
    const third = cache.getStableDiffData(baseFile)

    expect(first).toBe(second)
    expect(second).toBe(third)
    expect(mockToGitDiffViewData).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('returns the same cached object when file contents are unchanged', () => {
    const contents: FileContents = { oldContent: 'old', newContent: 'new' }
    const contentsMap = new Map([['test.ts', contents]])

    let cache!: DiffFileCacheState
    const cleanup = $effect.root(() => {
      cache = createDiffFileCache({
        getFiles: () => [baseFile],
        getFileContentsMap: () => contentsMap,
      })
    })

    const first = cache.getStableDiffData(baseFile)
    const second = cache.getStableDiffData(baseFile)

    expect(first).toBe(second)
    expect(mockToGitDiffViewData).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('passes file contents to toGitDiffViewData when available', () => {
    const contents: FileContents = { oldContent: 'old', newContent: 'new' }
    const contentsMap = new Map([['test.ts', contents]])

    let cache!: DiffFileCacheState
    const cleanup = $effect.root(() => {
      cache = createDiffFileCache({
        getFiles: () => [baseFile],
        getFileContentsMap: () => contentsMap,
      })
    })

    cache.getStableDiffData(baseFile)

    expect(mockToGitDiffViewData).toHaveBeenCalledWith(baseFile, contents)
    cleanup()
  })

  // --------------------------------------------------------------------------
  // Cache invalidation
  // --------------------------------------------------------------------------

  it('recomputes when file contents reference changes', () => {
    const contents1: FileContents = { oldContent: 'old1', newContent: 'new1' }
    const contents2: FileContents = { oldContent: 'old2', newContent: 'new2' }
    let contentsMap = new Map([['test.ts', contents1]])

    let cache!: DiffFileCacheState
    const cleanup = $effect.root(() => {
      cache = createDiffFileCache({
        getFiles: () => [baseFile],
        getFileContentsMap: () => contentsMap,
      })
    })

    cache.getStableDiffData(baseFile)
    expect(mockToGitDiffViewData).toHaveBeenCalledTimes(1)

    // Swap out the contents object reference
    contentsMap = new Map([['test.ts', contents2]])
    cache.getStableDiffData(baseFile)
    expect(mockToGitDiffViewData).toHaveBeenCalledTimes(2)
    cleanup()
  })

  it('recomputes when file contents go from defined to undefined', () => {
    const contents: FileContents = { oldContent: 'a', newContent: 'b' }
    let contentsMap: Map<string, FileContents> = new Map([['test.ts', contents]])

    let cache!: DiffFileCacheState
    const cleanup = $effect.root(() => {
      cache = createDiffFileCache({
        getFiles: () => [baseFile],
        getFileContentsMap: () => contentsMap,
      })
    })

    cache.getStableDiffData(baseFile)
    expect(mockToGitDiffViewData).toHaveBeenCalledTimes(1)

    // Remove contents
    contentsMap = new Map()
    cache.getStableDiffData(baseFile)
    expect(mockToGitDiffViewData).toHaveBeenCalledTimes(2)
    cleanup()
  })

  it('caches independently per file', () => {
    let cache!: DiffFileCacheState
    const cleanup = $effect.root(() => {
      cache = createDiffFileCache({
        getFiles: () => [baseFile, otherFile],
        getFileContentsMap: () => new Map(),
      })
    })

    cache.getStableDiffData(baseFile)
    cache.getStableDiffData(otherFile)
    cache.getStableDiffData(baseFile)
    cache.getStableDiffData(otherFile)

    expect(mockToGitDiffViewData).toHaveBeenCalledTimes(2)
    cleanup()
  })

  // --------------------------------------------------------------------------
  // Cache cleanup
  // --------------------------------------------------------------------------

  it('cache cleanup removes stale entries when files list shrinks', () => {
    let files = $state([baseFile, otherFile])

    let cache!: DiffFileCacheState
    const cleanup = $effect.root(() => {
      cache = createDiffFileCache({
        getFiles: () => files,
        getFileContentsMap: () => new Map(),
      })
    })

    // Populate cache for both files
    cache.getStableDiffData(baseFile)
    cache.getStableDiffData(otherFile)
    expect(mockToGitDiffViewData).toHaveBeenCalledTimes(2)

    // Remove otherFile from files — cleanup effect should clear its cache entry
    files = [baseFile]
    flushSync()

    // baseFile still cached — no recompute needed
    cache.getStableDiffData(baseFile)
    expect(mockToGitDiffViewData).toHaveBeenCalledTimes(2)

    // otherFile was removed from files → cache entry cleaned up → must recompute
    cache.getStableDiffData(otherFile)
    expect(mockToGitDiffViewData).toHaveBeenCalledTimes(3)
    cleanup()
  })
})
