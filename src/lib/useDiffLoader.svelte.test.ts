import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { PrComment, PullRequestInfo, PrFileDiff, SelfReviewComment } from './types'

// ============================================================================
// Module Mocks
// ============================================================================

vi.mock('./stores', () => ({
  selfReviewDiffFiles: writable<PrFileDiff[]>([]),
  selfReviewGeneralComments: writable<SelfReviewComment[]>([]),
  selfReviewArchivedComments: writable<SelfReviewComment[]>([]),
  pendingManualComments: writable<{ path: string; line: number; body: string; side: string }[]>([]),
  ticketPrs: writable<Map<string, PullRequestInfo[]>>(new Map()),
}))

vi.mock('./ipc', () => ({
  getTaskDiff: vi.fn<(taskId: string, includeUncommitted: boolean) => Promise<PrFileDiff[]>>(),
  getActiveSelfReviewComments: vi.fn<(taskId: string) => Promise<SelfReviewComment[]>>(),
  getArchivedSelfReviewComments: vi.fn<(taskId: string) => Promise<SelfReviewComment[]>>(),
  getPrComments: vi.fn<(prId: number) => Promise<PrComment[]>>(),
}))

import { createDiffLoader } from './useDiffLoader.svelte'
import * as ipc from './ipc'
import { selfReviewDiffFiles, selfReviewGeneralComments, selfReviewArchivedComments, pendingManualComments, ticketPrs } from './stores'

const mockGetTaskDiff = vi.mocked(ipc.getTaskDiff)
const mockGetActiveSelfReviewComments = vi.mocked(ipc.getActiveSelfReviewComments)
const mockGetArchivedSelfReviewComments = vi.mocked(ipc.getArchivedSelfReviewComments)
const mockGetPrComments = vi.mocked(ipc.getPrComments)

// ============================================================================
// Fixtures
// ============================================================================

const baseDiff: PrFileDiff = {
  sha: 'abc123',
  filename: 'src/main.rs',
  status: 'modified',
  additions: 5,
  deletions: 2,
  changes: 7,
  patch: '@@ -1,3 +1,4 @@\n line1\n+added\n line2',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

const basePrComment: PrComment = {
  id: 1,
  pr_id: 10,
  author: 'reviewer',
  body: 'Fix this',
  comment_type: 'inline',
  file_path: 'src/main.rs',
  line_number: 5,
  addressed: 0,
  created_at: 1700000000,
}

const baseLinkedPr: PullRequestInfo = {
  id: 10,
  ticket_id: 'task-1',
  repo_owner: 'org',
  repo_name: 'repo',
  title: 'My PR',
  url: 'https://github.com/org/repo/pull/1',
  state: 'open',
  head_sha: 'abc',
  ci_status: null,
  ci_check_runs: null,
  review_status: null,
  merged_at: null,
  created_at: 1700000000,
  updated_at: 1700000000,
  unaddressed_comment_count: 1,
}

const baseSelfReviewComment: SelfReviewComment = {
  id: 1,
  task_id: 'task-1',
  round: 1,
  comment_type: 'general',
  file_path: null,
  line_number: null,
  body: 'General note',
  created_at: 1700000000,
  archived_at: null,
}

// ============================================================================
// Tests
// ============================================================================

describe('createDiffLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selfReviewDiffFiles.set([])
    selfReviewGeneralComments.set([])
    selfReviewArchivedComments.set([])
    pendingManualComments.set([])
    ticketPrs.set(new Map())

    // Default mock implementations
    mockGetTaskDiff.mockResolvedValue([])
    mockGetActiveSelfReviewComments.mockResolvedValue([])
    mockGetArchivedSelfReviewComments.mockResolvedValue([])
    mockGetPrComments.mockResolvedValue([])
  })

  it('starts with isLoading=false and error=null', () => {
    const loader = createDiffLoader({
      getTaskId: () => 'task-1',
      getIncludeUncommitted: () => false,
    })

    expect(loader.isLoading).toBe(false)
    expect(loader.error).toBeNull()
    expect(loader.prComments).toEqual([])
    expect(loader.linkedPr).toBeNull()
  })

  it('loadDiff sets isLoading=true during execution', async () => {
    let resolveGetTaskDiff!: (value: PrFileDiff[]) => void
    mockGetTaskDiff.mockReturnValue(new Promise(resolve => { resolveGetTaskDiff = resolve }))

    const loader = createDiffLoader({
      getTaskId: () => 'task-1',
      getIncludeUncommitted: () => false,
    })

    const promise = loader.loadDiff()
    expect(loader.isLoading).toBe(true)

    resolveGetTaskDiff([baseDiff])
    await promise

    expect(loader.isLoading).toBe(false)
  })

  it('loadDiff populates selfReviewDiffFiles store on success', async () => {
    mockGetTaskDiff.mockResolvedValue([baseDiff])

    const loader = createDiffLoader({
      getTaskId: () => 'task-1',
      getIncludeUncommitted: () => false,
    })

    await loader.loadDiff()

    expect(get(selfReviewDiffFiles)).toEqual([baseDiff])
  })

  it('loadDiff populates prComments from linked PR', async () => {
    mockGetTaskDiff.mockResolvedValue([baseDiff])
    mockGetActiveSelfReviewComments.mockResolvedValue([])
    mockGetArchivedSelfReviewComments.mockResolvedValue([])
    mockGetPrComments.mockResolvedValue([basePrComment])
    ticketPrs.set(new Map([['task-1', [baseLinkedPr]]]))

    const loader = createDiffLoader({
      getTaskId: () => 'task-1',
      getIncludeUncommitted: () => false,
    })

    await loader.loadDiff()

    expect(loader.linkedPr).toEqual(baseLinkedPr)
    expect(loader.prComments).toEqual([basePrComment])
    expect(mockGetPrComments).toHaveBeenCalledWith(baseLinkedPr.id)
  })

  it('loadDiff sets human-readable error on failure', async () => {
    mockGetTaskDiff.mockRejectedValue(new Error('network error'))

    const loader = createDiffLoader({
      getTaskId: () => 'task-1',
      getIncludeUncommitted: () => false,
    })

    await loader.loadDiff()

    expect(loader.error).toBe('Failed to load diff. Please try again.')
    expect(loader.isLoading).toBe(false)
  })

  it('loadDiff calls IPC with correct taskId and includeUncommitted', async () => {
    mockGetTaskDiff.mockResolvedValue([])

    const loader = createDiffLoader({
      getTaskId: () => 'task-42',
      getIncludeUncommitted: () => true,
    })

    await loader.loadDiff()

    expect(mockGetTaskDiff).toHaveBeenCalledWith('task-42', true)
    expect(mockGetActiveSelfReviewComments).toHaveBeenCalledWith('task-42')
  })

  it('refresh reloads diff data', async () => {
    mockGetTaskDiff.mockResolvedValue([baseDiff])

    const loader = createDiffLoader({
      getTaskId: () => 'task-1',
      getIncludeUncommitted: () => false,
    })

    await loader.refresh()

    expect(mockGetTaskDiff).toHaveBeenCalledWith('task-1', false)
    expect(get(selfReviewDiffFiles)).toEqual([baseDiff])
  })

  it('refresh sets human-readable error on failure', async () => {
    mockGetTaskDiff.mockRejectedValue(new Error('network error'))

    const loader = createDiffLoader({
      getTaskId: () => 'task-1',
      getIncludeUncommitted: () => false,
    })

    await loader.refresh()

    expect(loader.error).toBe('Failed to refresh diff.')
    expect(loader.isLoading).toBe(false)
  })

  it('cleanup clears all store state', async () => {
    mockGetTaskDiff.mockResolvedValue([baseDiff])
    mockGetActiveSelfReviewComments.mockResolvedValue([baseSelfReviewComment])
    mockGetArchivedSelfReviewComments.mockResolvedValue([])

    const loader = createDiffLoader({
      getTaskId: () => 'task-1',
      getIncludeUncommitted: () => false,
    })

    await loader.loadDiff()
    expect(get(selfReviewDiffFiles)).toEqual([baseDiff])

    loader.cleanup()

    expect(get(selfReviewDiffFiles)).toEqual([])
    expect(get(selfReviewGeneralComments)).toEqual([])
    expect(get(selfReviewArchivedComments)).toEqual([])
    expect(get(pendingManualComments)).toEqual([])
  })

  it('loadDiff populates general comments and archived comments stores', async () => {
    const generalComment = { ...baseSelfReviewComment, comment_type: 'general' }
    const inlineComment: SelfReviewComment = { ...baseSelfReviewComment, id: 2, comment_type: 'inline', file_path: 'src/main.rs', line_number: 5 }
    mockGetTaskDiff.mockResolvedValue([])
    mockGetActiveSelfReviewComments.mockResolvedValue([generalComment, inlineComment])
    mockGetArchivedSelfReviewComments.mockResolvedValue([generalComment])

    const loader = createDiffLoader({
      getTaskId: () => 'task-1',
      getIncludeUncommitted: () => false,
    })

    await loader.loadDiff()

    expect(get(selfReviewGeneralComments)).toEqual([generalComment])
    expect(get(selfReviewArchivedComments)).toEqual([generalComment])
    expect(get(pendingManualComments)).toEqual([{
      path: 'src/main.rs',
      line: 5,
      body: 'General note',
      side: 'RIGHT',
    }])
  })
})
