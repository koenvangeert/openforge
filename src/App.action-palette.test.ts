import { fireEvent, render } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PullRequestInfo, Task } from './lib/types'
import { installAppTestLifecycle } from './App.test-harness'

describe('App action palette shortcuts', () => {
  installAppTestLifecycle()
  describe('keyboard shortcuts', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('action palette move-to-done does not navigate directly from App', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')
      const { getTasksForProject } = await import('./lib/ipc')
      const actionPaletteModule = await import('./components/shell/ActionPalette.svelte')

      const selectedTask: Task = {
        id: 'task-123',
        initial_prompt: 'Finish task',
        prompt: null,
        summary: null,
        status: 'doing',
        agent: null,
        permission_mode: null,
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      vi.mocked(getTasksForProject).mockResolvedValue([
        selectedTask,
      ])

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)

      render(App)

      await vi.waitFor(() => {
        expect(getTasksForProject).toHaveBeenCalled()
      })

      await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(actionPaletteModule.default).toHaveBeenCalled()
      })

      const lastCall = vi.mocked(actionPaletteModule.default).mock.calls.at(-1)
      expect(lastCall).toBeTruthy()

      if (!lastCall) {
        throw new Error('Expected ActionPalette to receive props')
      }

      const propsCandidate = lastCall
        .flatMap((arg) => {
          if (typeof arg !== 'object' || arg === null) {
            return []
          }

          if ('props' in arg && typeof arg.props === 'object' && arg.props !== null) {
            return [arg, arg.props]
          }

          return [arg]
        })
        .find((arg): arg is { onExecute: (actionId: string) => Promise<void> } => 'onExecute' in arg && typeof arg.onExecute === 'function')

      if (!propsCandidate) {
        throw new Error('Expected ActionPalette props to include onExecute')
      }

      vi.mocked(nav.resetToBoard).mockClear()

      await propsCandidate.onExecute('move-to-done')

    expect(nav.resetToBoard).not.toHaveBeenCalled()
  })

    it('action palette move-to-done uses the task that was selected when the palette opened', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')
      const { getTasksForProject } = await import('./lib/ipc')
      const { moveTaskToComplete } = await import('./lib/moveToComplete')
      const actionPaletteModule = await import('./components/shell/ActionPalette.svelte')

      const selectedTask: Task = {
        id: 'task-124',
        initial_prompt: 'Finish task after palette opens',
        prompt: null,
        summary: null,
        status: 'doing',
        agent: null,
        permission_mode: null,
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      vi.mocked(getTasksForProject).mockResolvedValue([selectedTask])

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)

      render(App)

      await vi.waitFor(() => {
        expect(getTasksForProject).toHaveBeenCalled()
      })

      await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(actionPaletteModule.default).toHaveBeenCalled()
      })

      const lastCall = vi.mocked(actionPaletteModule.default).mock.calls.at(-1)
      if (!lastCall) throw new Error('Expected ActionPalette to receive props')

      const propsCandidate = lastCall
        .flatMap((arg) => {
          if (typeof arg !== 'object' || arg === null) return []
          if ('props' in arg && typeof arg.props === 'object' && arg.props !== null) return [arg, arg.props]
          return [arg]
        })
        .find((arg): arg is { onExecute: (actionId: string) => Promise<void> } => 'onExecute' in arg && typeof arg.onExecute === 'function')

      if (!propsCandidate) throw new Error('Expected ActionPalette props to include onExecute')

      stores.selectedTaskId.set(null)
      vi.mocked(nav.resetToBoard).mockClear()

      await propsCandidate.onExecute('move-to-done')

      expect(moveTaskToComplete).toHaveBeenCalledWith('task-124')
      expect(nav.resetToBoard).not.toHaveBeenCalled()
    })

    it('action palette move-to-done delegates to moveTaskToComplete', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')
      const { getTasksForProject } = await import('./lib/ipc')
      const { moveTaskToComplete } = await import('./lib/moveToComplete')
      const actionPaletteModule = await import('./components/shell/ActionPalette.svelte')

      const selectedTask: Task = {
        id: 'task-123',
        initial_prompt: 'Finish task',
        prompt: null,
        summary: null,
        status: 'doing',
        agent: null,
        permission_mode: null,
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      vi.mocked(getTasksForProject).mockResolvedValue([selectedTask])

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)

      let resolveMove: (() => void) | undefined
      vi.mocked(moveTaskToComplete).mockImplementationOnce(
        () => new Promise<void>((resolve) => {
          resolveMove = resolve
        }),
      )

      render(App)

      await vi.waitFor(() => {
        expect(getTasksForProject).toHaveBeenCalled()
      })

      await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(actionPaletteModule.default).toHaveBeenCalled()
      })

      const lastCall = vi.mocked(actionPaletteModule.default).mock.calls.at(-1)
      expect(lastCall).toBeTruthy()

      if (!lastCall) {
        throw new Error('Expected ActionPalette to receive props')
      }

      const propsCandidate = lastCall
        .flatMap((arg) => {
          if (typeof arg !== 'object' || arg === null) {
            return []
          }

          if ('props' in arg && typeof arg.props === 'object' && arg.props !== null) {
            return [arg, arg.props]
          }

          return [arg]
        })
        .find((arg): arg is { onExecute: (actionId: string) => Promise<void> } => 'onExecute' in arg && typeof arg.onExecute === 'function')

      if (!propsCandidate) {
        throw new Error('Expected ActionPalette props to include onExecute')
      }

      vi.mocked(nav.resetToBoard).mockClear()

      const execution = propsCandidate.onExecute('move-to-done')

      expect(moveTaskToComplete).toHaveBeenCalledWith('task-123')
      expect(nav.resetToBoard).not.toHaveBeenCalled()

      resolveMove?.()
      await execution
    })

    it('action palette move-to-done awaits moveTaskToComplete', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')
      const { getTasksForProject } = await import('./lib/ipc')
      const { moveTaskToComplete } = await import('./lib/moveToComplete')
      const actionPaletteModule = await import('./components/shell/ActionPalette.svelte')

      const selectedTask: Task = {
        id: 'task-200',
        initial_prompt: 'Order test',
        prompt: null,
        summary: null,
        status: 'doing',
        agent: null,
        permission_mode: null,
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      vi.mocked(getTasksForProject).mockResolvedValue([
        selectedTask,
      ])

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)

      const callOrder: string[] = []
      vi.mocked(nav.resetToBoard).mockImplementation(() => { callOrder.push('resetToBoard') })
      vi.mocked(moveTaskToComplete).mockImplementation(async () => { callOrder.push('moveTaskToComplete') })

      render(App)

      await vi.waitFor(() => {
        expect(getTasksForProject).toHaveBeenCalled()
      })

      await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(actionPaletteModule.default).toHaveBeenCalled()
      })

      const lastCall = vi.mocked(actionPaletteModule.default).mock.calls.at(-1)
      if (!lastCall) throw new Error('Expected ActionPalette to receive props')

      const propsCandidate = lastCall
        .flatMap((arg) => {
          if (typeof arg !== 'object' || arg === null) return []
          if ('props' in arg && typeof arg.props === 'object' && arg.props !== null) return [arg, arg.props]
          return [arg]
        })
        .find((arg): arg is { onExecute: (actionId: string) => Promise<void> } => 'onExecute' in arg && typeof arg.onExecute === 'function')

      if (!propsCandidate) throw new Error('Expected ActionPalette props to include onExecute')

      await propsCandidate.onExecute('move-to-done')

      expect(callOrder).toEqual(['moveTaskToComplete'])

      vi.mocked(nav.resetToBoard).mockReset()
      vi.mocked(moveTaskToComplete).mockReset()
      vi.mocked(moveTaskToComplete).mockResolvedValue(undefined)
    })

    it('action palette merge-pr merges the selected task PR and refreshes GitHub state', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const actionPaletteModule = await import('./components/shell/ActionPalette.svelte')
      const { get } = await import('svelte/store')

      const selectedTask: Task = {
        id: 'task-merge',
        initial_prompt: 'Merge ready PR',
        prompt: null,
        summary: null,
        status: 'doing',
        agent: null,
        permission_mode: null,
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      const readyPr: PullRequestInfo = {
        id: 42,
        ticket_id: selectedTask.id,
        repo_owner: 'owner',
        repo_name: 'repo',
        title: 'Ready PR',
        url: 'https://github.com/owner/repo/pull/42',
        state: 'open',
        head_sha: 'abc123',
        ci_status: 'success',
        ci_check_runs: null,
        review_status: 'approved',
        mergeable: true,
        mergeable_state: 'clean',
        merged_at: null,
        created_at: 1000,
        updated_at: 1000,
        draft: false,
        is_queued: false,
        unaddressed_comment_count: 0,
      }

      vi.mocked(ipc.getTasksForProject).mockResolvedValue([selectedTask])
      vi.mocked(ipc.getPullRequests).mockResolvedValue([readyPr])
      vi.mocked(ipc.mergePullRequest).mockResolvedValue(undefined)
      vi.mocked(ipc.forceGithubSync).mockResolvedValue({
        new_comments: 0,
        ci_changes: 0,
        review_changes: 0,
        pr_changes: 0,
        errors: 0,
        rate_limited: false,
        rate_limit_reset_at: null,
      })

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)
      stores.ticketPrs.set(new Map([[selectedTask.id, [readyPr]]]))

      render(App)

      await vi.waitFor(() => {
        expect(ipc.getTasksForProject).toHaveBeenCalled()
      })

      await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(actionPaletteModule.default).toHaveBeenCalled()
      })

      const lastCall = vi.mocked(actionPaletteModule.default).mock.calls.at(-1)
      if (!lastCall) throw new Error('Expected ActionPalette to receive props')

      const propsCandidate = lastCall
        .flatMap((arg) => {
          if (typeof arg !== 'object' || arg === null) return []
          if ('props' in arg && typeof arg.props === 'object' && arg.props !== null) return [arg, arg.props]
          return [arg]
        })
        .find((arg): arg is { onExecute: (actionId: string) => Promise<void> } => 'onExecute' in arg && typeof arg.onExecute === 'function')

      if (!propsCandidate) throw new Error('Expected ActionPalette props to include onExecute')

      await propsCandidate.onExecute('merge-pr')

      expect(ipc.mergePullRequest).toHaveBeenCalledWith('owner', 'repo', 42)
      expect(ipc.forceGithubSync).toHaveBeenCalled()

      const mergedPr = get(stores.ticketPrs).get(selectedTask.id)?.[0]
      expect(mergedPr?.state).toBe('merged')
      expect(mergedPr?.merged_at).not.toBeNull()
    })

    it('action palette merge-pr marks the task as merging while the merge request is in flight', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const actionPaletteModule = await import('./components/shell/ActionPalette.svelte')
      const { get } = await import('svelte/store')

      const selectedTask: Task = {
        id: 'task-merge-pending',
        initial_prompt: 'Merge pending PR',
        prompt: null,
        summary: null,
        status: 'doing',
        agent: null,
        permission_mode: null,
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      const readyPr: PullRequestInfo = {
        id: 42,
        ticket_id: selectedTask.id,
        repo_owner: 'owner',
        repo_name: 'repo',
        title: 'Ready PR',
        url: 'https://github.com/owner/repo/pull/42',
        state: 'open',
        head_sha: 'abc123',
        ci_status: 'success',
        ci_check_runs: null,
        review_status: 'approved',
        mergeable: true,
        mergeable_state: 'clean',
        merged_at: null,
        created_at: 1000,
        updated_at: 1000,
        draft: false,
        is_queued: false,
        unaddressed_comment_count: 0,
      }

      let resolveMerge!: () => void
      vi.mocked(ipc.getTasksForProject).mockResolvedValue([selectedTask])
      vi.mocked(ipc.getPullRequests).mockResolvedValue([readyPr])
      vi.mocked(ipc.mergePullRequest).mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveMerge = resolve
      }))
      vi.mocked(ipc.forceGithubSync).mockResolvedValue({
        new_comments: 0,
        ci_changes: 0,
        review_changes: 0,
        pr_changes: 0,
        errors: 0,
        rate_limited: false,
        rate_limit_reset_at: null,
      })

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)
      stores.ticketPrs.set(new Map([[selectedTask.id, [readyPr]]]))
      stores.mergingTaskIds.set(new Set())

      render(App)

      await vi.waitFor(() => {
        expect(ipc.getTasksForProject).toHaveBeenCalled()
      })

      await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(actionPaletteModule.default).toHaveBeenCalled()
      })

      const lastCall = vi.mocked(actionPaletteModule.default).mock.calls.at(-1)
      if (!lastCall) throw new Error('Expected ActionPalette to receive props')

      const propsCandidate = lastCall
        .flatMap((arg) => {
          if (typeof arg !== 'object' || arg === null) return []
          if ('props' in arg && typeof arg.props === 'object' && arg.props !== null) return [arg, arg.props]
          return [arg]
        })
        .find((arg): arg is { onExecute: (actionId: string) => Promise<void> } => 'onExecute' in arg && typeof arg.onExecute === 'function')

      if (!propsCandidate) throw new Error('Expected ActionPalette props to include onExecute')

      const execution = propsCandidate.onExecute('merge-pr')

      await vi.waitFor(() => {
        expect(get(stores.mergingTaskIds).has(selectedTask.id)).toBe(true)
      })

      resolveMerge()
      await execution

      expect(get(stores.mergingTaskIds).has(selectedTask.id)).toBe(false)
    })

    it('action palette merge-pr does not merge when multiple PRs are ready', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const actionPaletteModule = await import('./components/shell/ActionPalette.svelte')
      const { get } = await import('svelte/store')

      const selectedTask: Task = {
        id: 'task-merge-many',
        initial_prompt: 'Task with multiple ready PRs',
        prompt: null,
        summary: null,
        status: 'doing',
        agent: null,
        permission_mode: null,
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      const firstReadyPr: PullRequestInfo = {
        id: 42,
        ticket_id: selectedTask.id,
        repo_owner: 'owner',
        repo_name: 'repo',
        title: 'First ready PR',
        url: 'https://github.com/owner/repo/pull/42',
        state: 'open',
        head_sha: 'abc123',
        ci_status: 'success',
        ci_check_runs: null,
        review_status: 'approved',
        mergeable: true,
        mergeable_state: 'clean',
        merged_at: null,
        created_at: 1000,
        updated_at: 1000,
        draft: false,
        is_queued: false,
        unaddressed_comment_count: 0,
      }

      const secondReadyPr: PullRequestInfo = {
        ...firstReadyPr,
        id: 99,
        title: 'Second ready PR',
        url: 'https://github.com/owner/repo/pull/99',
        head_sha: 'def456',
      }

      vi.mocked(ipc.getTasksForProject).mockResolvedValue([selectedTask])
      vi.mocked(ipc.getPullRequests).mockResolvedValue([firstReadyPr, secondReadyPr])
      vi.mocked(ipc.mergePullRequest).mockResolvedValue(undefined)
      vi.mocked(ipc.forceGithubSync).mockResolvedValue({
        new_comments: 0,
        ci_changes: 0,
        review_changes: 0,
        pr_changes: 0,
        errors: 0,
        rate_limited: false,
        rate_limit_reset_at: null,
      })

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)
      stores.ticketPrs.set(new Map([[selectedTask.id, [firstReadyPr, secondReadyPr]]]))

      render(App)

      await vi.waitFor(() => {
        expect(ipc.getTasksForProject).toHaveBeenCalled()
      })

      await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(actionPaletteModule.default).toHaveBeenCalled()
      })

      const lastCall = vi.mocked(actionPaletteModule.default).mock.calls.at(-1)
      if (!lastCall) throw new Error('Expected ActionPalette to receive props')

      const propsCandidate = lastCall
        .flatMap((arg) => {
          if (typeof arg !== 'object' || arg === null) return []
          if ('props' in arg && typeof arg.props === 'object' && arg.props !== null) return [arg, arg.props]
          return [arg]
        })
        .find((arg): arg is { onExecute: (actionId: string) => Promise<void> } => 'onExecute' in arg && typeof arg.onExecute === 'function')

      if (!propsCandidate) throw new Error('Expected ActionPalette props to include onExecute')

      await propsCandidate.onExecute('merge-pr')

      expect(ipc.mergePullRequest).not.toHaveBeenCalled()
      expect(ipc.forceGithubSync).not.toHaveBeenCalled()
      expect(get(stores.ticketPrs).get(selectedTask.id)).toEqual([firstReadyPr, secondReadyPr])
      expect(get(stores.error)).toBe('Multiple pull requests are ready to merge. Open the task details to choose the correct PR.')
    })
  })
})
