import { render } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import type { AuthoredPullRequest, Project, Task } from './lib/types'
import { requireDefined } from './test-utils/dom'
import { callOrder, eventListeners, installAppTestLifecycle } from './App.test-harness'

async function withSuppressedExpectedConsoleError(run: () => Promise<void>) {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await run()
  } finally {
    consoleErrorSpy.mockRestore()
  }
}

describe('App startup data loading', () => {
  installAppTestLifecycle()
  it('still loads projects when builtin plugin persistence fails', async () => {
    await withSuppressedExpectedConsoleError(async () => {
      const { installPlugin, getProjects } = await import('./lib/ipc')
      const stores = await import('./lib/stores')

      vi.mocked(installPlugin).mockRejectedValueOnce(new Error('Failed to install plugin: no such table: plugins'))

      const App = (await import('./App.svelte')).default
      render(App)

      await vi.waitFor(() => {
        expect(getProjects).toHaveBeenCalled()
        expect(get(stores.projects)).toEqual([{ id: 'proj-1', name: 'Test Project', path: '/test' }])
      })
    })
  })

  it('initializes reviewRequestCount from DB on startup', async () => {
    const { getReviewPrs } = await import('./lib/ipc')
    const stores = await import('./lib/stores')
    const { get } = await import('svelte/store')

    vi.mocked(getReviewPrs).mockResolvedValue([
      { id: 1, number: 10, title: 'PR 1', body: null, state: 'open', draft: false, html_url: 'https://github.com/o/r/pull/10', user_login: 'u1', user_avatar_url: null, repo_owner: 'o', repo_name: 'r', head_ref: 'b1', base_ref: 'main', head_sha: 'sha1', additions: 0, deletions: 0, changed_files: 0, created_at: 1000, updated_at: 1000, viewed_at: null, viewed_head_sha: null },
      { id: 2, number: 20, title: 'PR 2', body: null, state: 'open', draft: false, html_url: 'https://github.com/o/r/pull/20', user_login: 'u2', user_avatar_url: null, repo_owner: 'o', repo_name: 'r', head_ref: 'b2', base_ref: 'main', head_sha: 'sha2', additions: 0, deletions: 0, changed_files: 0, created_at: 2000, updated_at: 2000, viewed_at: 1234567890, viewed_head_sha: 'sha2' },
      { id: 3, number: 30, title: 'PR 3', body: null, state: 'open', draft: false, html_url: 'https://github.com/o/r/pull/30', user_login: 'u3', user_avatar_url: null, repo_owner: 'o', repo_name: 'r', head_ref: 'b3', base_ref: 'main', head_sha: 'sha3', additions: 0, deletions: 0, changed_files: 0, created_at: 3000, updated_at: 3000, viewed_at: null, viewed_head_sha: null },
    ] as any)

    const App = (await import('./App.svelte')).default
    render(App)

    await vi.waitFor(() => {
      expect(getReviewPrs).toHaveBeenCalled()
    })

    // 2 out of 3 PRs are unviewed (viewed_at === null)
    expect(get(stores.reviewRequestCount)).toBe(2)
  }, 15000)

  it('reviewRequestCount respects repo exclusion filter', async () => {
    const { getReviewPrs, getProjectConfig, getAuthoredPrs } = await import('./lib/ipc')
    const stores = await import('./lib/stores')
    const { get } = await import('svelte/store')

    // PRs from two different repos, all unviewed
    vi.mocked(getReviewPrs).mockResolvedValue([
      { id: 1, number: 10, title: 'PR 1', body: null, state: 'open', draft: false, html_url: 'https://github.com/o/r/pull/10', user_login: 'u1', user_avatar_url: null, repo_owner: 'o', repo_name: 'r', head_ref: 'b1', base_ref: 'main', head_sha: 'sha1', additions: 0, deletions: 0, changed_files: 0, created_at: 1000, updated_at: 1000, viewed_at: null, viewed_head_sha: null },
      { id: 2, number: 20, title: 'PR 2', body: null, state: 'open', draft: false, html_url: 'https://github.com/x/y/pull/20', user_login: 'u2', user_avatar_url: null, repo_owner: 'x', repo_name: 'y', head_ref: 'b2', base_ref: 'main', head_sha: 'sha2', additions: 0, deletions: 0, changed_files: 0, created_at: 2000, updated_at: 2000, viewed_at: null, viewed_head_sha: null },
      { id: 3, number: 30, title: 'PR 3', body: null, state: 'open', draft: false, html_url: 'https://github.com/o/r/pull/30', user_login: 'u3', user_avatar_url: null, repo_owner: 'o', repo_name: 'r', head_ref: 'b3', base_ref: 'main', head_sha: 'sha3', additions: 0, deletions: 0, changed_files: 0, created_at: 3000, updated_at: 3000, viewed_at: null, viewed_head_sha: null },
    ] as any)
    vi.mocked(getAuthoredPrs).mockResolvedValue([])

    // Exclude repo x/y
    vi.mocked(getProjectConfig).mockImplementation(async (_projectId: string, key: string) => {
      if (key === 'pr_excluded_repos') return JSON.stringify(['x/y'])
      return null
    })

    const App = (await import('./App.svelte')).default
    render(App)

    await vi.waitFor(() => {
      expect(getReviewPrs).toHaveBeenCalled()
    })

    // 3 PRs unviewed, but x/y is excluded → only 2 from o/r count
    expect(get(stores.reviewRequestCount)).toBe(2)
  }, 15000)

  it('initializes authoredPrCount with merge-conflicted PRs on startup', async () => {
    const { getAuthoredPrs } = await import('./lib/ipc')
    const stores = await import('./lib/stores')
    const { get } = await import('svelte/store')

    const conflictedPr: AuthoredPullRequest = {
      id: 10,
      number: 10,
      title: 'Conflicted PR',
      body: null,
      state: 'open',
      draft: false,
      html_url: 'https://github.com/o/r/pull/10',
      user_login: 'u1',
      user_avatar_url: null,
      repo_owner: 'o',
      repo_name: 'r',
      head_ref: 'feature/conflict',
      base_ref: 'main',
      head_sha: 'sha10',
      additions: 1,
      deletions: 1,
      changed_files: 1,
      ci_status: 'success',
      ci_check_runs: null,
      review_status: 'approved',
      mergeable: false,
      mergeable_state: 'dirty',
      merged_at: null,
      is_queued: false,
      task_id: null,
      created_at: 1000,
      updated_at: 1000,
    }

    vi.mocked(getAuthoredPrs).mockResolvedValue([conflictedPr])

    const App = (await import('./App.svelte')).default
    render(App)

    await vi.waitFor(() => {
      expect(get(stores.authoredPrCount)).toBe(1)
    })
  }, 15000)

  it('refreshes authoredPrCount when authored-prs-updated fires', async () => {
    const { getAuthoredPrs } = await import('./lib/ipc')
    const stores = await import('./lib/stores')
    const { get } = await import('svelte/store')

    const conflictedPr: AuthoredPullRequest = {
      id: 10,
      number: 10,
      title: 'Conflicted PR',
      body: null,
      state: 'open',
      draft: false,
      html_url: 'https://github.com/o/r/pull/10',
      user_login: 'u1',
      user_avatar_url: null,
      repo_owner: 'o',
      repo_name: 'r',
      head_ref: 'feature/conflict',
      base_ref: 'main',
      head_sha: 'sha10',
      additions: 1,
      deletions: 1,
      changed_files: 1,
      ci_status: 'success',
      ci_check_runs: null,
      review_status: 'approved',
      mergeable: false,
      mergeable_state: 'dirty',
      merged_at: null,
      is_queued: false,
      task_id: null,
      created_at: 1000,
      updated_at: 1000,
    }

    vi.mocked(getAuthoredPrs)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([conflictedPr])

    const App = (await import('./App.svelte')).default
    render(App)

    await vi.waitFor(() => {
      expect(eventListeners.has('authored-prs-updated')).toBe(true)
      expect(getAuthoredPrs).toHaveBeenCalledTimes(1)
    })

    expect(get(stores.authoredPrCount)).toBe(0)

    const callback = requireDefined(
      eventListeners.get('authored-prs-updated'),
      'Expected authored-prs-updated listener to be registered',
    )
    await callback({ payload: undefined })

    await vi.waitFor(() => {
      expect(get(stores.authoredPrCount)).toBe(1)
    })
  }, 15000)

  it('registers event listeners before making IPC data-loading calls', async () => {
    const App = (await import('./App.svelte')).default

    render(App)

    await vi.waitFor(() => {
      expect(callOrder).toContain('listen')
      expect(callOrder).toContain('getProjects')
      expect(callOrder).toContain('getAppMode')
    })

    const firstListen = callOrder.indexOf('listen')
    const firstResumeStartupSessions = callOrder.indexOf('resumeStartupSessions')
    const firstGetProjects = callOrder.indexOf('getProjects')
    const firstGetAppMode = callOrder.indexOf('getAppMode')

    expect(firstListen).toBeLessThan(firstResumeStartupSessions)
    expect(firstResumeStartupSessions).toBeLessThan(firstGetProjects)
    expect(firstListen).toBeLessThan(firstGetAppMode)
  }, 15000)

  describe('selected task clearing', () => {
    it('clears selectedTaskId when the selected task disappears', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const selectedTask: Task = {
        id: 'task-123',
        initial_prompt: 'Selected task',
        prompt: null,
        summary: null,
        status: 'doing',
        agent: null,
        permission_mode: null,
        depends_on: [],
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)

      render(App)

      stores.tasks.set([])

      await vi.waitFor(() => {
        expect(get(stores.selectedTaskId)).toBeNull()
      })
    })

    it('keeps selectedTaskId when the selected task is still present', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const selectedTask: Task = {
        id: 'task-456',
        initial_prompt: 'Selected task',
        prompt: null,
        summary: null,
        status: 'doing',
        agent: null,
        permission_mode: null,
        depends_on: [],
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.selectedTaskId)).toBe(selectedTask.id)
      })
    })

    it('keeps selectedTaskId when the selected task is pending', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const pendingTask: Task = {
        id: 'task-pending',
        initial_prompt: 'Pending task',
        prompt: null,
        summary: null,
        status: 'backlog',
        agent: null,
        permission_mode: null,
        depends_on: [],
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      stores.tasks.set([])
      stores.pendingTask.set(pendingTask)
      stores.selectedTaskId.set(pendingTask.id)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.selectedTaskId)).toBe(pendingTask.id)
      })
    })

    it('loads projects and respects saved order', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      const projectList: Project[] = [
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
        { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
      ]
      vi.mocked(ipc.getProjects).mockResolvedValue(projectList)
      vi.mocked(ipc.getConfig).mockImplementation(async (key) => key === 'project_sidebar_order' ? JSON.stringify(['proj-2', 'proj-1']) : null)

      render(App)
      await vi.waitFor(() => {
        expect(get(stores.projects).map(p => p.id)).toEqual(['proj-2', 'proj-1'])
      })
    })

    it('loads projects even when reading saved order fails', async () => {
      await withSuppressedExpectedConsoleError(async () => {
        const App = (await import('./App.svelte')).default
        const stores = await import('./lib/stores')
        const ipc = await import('./lib/ipc')
        const { get } = await import('svelte/store')

        const projectList: Project[] = [
          { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
          { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
        ]
        vi.mocked(ipc.getProjects).mockResolvedValue(projectList)
        vi.mocked(ipc.getConfig).mockReset()
        vi.mocked(ipc.getConfig).mockRejectedValueOnce(new Error('config unavailable'))

        render(App)

        await vi.waitFor(() => {
          expect(get(stores.projects).map((project) => project.id)).toEqual(['proj-1', 'proj-2'])
        })
      })
    })
  })

})
