import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { authoredPrs } from '../lib/stores'
import type { AuthoredPullRequest } from '../lib/types'

vi.mock('../lib/ipc', () => ({
  getAuthoredPrs: vi.fn().mockResolvedValue([]),
  fetchAuthoredPrs: vi.fn().mockResolvedValue([]),
  openUrl: vi.fn(),
}))

const makePr = (overrides: Partial<AuthoredPullRequest> = {}): AuthoredPullRequest => ({
  id: 1,
  number: 1,
  title: 'Test PR',
  body: null,
  state: 'open',
  draft: false,
  html_url: 'https://github.com/owner/repo/pull/1',
  user_login: 'user',
  user_avatar_url: null,
  repo_owner: 'owner',
  repo_name: 'repo',
  head_ref: 'feature/test',
  base_ref: 'main',
  head_sha: 'abc123',
  additions: 10,
  deletions: 5,
  changed_files: 2,
  ci_status: null,
  ci_check_runs: null,
  review_status: null,
  merged_at: null,
  task_id: null,
  created_at: Math.floor(Date.now() / 1000) - 3600,
  updated_at: Math.floor(Date.now() / 1000),
  ...overrides,
})

describe('MyPullRequestsView', () => {
  beforeEach(() => {
    authoredPrs.set([])
  })

  it('shows loading spinner when no PRs and loading', async () => {
    const { default: MyPullRequestsView } = await import('./MyPullRequestsView.svelte')
    render(MyPullRequestsView)
    expect(screen.getByText('Loading PRs...')).toBeTruthy()
  })

  it('shows empty state when no PRs', async () => {
    const { getAuthoredPrs } = await import('../lib/ipc')
    ;(getAuthoredPrs as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const { default: MyPullRequestsView } = await import('./MyPullRequestsView.svelte')
    render(MyPullRequestsView)
    await vi.waitFor(() => {
      expect(screen.getByText('No open pull requests')).toBeTruthy()
    })
  })

  it('renders PRs grouped by repo', async () => {
    const prs = [
      makePr({ id: 1, number: 10, title: 'PR One', repo_owner: 'org', repo_name: 'repoA' }),
      makePr({ id: 2, number: 20, title: 'PR Two', repo_owner: 'org', repo_name: 'repoB' }),
    ]
    const { getAuthoredPrs } = await import('../lib/ipc')
    ;(getAuthoredPrs as ReturnType<typeof vi.fn>).mockResolvedValue(prs)
    const { default: MyPullRequestsView } = await import('./MyPullRequestsView.svelte')
    render(MyPullRequestsView)
    await vi.waitFor(() => {
      expect(screen.getAllByText('org/repoA').length).toBeGreaterThan(0)
      expect(screen.getAllByText('org/repoB').length).toBeGreaterThan(0)
    })
  })

  it('shows header with PR count', async () => {
    const prs = [makePr({ id: 1, number: 10, title: 'PR One' })]
    const { getAuthoredPrs } = await import('../lib/ipc')
    ;(getAuthoredPrs as ReturnType<typeof vi.fn>).mockResolvedValue(prs)
    const { default: MyPullRequestsView } = await import('./MyPullRequestsView.svelte')
    render(MyPullRequestsView)
    expect(screen.getByText('My Pull Requests')).toBeTruthy()
  })
})
