import { render, screen, waitFor, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Task, PullRequestInfo, PrComment } from '../lib/types'

vi.mock('../lib/ipc', () => ({
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

import * as ipc from '../lib/ipc'
import TaskDetailPane from './TaskDetailPane.svelte'

const baseTask: Task = {
  id: 'T-748',
  initial_prompt: 'Fix the dashboard bug.',
  summary: 'Applied reactive fix.',
  status: 'doing',
  jira_key: 'KVG-748',
  jira_title: 'Fix Dashboard',
  jira_status: null,
  jira_assignee: null,
  jira_description: null,
  prompt: null,
  agent: null,
  permission_mode: null,
  project_id: 'project-1',
  created_at: 1700000000,
  updated_at: 1700000000,
}

const basePr: PullRequestInfo = {
  id: 101,
  ticket_id: 'T-748',
  repo_owner: 'org',
  repo_name: 'repo',
  title: 'Fix dashboard reactivity',
  url: 'https://github.com/org/repo/pull/101',
  state: 'open',
  head_sha: 'abc123',
  ci_status: 'success',
  ci_check_runs: JSON.stringify([
    { id: 1, name: 'CI / build', status: 'completed', conclusion: 'success', html_url: 'https://github.com/check/1' },
    { id: 2, name: 'CI / test', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/check/2' },
  ]),
  review_status: 'approved',
  mergeable: true,
  mergeable_state: 'clean',
  merged_at: null,
  created_at: 1700000000,
  updated_at: 1700000000,
  draft: false,
  is_queued: false,
  unaddressed_comment_count: 0,
}

function makeComment(overrides: Partial<PrComment> = {}): PrComment {
  return {
    id: 1,
    pr_id: 101,
    author: 'reviewer',
    body: 'Please fix this.',
    comment_type: 'review',
    file_path: 'src/App.svelte',
    line_number: 42,
    addressed: 0,
    created_at: 1700000000,
    ...overrides,
  }
}

describe('TaskDetailPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ipc.getPrComments).mockResolvedValue([])
    vi.mocked(ipc.markCommentAddressed).mockResolvedValue(undefined)
    vi.mocked(ipc.openUrl).mockResolvedValue(undefined)
  })

  describe('empty state', () => {
    it('renders empty state when task is null', () => {
      render(TaskDetailPane, {
        props: {
          task: null,
          session: null,
          pullRequests: [],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.getByText(/select a task/i)).toBeTruthy()
    })

    it('does not render sections when task is null', () => {
      render(TaskDetailPane, {
        props: {
          task: null,
          session: null,
          pullRequests: [],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.queryByText('// INITIAL_PROMPT')).toBeNull()
      expect(screen.queryByText('// SUMMARY')).toBeNull()
    })
  })

  describe('header section', () => {
    it('renders task id in header', () => {
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.getByText('T-748')).toBeTruthy()
    })

    it('renders jira_key badge when present', () => {
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.getByText('KVG-748')).toBeTruthy()
    })

    it('does not render jira_key badge when jira_key is null', () => {
      const taskNoJira = { ...baseTask, jira_key: null }
      render(TaskDetailPane, {
        props: {
          task: taskNoJira,
          session: null,
          pullRequests: [],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.queryByText('KVG-748')).toBeNull()
    })

    it('calls onOpenFullView when "Open full view" button is clicked', async () => {
      const onOpenFullView = vi.fn()
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [],
          onOpenFullView,
        },
      })
      const btn = screen.getByRole('button', { name: /open full view/i })
      await fireEvent.click(btn)
      expect(onOpenFullView).toHaveBeenCalledOnce()
    })
  })

  describe('initial prompt section', () => {
    it('renders // INITIAL_PROMPT label', () => {
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.getByText('// INITIAL_PROMPT')).toBeTruthy()
    })

    it('renders task initial_prompt text', () => {
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.getByText('Fix the dashboard bug.')).toBeTruthy()
    })
  })

  describe('summary section', () => {
    it('renders // SUMMARY label', () => {
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.getByText('// SUMMARY')).toBeTruthy()
    })

    it('renders summary text when present', () => {
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.getByText('Applied reactive fix.')).toBeTruthy()
    })

    it('renders fallback text when summary is null', () => {
      const taskNoSummary = { ...baseTask, summary: null }
      render(TaskDetailPane, {
        props: {
          task: taskNoSummary,
          session: null,
          pullRequests: [],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.getByText(/no summary yet/i)).toBeTruthy()
    })
  })

  describe('pull requests section', () => {
    it('renders // PULL_REQUESTS label when PRs are provided', () => {
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [basePr],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.getByText('// PULL_REQUESTS')).toBeTruthy()
    })

    it('renders PR title', () => {
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [basePr],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.getAllByText('Fix dashboard reactivity').length).toBeGreaterThanOrEqual(1)
    })

    it('renders PR state badge', () => {
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [basePr],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.getByText('open')).toBeTruthy()
    })

    it('calls openUrl when PR URL button is clicked', async () => {
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [basePr],
          onOpenFullView: vi.fn(),
        },
      })
      const urlBtn = screen.getByText('https://github.com/org/repo/pull/101')
      await fireEvent.click(urlBtn)
      expect(ipc.openUrl).toHaveBeenCalledWith('https://github.com/org/repo/pull/101')
    })
  })

  describe('pipeline status section', () => {
    it('renders // PIPELINE_STATUS label when PR has ci_status', () => {
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [basePr],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.getByText('// PIPELINE_STATUS')).toBeTruthy()
    })

    it('renders only failing check runs and a passing summary', () => {
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [basePr],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.queryByText('CI / build')).toBeNull()
      expect(screen.getByText('CI / test')).toBeTruthy()
      expect(screen.getByText('1 passing')).toBeTruthy()
    })

    it('renders ci_status badge', () => {
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [basePr],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.getByText(/✓ Passing/)).toBeTruthy()
    })

    it('does not render pipeline section when no PR has ci_status', () => {
      const prNoCi = { ...basePr, ci_status: null, ci_check_runs: null }
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [prNoCi],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.queryByText('// PIPELINE_STATUS')).toBeNull()
    })
  })

  describe('PR comments section', () => {
    it('renders // PR_COMMENTS label when task is provided', () => {
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [basePr],
          onOpenFullView: vi.fn(),
        },
      })
      expect(screen.getByText('// PR_COMMENTS')).toBeTruthy()
    })

    it('fetches comments on mount for each PR', async () => {
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [basePr],
          onOpenFullView: vi.fn(),
        },
      })
      await waitFor(() => {
        expect(ipc.getPrComments).toHaveBeenCalledWith(101)
      })
    })

    it('renders comment author and body when comments returned', async () => {
      const comment = makeComment()
      vi.mocked(ipc.getPrComments).mockResolvedValue([comment])
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [basePr],
          onOpenFullView: vi.fn(),
        },
      })
      await waitFor(() => {
        expect(screen.getByText('reviewer')).toBeTruthy()
        expect(screen.getByText('Please fix this.')).toBeTruthy()
      })
    })

    it('renders "Mark addressed" button for each unaddressed comment', async () => {
      const comment = makeComment({ addressed: 0 })
      vi.mocked(ipc.getPrComments).mockResolvedValue([comment])
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [basePr],
          onOpenFullView: vi.fn(),
        },
      })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /mark addressed/i })).toBeTruthy()
      })
    })

    it('calls markCommentAddressed when "Mark addressed" is clicked', async () => {
      const comment = makeComment({ id: 42 })
      vi.mocked(ipc.getPrComments).mockResolvedValue([comment])
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [basePr],
          onOpenFullView: vi.fn(),
        },
      })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /mark addressed/i })).toBeTruthy()
      })
      await fireEvent.click(screen.getByRole('button', { name: /mark addressed/i }))
      await waitFor(() => {
        expect(ipc.markCommentAddressed).toHaveBeenCalledWith(42)
      })
    })

    it('re-fetches comments after marking addressed', async () => {
      const comment = makeComment({ id: 42 })
      vi.mocked(ipc.getPrComments).mockResolvedValue([comment])
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [basePr],
          onOpenFullView: vi.fn(),
        },
      })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /mark addressed/i })).toBeTruthy()
      })
      await fireEvent.click(screen.getByRole('button', { name: /mark addressed/i }))
      await waitFor(() => {
        expect(ipc.getPrComments).toHaveBeenCalledTimes(2)
      })
    })

    it('hides addressed comments from display entirely', async () => {
      const comment = makeComment({ addressed: 1 })
      vi.mocked(ipc.getPrComments).mockResolvedValue([comment])
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [basePr],
          onOpenFullView: vi.fn(),
        },
      })
      await waitFor(() => {
        expect(ipc.getPrComments).toHaveBeenCalled()
      })
      expect(screen.queryByText('reviewer')).toBeNull()
      expect(screen.queryByText('Please fix this.')).toBeNull()
    })

    it('shows only unaddressed comments when both types exist', async () => {
      const unaddressed = makeComment({ id: 1, body: 'Fix this bug', author: 'alice', addressed: 0 })
      const addressed = makeComment({ id: 2, body: 'Old feedback', author: 'bob', addressed: 1 })
      vi.mocked(ipc.getPrComments).mockResolvedValue([unaddressed, addressed])
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [basePr],
          onOpenFullView: vi.fn(),
        },
      })
      await waitFor(() => {
        expect(screen.getByText('alice')).toBeTruthy()
        expect(screen.getByText('Fix this bug')).toBeTruthy()
      })
      expect(screen.queryByText('bob')).toBeNull()
      expect(screen.queryByText('Old feedback')).toBeNull()
    })

    it('shows comment count badge with only unaddressed count', async () => {
      const comments = [
        makeComment({ id: 1, addressed: 0 }),
        makeComment({ id: 2, addressed: 0 }),
        makeComment({ id: 3, addressed: 1 }),
      ]
      vi.mocked(ipc.getPrComments).mockResolvedValue(comments)
      render(TaskDetailPane, {
        props: {
          task: baseTask,
          session: null,
          pullRequests: [basePr],
          onOpenFullView: vi.fn(),
        },
      })
      await waitFor(() => {
        expect(screen.getByText('2')).toBeTruthy()
      })
      expect(screen.queryByText('3')).toBeNull()
    })
  })
})
