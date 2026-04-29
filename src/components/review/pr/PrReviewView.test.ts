import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { requireDefined, requireElement } from '../../../test-utils/dom'
import type { ReviewPullRequest, AuthoredPullRequest, PrFileDiff, ReviewSubmissionComment } from '../../../lib/types'

vi.mock('../../../lib/stores', () => ({
  reviewPrs: writable([]),
  selectedReviewPr: writable(null),
  prFileDiffs: writable([]),
  reviewRequestCount: writable(0),
  reviewComments: writable([]),
  pendingManualComments: writable([]),
  prOverviewComments: writable([]),
  agentReviewComments: writable([]),
  agentReviewLoading: writable(false),
  agentReviewError: writable(null),
  authoredPrs: writable([]),
  authoredPrCount: writable(0),
  activeProjectId: writable('P-1'),
  currentView: writable('plugin:com.openforge.github-sync:pr_review'),
  selectedTaskId: writable<string | null>(null),
  selectedSkillIdentity: writable(null),
}))

vi.mock('../../../lib/useDiffWorker.svelte', () => ({
  createDiffWorker: vi.fn().mockReturnValue({
    getDiffFile: () => undefined,
    processing: false,
  }),
}))

vi.mock('../../../lib/ipc', () => ({
  fetchReviewPrs: vi.fn(),
  getReviewPrs: vi.fn().mockResolvedValue([]),
  fetchAuthoredPrs: vi.fn(),
  getAuthoredPrs: vi.fn().mockResolvedValue([]),
  getPrFileDiffs: vi.fn().mockResolvedValue([]),
  getReviewComments: vi.fn().mockResolvedValue([]),
  getFileContent: vi.fn().mockResolvedValue(''),
  getFileContentBase64: vi.fn().mockResolvedValue(''),
  getFileAtRef: vi.fn().mockResolvedValue(''),
  getFileAtRefBase64: vi.fn().mockResolvedValue(''),
  getPrOverviewComments: vi.fn().mockResolvedValue([]),
  getAgentReviewComments: vi.fn().mockResolvedValue([]),
  submitPrReview: vi.fn(),
  markReviewPrViewed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn(),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  setProjectConfig: vi.fn().mockResolvedValue(undefined),
  startAgentReview: vi.fn().mockResolvedValue({ session_id: 'session-1' }),
  abortAgentReview: vi.fn().mockResolvedValue(undefined),
}))

import PrReviewView from './PrReviewView.svelte'
import { reviewPrs, selectedReviewPr, prFileDiffs, reviewComments, pendingManualComments, reviewRequestCount, agentReviewComments, agentReviewLoading, agentReviewError, authoredPrs, authoredPrCount, activeProjectId } from '../../../lib/stores'
import { getReviewPrs, fetchReviewPrs, getAuthoredPrs, getPrFileDiffs, getReviewComments, markReviewPrViewed, getProjectConfig, setProjectConfig } from '../../../lib/ipc'
import { listen } from '@tauri-apps/api/event'

const basePr: ReviewPullRequest = {
  id: 12345,
  number: 42,
  title: 'Fix authentication middleware',
  body: 'This PR fixes the auth middleware',
  state: 'open',
  draft: false,
  html_url: 'https://github.com/acme/repo/pull/42',
  user_login: 'alice',
  user_avatar_url: null,
  repo_owner: 'acme',
  repo_name: 'repo',
  head_ref: 'fix/auth',
  base_ref: 'main',
  head_sha: 'abc123',
  additions: 50,
  deletions: 10,
  changed_files: 3,
  mergeable: null,
  mergeable_state: null,
  created_at: Date.now() - 3600000,
  updated_at: Date.now(),
  viewed_at: null,
  viewed_head_sha: null,
}

describe('PrReviewView', () => {
  beforeEach(() => {
    reviewPrs.set([])
    selectedReviewPr.set(null)
    prFileDiffs.set([])
    reviewComments.set([])
    pendingManualComments.set([])
    reviewRequestCount.set(0)
    authoredPrs.set([])
    authoredPrCount.set(0)
    agentReviewComments.set([])
    agentReviewLoading.set(false)
    agentReviewError.set(null)
    vi.clearAllMocks()
  })

  it('shows list view by default', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([])
    vi.mocked(getAuthoredPrs).mockResolvedValue([])
    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByText('Review Requests')).toBeTruthy()
    })
  })

  it('shows empty state when no PRs', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([])
    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByText('No PRs requesting your review')).toBeTruthy()
      expect(screen.getByText("You're all caught up!")).toBeTruthy()
    })
  })

  it('shows refresh buttons for both columns', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([])
    vi.mocked(getAuthoredPrs).mockResolvedValue([])
    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByText('Review Requests')).toBeTruthy()
      expect(screen.getByText('My Pull Requests')).toBeTruthy()
    })
  })

  it('shows review PR count badge in list view', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getAuthoredPrs).mockResolvedValue([])
    render(PrReviewView)

    await waitFor(() => {
      reviewPrs.set([basePr])
    })

    expect(screen.getByText('1')).toBeTruthy()
  })

  it('shows count badge for multiple review PRs', async () => {
    const secondPr = { ...basePr, id: 67890, number: 43 }
    vi.mocked(getReviewPrs).mockResolvedValue([basePr, secondPr])
    vi.mocked(getAuthoredPrs).mockResolvedValue([])
    render(PrReviewView)

    await waitFor(() => {
      reviewPrs.set([basePr, secondPr])
    })

    expect(screen.getByText('2')).toBeTruthy()
  })

  it('shows PR cards when reviewPrs store has data', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    reviewPrs.set([basePr])

    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByText('Fix authentication middleware')).toBeTruthy()
      expect(screen.getAllByText('acme/repo').length).toBeGreaterThan(0)
    })
  })

  it('calls fetchReviewPrs when review refresh button is clicked', async () => {
    const mockFetch = vi.mocked(fetchReviewPrs).mockResolvedValue([])
    vi.mocked(getReviewPrs).mockResolvedValue([])
    vi.mocked(getAuthoredPrs).mockResolvedValue([])

    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByText('Review Requests')).toBeTruthy()
    })

    const refreshBtns = screen.getAllByRole('button', { name: /↻/ })
    await fireEvent.click(refreshBtns[0])

    expect(mockFetch).toHaveBeenCalled()
  })

  it('shows detail view when selectedReviewPr is set', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewComments).mockResolvedValue([])

    render(PrReviewView)

    await waitFor(() => {
      reviewPrs.set([basePr])
    })

    selectedReviewPr.set(basePr)

    await waitFor(() => {
      expect(screen.getByText('← Back')).toBeTruthy()
      expect(screen.getByText('Fix authentication middleware')).toBeTruthy()
    })
  })

  it('exposes the files tab diff content as a dedicated scroll region', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewComments).mockResolvedValue([])

    render(PrReviewView)

    selectedReviewPr.set(basePr)

    await fireEvent.click(await screen.findByRole('button', { name: /Files changed/ }))

    expect(screen.getByRole('region', { name: 'Diff scroll area' })).toBeTruthy()
    expect(screen.getByText('Submit Review')).toBeTruthy()
  })

  it('shows back button in detail view', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewComments).mockResolvedValue([])

    render(PrReviewView)

    selectedReviewPr.set(basePr)

    await waitFor(() => {
      expect(screen.getByText('← Back')).toBeTruthy()
    })
  })

  it('shows PR title in detail view header', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewComments).mockResolvedValue([])

    render(PrReviewView)

    selectedReviewPr.set(basePr)

    await waitFor(() => {
      expect(screen.getByText('Fix authentication middleware')).toBeTruthy()
    })
  })

  it('shows PR number in detail view', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewComments).mockResolvedValue([])

    render(PrReviewView)

    selectedReviewPr.set(basePr)

    await waitFor(() => {
      expect(screen.getByText('#42')).toBeTruthy()
    })
  })

  it('back button clears selectedReviewPr', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewComments).mockResolvedValue([])

    render(PrReviewView)

    selectedReviewPr.set(basePr)

    await waitFor(() => {
      expect(screen.getByText('← Back')).toBeTruthy()
    })

    const backBtn = screen.getByText('← Back')
    await fireEvent.click(backBtn)

    await waitFor(() => {
      expect(screen.getByText('Review Requests')).toBeTruthy()
    })
  })

  it('calls getPrFileDiffs when PR is selected', async () => {
    const mockGetDiffs = vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getReviewComments).mockResolvedValue([])

    reviewPrs.set([basePr])

    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByText('Fix authentication middleware')).toBeTruthy()
    })

    const prCard = screen.getByText('Fix authentication middleware')
    await fireEvent.click(prCard)

    await waitFor(() => {
      expect(mockGetDiffs).toHaveBeenCalledWith('acme', 'repo', 42)
    })
  })

  it('calls getReviewComments when PR is selected', async () => {
    const mockGetComments = vi.mocked(getReviewComments).mockResolvedValue([])
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])

    reviewPrs.set([basePr])

    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByText('Fix authentication middleware')).toBeTruthy()
    })

    const prCard = screen.getByText('Fix authentication middleware')
    await fireEvent.click(prCard)

    await waitFor(() => {
      expect(mockGetComments).toHaveBeenCalledWith('acme', 'repo', 42)
    })
  })

  it('groups PRs by repository', async () => {
    const pr1 = { ...basePr, repo_owner: 'acme', repo_name: 'repo1', id: 1, number: 1, title: 'PR 1' }
    const pr2 = { ...basePr, repo_owner: 'acme', repo_name: 'repo1', id: 2, number: 2, title: 'PR 2' }
    const pr3 = { ...basePr, repo_owner: 'acme', repo_name: 'repo2', id: 3, number: 3, title: 'PR 3' }

    vi.mocked(getReviewPrs).mockResolvedValue([pr1, pr2, pr3])
    reviewPrs.set([pr1, pr2, pr3])

    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getAllByText('acme/repo1').length).toBeGreaterThan(0)
      expect(screen.getAllByText('acme/repo2').length).toBeGreaterThan(0)
    })
  })

  it('clears prFileDiffs when back button is clicked', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewComments).mockResolvedValue([])

    render(PrReviewView)

    selectedReviewPr.set(basePr)
    prFileDiffs.set([
      {
        sha: 'a1',
        filename: 'test.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        changes: 2,
        patch: '@@ -1,1 +1,1 @@',
        previous_filename: null,
        is_truncated: false,
        patch_line_count: null,
      },
    ])

    await waitFor(() => {
      expect(screen.getByText('← Back')).toBeTruthy()
    })

    const backBtn = screen.getByText('← Back')
    await fireEvent.click(backBtn)

    await waitFor(() => {
      const currentDiffs: PrFileDiff[] = []
      prFileDiffs.subscribe((value) => {
        currentDiffs.push(...value)
      })()
      expect(currentDiffs.length).toBe(0)
    })
  })

  it('clears pendingManualComments when back button is clicked', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewComments).mockResolvedValue([])

    render(PrReviewView)

    selectedReviewPr.set(basePr)
    pendingManualComments.set([
      { path: 'test.ts', line: 10, side: 'RIGHT', body: 'comment' },
    ])

    await waitFor(() => {
      expect(screen.getByText('← Back')).toBeTruthy()
    })

    const backBtn = screen.getByText('← Back')
    await fireEvent.click(backBtn)

    await waitFor(() => {
      const currentComments: ReviewSubmissionComment[] = []
      pendingManualComments.subscribe((value) => {
        currentComments.push(...value)
      })()
      expect(currentComments.length).toBe(0)
    })
  })

  it('calls markReviewPrViewed when a PR is selected', async () => {
    const mockMarkViewed = vi.mocked(markReviewPrViewed).mockResolvedValue(undefined)
    vi.mocked(getReviewPrs).mockResolvedValue([basePr])
    vi.mocked(getPrFileDiffs).mockResolvedValue([])
    vi.mocked(getReviewComments).mockResolvedValue([])

    reviewPrs.set([basePr])

    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByText('Fix authentication middleware')).toBeTruthy()
    })

    const prCard = screen.getByText('Fix authentication middleware')
    await fireEvent.click(prCard)

    await waitFor(() => {
      expect(mockMarkViewed).toHaveBeenCalledWith(basePr.id, basePr.head_sha)
    })
  })

  it('sets reviewRequestCount to unviewed count, not total', async () => {
    const viewedPr = { ...basePr, id: 67890, number: 43, viewed_at: 1234567890, viewed_head_sha: 'abc123' }
    vi.mocked(getReviewPrs).mockResolvedValue([basePr, viewedPr])

    render(PrReviewView)

    await waitFor(() => {
      expect(get(reviewRequestCount)).toBe(1)
    })
  })

  it('counts merge-conflicted authored PRs as needing attention', async () => {
    const conflictedAuthoredPr: AuthoredPullRequest = {
      id: 99999,
      number: 100,
      title: 'Conflicted feature branch',
      body: null,
      state: 'open',
      draft: false,
      html_url: 'https://github.com/acme/repo/pull/100',
      user_login: 'me',
      user_avatar_url: null,
      repo_owner: 'acme',
      repo_name: 'repo',
      head_ref: 'feature/conflict',
      base_ref: 'main',
      head_sha: 'def456',
      additions: 20,
      deletions: 5,
      changed_files: 2,
      ci_status: 'success',
      ci_check_runs: null,
      review_status: 'approved',
      mergeable: false,
      mergeable_state: 'dirty',
      merged_at: null,
      is_queued: false,
      task_id: null,
      created_at: Math.floor(Date.now() / 1000) - 3600,
      updated_at: Math.floor(Date.now() / 1000),
    }

    vi.mocked(getReviewPrs).mockResolvedValue([])
    vi.mocked(getAuthoredPrs).mockResolvedValue([conflictedAuthoredPr])

    render(PrReviewView)

    await waitFor(() => {
      expect(get(authoredPrCount)).toBe(1)
    })
  })

  it('shows My Pull Requests section in list mode', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([])
    vi.mocked(getAuthoredPrs).mockResolvedValue([])

    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByText('My Pull Requests')).toBeTruthy()
    })
  })

  it('shows authored PR cards when authoredPrs store has data', async () => {
   const authoredPr: AuthoredPullRequest = {
       id: 99999,
       number: 100,
       title: 'Add new feature',
       body: null,
       state: 'open',
       draft: false,
       html_url: 'https://github.com/acme/repo/pull/100',
       user_login: 'me',
       user_avatar_url: null,
       repo_owner: 'acme',
       repo_name: 'repo',
       head_ref: 'feature/new',
       base_ref: 'main',
       head_sha: 'def456',
       additions: 20,
       deletions: 5,
       changed_files: 2,
        ci_status: 'success',
        ci_check_runs: null,
        review_status: 'approved',
        mergeable: null,
        mergeable_state: null,
        merged_at: null,
       is_queued: false,
       task_id: null,
       created_at: Math.floor(Date.now() / 1000) - 3600,
       updated_at: Math.floor(Date.now() / 1000),
     }

    vi.mocked(getReviewPrs).mockResolvedValue([])
    vi.mocked(getAuthoredPrs).mockResolvedValue([authoredPr])
    authoredPrs.set([authoredPr])

    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByText('Add new feature')).toBeTruthy()
    })
  })

  it('shows authored PR empty state when no authored PRs', async () => {
    vi.mocked(getReviewPrs).mockResolvedValue([])
    vi.mocked(getAuthoredPrs).mockResolvedValue([])

    render(PrReviewView)

    await waitFor(() => {
      expect(screen.getByText('No open pull requests')).toBeTruthy()
    })
  })

  describe('repository filtering', () => {
    const prRepo1 = { ...basePr, id: 1, number: 1, title: 'PR in repo1', repo_owner: 'acme', repo_name: 'repo1' }
    const prRepo2 = { ...basePr, id: 2, number: 2, title: 'PR in repo2', repo_owner: 'acme', repo_name: 'repo2' }
    const prRepo3 = { ...basePr, id: 3, number: 3, title: 'PR in repo3', repo_owner: 'other', repo_name: 'repo3' }

      const authoredRepo1: AuthoredPullRequest = {
        ...basePr, id: 10, number: 10, title: 'My PR in repo1',
        repo_owner: 'acme', repo_name: 'repo1',
        ci_status: 'success', ci_check_runs: null, review_status: 'approved', mergeable: null, mergeable_state: null,
        merged_at: null, is_queued: false, task_id: null,
      }
      const authoredRepo2: AuthoredPullRequest = {
        ...basePr, id: 11, number: 11, title: 'My PR in repo2',
        repo_owner: 'acme', repo_name: 'repo2',
        ci_status: 'success', ci_check_runs: null, review_status: 'approved', mergeable: null, mergeable_state: null,
        merged_at: null, is_queued: false, task_id: null,
      }

    it('hides review PRs from excluded repos', async () => {
      vi.mocked(getProjectConfig).mockImplementation(async (_pid: string, key: string) => {
        if (key === 'pr_excluded_repos') return JSON.stringify(['acme/repo2'])
        return null
      })
      vi.mocked(getReviewPrs).mockResolvedValue([prRepo1, prRepo2, prRepo3])
      vi.mocked(getAuthoredPrs).mockResolvedValue([])
      activeProjectId.set('P-1')
      reviewPrs.set([prRepo1, prRepo2, prRepo3])

      render(PrReviewView)

      await waitFor(() => {
        expect(screen.getByText('PR in repo1')).toBeTruthy()
        expect(screen.getByText('PR in repo3')).toBeTruthy()
        expect(screen.queryByText('PR in repo2')).toBeNull()
      })
    })

    it('hides authored PRs from excluded repos', async () => {
      vi.mocked(getProjectConfig).mockImplementation(async (_pid: string, key: string) => {
        if (key === 'pr_excluded_repos') return JSON.stringify(['acme/repo1'])
        return null
      })
      vi.mocked(getReviewPrs).mockResolvedValue([])
      vi.mocked(getAuthoredPrs).mockResolvedValue([authoredRepo1, authoredRepo2])
      activeProjectId.set('P-1')
      authoredPrs.set([authoredRepo1, authoredRepo2])

      render(PrReviewView)

      await waitFor(() => {
        expect(screen.getByText('My PR in repo2')).toBeTruthy()
        expect(screen.queryByText('My PR in repo1')).toBeNull()
      })
    })

    it('shows all PRs when no repos are excluded', async () => {
      vi.mocked(getProjectConfig).mockResolvedValue(null)
      vi.mocked(getReviewPrs).mockResolvedValue([prRepo1, prRepo2])
      vi.mocked(getAuthoredPrs).mockResolvedValue([])
      activeProjectId.set('P-1')
      reviewPrs.set([prRepo1, prRepo2])

      render(PrReviewView)

      await waitFor(() => {
        expect(screen.getByText('PR in repo1')).toBeTruthy()
        expect(screen.getByText('PR in repo2')).toBeTruthy()
      })
    })

    it('shows all PRs when no project is active', async () => {
      vi.mocked(getProjectConfig).mockResolvedValue(null)
      vi.mocked(getReviewPrs).mockResolvedValue([prRepo1, prRepo2])
      vi.mocked(getAuthoredPrs).mockResolvedValue([])
      activeProjectId.set(null)
      reviewPrs.set([prRepo1, prRepo2])

      render(PrReviewView)

      await waitFor(() => {
        expect(screen.getByText('PR in repo1')).toBeTruthy()
        expect(screen.getByText('PR in repo2')).toBeTruthy()
      })
    })

    it('shows filter button in the PR list header', async () => {
      vi.mocked(getReviewPrs).mockResolvedValue([])
      vi.mocked(getAuthoredPrs).mockResolvedValue([])
      activeProjectId.set('P-1')

      render(PrReviewView)

      await waitFor(() => {
        expect(screen.getByTitle('Filter repositories')).toBeTruthy()
      })
    })

    it('persists excluded repos via setProjectConfig when using quick-add', async () => {
      const mockSetConfig = vi.mocked(setProjectConfig).mockResolvedValue(undefined)
      vi.mocked(getProjectConfig).mockResolvedValue(null)
      vi.mocked(getReviewPrs).mockResolvedValue([prRepo1, prRepo2])
      vi.mocked(getAuthoredPrs).mockResolvedValue([])
      activeProjectId.set('P-1')
      reviewPrs.set([prRepo1, prRepo2])

      render(PrReviewView)

      await waitFor(() => {
        expect(screen.getByTitle('Filter repositories')).toBeTruthy()
      })

      // Open filter dropdown
      await fireEvent.click(screen.getByTitle('Filter repositories'))

      await waitFor(() => {
        // Should show quick-add suggestions for repos from open PRs
        expect(screen.getByText('+ acme/repo1')).toBeTruthy()
        expect(screen.getByText('+ acme/repo2')).toBeTruthy()
      })

      // Click quick-add button for repo2
      await fireEvent.click(screen.getByText('+ acme/repo2'))

      await waitFor(() => {
        expect(mockSetConfig).toHaveBeenCalledWith('P-1', 'pr_excluded_repos', JSON.stringify(['acme/repo2']))
      })
    })

    it('allows manually adding a repo via text input', async () => {
      const mockSetConfig = vi.mocked(setProjectConfig).mockResolvedValue(undefined)
      vi.mocked(getProjectConfig).mockResolvedValue(null)
      vi.mocked(getReviewPrs).mockResolvedValue([])
      vi.mocked(getAuthoredPrs).mockResolvedValue([])
      activeProjectId.set('P-1')

      render(PrReviewView)

      // Open filter dropdown
      await fireEvent.click(screen.getByTitle('Filter repositories'))

      await waitFor(() => {
        expect(screen.getByPlaceholderText('owner/repo')).toBeTruthy()
      })

      // Type a repo name and submit
      const input = screen.getByPlaceholderText('owner/repo')
      await fireEvent.input(input, { target: { value: 'org/secret-repo' } })
      await fireEvent.submit(requireElement(input.closest('form'), HTMLFormElement))

      await waitFor(() => {
        expect(mockSetConfig).toHaveBeenCalledWith('P-1', 'pr_excluded_repos', JSON.stringify(['org/secret-repo']))
      })
    })

    it('shows excluded repos with remove buttons', async () => {
      vi.mocked(getProjectConfig).mockImplementation(async (_pid: string, key: string) => {
        if (key === 'pr_excluded_repos') return JSON.stringify(['acme/repo2', 'org/hidden'])
        return null
      })
      vi.mocked(getReviewPrs).mockResolvedValue([])
      vi.mocked(getAuthoredPrs).mockResolvedValue([])
      activeProjectId.set('P-1')

      render(PrReviewView)

      // Open filter dropdown
      await fireEvent.click(screen.getByTitle('Filter repositories'))

      await waitFor(() => {
        expect(screen.getByText('acme/repo2')).toBeTruthy()
        expect(screen.getByText('org/hidden')).toBeTruthy()
      })
    })

    it('updates review request count excluding filtered repos', async () => {
      vi.mocked(getProjectConfig).mockImplementation(async (_pid: string, key: string) => {
        if (key === 'pr_excluded_repos') return JSON.stringify(['acme/repo2'])
        return null
      })
      const unviewedPr1 = { ...prRepo1, viewed_at: null }
      const unviewedPr2 = { ...prRepo2, viewed_at: null }
      vi.mocked(getReviewPrs).mockResolvedValue([unviewedPr1, unviewedPr2])
      vi.mocked(getAuthoredPrs).mockResolvedValue([])
      activeProjectId.set('P-1')

      render(PrReviewView)

      await waitFor(() => {
        // Only 1 unviewed PR should be counted (repo2 is excluded)
        expect(get(reviewRequestCount)).toBe(1)
      })
    })
  })

  describe('background sync events', () => {
    function getListenCallback(eventName: string): ((event?: unknown) => void) | undefined {
      const calls = vi.mocked(listen).mock.calls
      const match = calls.find(([name]) => name === eventName)
      return match ? (match[1] as (event?: unknown) => void) : undefined
    }

    it('review-pr-count-changed updates store without showing loading state', async () => {
      const updatedPr = { ...basePr, title: 'Updated PR title' }
      vi.mocked(getReviewPrs).mockResolvedValue([basePr])
      vi.mocked(getAuthoredPrs).mockResolvedValue([])

      render(PrReviewView)

      // Wait for initial load to complete
      await waitFor(() => {
        reviewPrs.set([basePr])
        expect(screen.getByText('Fix authentication middleware')).toBeTruthy()
      })
      vi.mocked(getReviewPrs).mockClear()

      // Simulate background sync returning updated data
      vi.mocked(getReviewPrs).mockResolvedValue([updatedPr])

      const callback = getListenCallback('review-pr-count-changed')
      expect(callback).toBeDefined()
      requireDefined(callback)()

      // Store should update without the loading spinner ever appearing
      await waitFor(() => {
        expect(vi.mocked(getReviewPrs)).toHaveBeenCalled()
      })

      // Loading spinner should NOT have appeared (no "Loading PRs..." text)
      expect(screen.queryByText('Loading PRs...')).toBeNull()
    })

    it('authored-prs-updated updates store without showing loading state', async () => {
      vi.mocked(getReviewPrs).mockResolvedValue([])
      vi.mocked(getAuthoredPrs).mockResolvedValue([])

      render(PrReviewView)

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByText('Review Requests')).toBeTruthy()
      })
      vi.mocked(getAuthoredPrs).mockClear()

      // Simulate background sync
      vi.mocked(getAuthoredPrs).mockResolvedValue([])

      const callback = getListenCallback('authored-prs-updated')
      expect(callback).toBeDefined()
      requireDefined(callback)()

      await waitFor(() => {
        expect(vi.mocked(getAuthoredPrs)).toHaveBeenCalled()
      })

      // Loading spinner should NOT have appeared
      expect(screen.queryByText('Loading PRs...')).toBeNull()
    })

    it('review-pr-count-changed does not disrupt detail view', async () => {
      vi.mocked(getReviewPrs).mockResolvedValue([basePr])
      vi.mocked(getAuthoredPrs).mockResolvedValue([])
      vi.mocked(getPrFileDiffs).mockResolvedValue([])
      vi.mocked(getReviewComments).mockResolvedValue([])

      render(PrReviewView)

      // Select a PR to enter detail view
      reviewPrs.set([basePr])
      selectedReviewPr.set(basePr)

      await waitFor(() => {
        expect(screen.getByText('← Back')).toBeTruthy()
      })
      vi.mocked(getReviewPrs).mockClear()

      // Simulate background sync while in detail view
      vi.mocked(getReviewPrs).mockResolvedValue([basePr])

      const callback = getListenCallback('review-pr-count-changed')
      expect(callback).toBeDefined()
      requireDefined(callback)()

      await waitFor(() => {
        expect(vi.mocked(getReviewPrs)).toHaveBeenCalled()
      })

      // Detail view should still be shown, NOT disrupted by loading state
      expect(screen.getByText('← Back')).toBeTruthy()
      expect(screen.getByText('Fix authentication middleware')).toBeTruthy()
      expect(screen.queryByText('Loading diffs...')).toBeNull()
    })
  })

})
