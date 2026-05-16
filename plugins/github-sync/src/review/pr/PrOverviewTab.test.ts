import { render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge/plugin-sdk/frontend'
import type { ReviewPullRequest } from '@openforge/plugin-sdk/domain'
import { prOverviewComments } from '../../lib/stores'
import PrOverviewTab from './PrOverviewTab.svelte'

const basePr: ReviewPullRequest = {
  id: 12345,
  number: 42,
  title: 'Fix markdown images',
  body: 'Here is the diagram:\n\n![Architecture](docs/architecture.png)',
  state: 'open',
  draft: false,
  html_url: 'https://github.com/acme/repo/pull/42',
  user_login: 'alice',
  user_avatar_url: null,
  repo_owner: 'acme',
  repo_name: 'repo',
  head_ref: 'feature/markdown-images',
  base_ref: 'main',
  head_sha: 'abc123def456',
  additions: 12,
  deletions: 3,
  changed_files: 2,
  mergeable: null,
  mergeable_state: null,
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
  viewed_at: null,
  viewed_head_sha: null,
}

const api = {
  commands: { invokeGlobal: vi.fn(async (command: string) => command === 'openforge.getPrOverviewComments' ? [] : null) },
  system: { openUrl: vi.fn() },
} as unknown as FrontendOpenForgeAPI

const context: OpenForgeContextSnapshot = {
  pluginId: 'com.openforge.github-sync',
  projectId: 'project-1',
}

describe('GitHub sync PrOverviewTab', () => {
  beforeEach(() => {
    prOverviewComments.set([])
    vi.clearAllMocks()
    vi.mocked(api.commands.invokeGlobal).mockImplementation(async (command: string) => command === 'openforge.getPrOverviewComments' ? [] : null)
  })

  it('renders PR body relative markdown images from the pull request head commit', async () => {
    render(PrOverviewTab, { props: { api, context, pr: basePr } })

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Architecture' })).toBeTruthy()
    })

    const image = screen.getByRole('img', { name: 'Architecture' })
    expect(image.getAttribute('src')).toBe('https://raw.githubusercontent.com/acme/repo/abc123def456/docs/architecture.png')
  })
})
