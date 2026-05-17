import { describe, expect, it } from 'vitest'

import { toGitDiffViewData } from '@openforge/pr-review-ui/diffAdapter'
import { prCommentsToReviewComments } from '@openforge/pr-review-ui/diffComments'
import { configureDiffHighlighter } from '@openforge/pr-review-ui/diffHighlightConfig'
import { diffHighlighter } from '@openforge/pr-review-ui/diffHighlighter'
import { countMatchesInPatch } from '@openforge/pr-review-ui/diffSearch'
import type { DiffWorkerRequest, DiffWorkerResponse } from '@openforge/pr-review-ui/diffWorker'
import { sortFilesAsTree } from '@openforge/pr-review-ui/fileSort'
import { createDiffSearch } from '@openforge/pr-review-ui/useDiffSearch.svelte'
import { createDiffWorker } from '@openforge/pr-review-ui/useDiffWorker.svelte'
import { createFileContentsFetcher } from '@openforge/pr-review-ui/useFileContentsFetcher.svelte'
import { createVirtualizer } from '@openforge/pr-review-ui/useVirtualizer.svelte'

/**
 * Keeps shared diff helper subpath exports intentional. The host app and bundled
 * plugins must import these helpers from @openforge/pr-review-ui instead of
 * carrying duplicated src/lib copies.
 */
describe('@openforge/pr-review-ui diff helper exports', () => {
  it('exposes the shared diff utility entrypoints consumed by host and plugins', () => {
    expect(toGitDiffViewData).toBeTypeOf('function')
    expect(prCommentsToReviewComments).toBeTypeOf('function')
    expect(configureDiffHighlighter).toBeTypeOf('function')
    expect(diffHighlighter).toBeDefined()
    expect(countMatchesInPatch).toBeTypeOf('function')
    expect(sortFilesAsTree).toBeTypeOf('function')
    expect(createDiffSearch).toBeTypeOf('function')
    expect(createDiffWorker).toBeTypeOf('function')
    expect(createFileContentsFetcher).toBeTypeOf('function')
    expect(createVirtualizer).toBeTypeOf('function')
  })

  it('exports diff worker request and response types', () => {
    const request = {
      type: 'process',
      id: 'file.ts',
      data: {
        oldFile: { fileName: 'file.ts', fileLang: 'typescript', content: null },
        newFile: { fileName: 'file.ts', fileLang: 'typescript', content: null },
        hunks: [],
      },
      theme: 'dark',
    } satisfies DiffWorkerRequest
    const response = { type: 'error', id: 'file.ts', error: 'failed' } satisfies DiffWorkerResponse

    expect(request.type).toBe('process')
    expect(response.type).toBe('error')
  })
})
