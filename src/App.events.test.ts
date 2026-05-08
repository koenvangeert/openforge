import { render } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { PullRequestInfo } from './lib/types'
import { requireDefined } from './test-utils/dom'
import { eventListeners, installAppTestLifecycle } from './App.test-harness'

describe('App desktop events', () => {
  installAppTestLifecycle()
  describe('github-sync-complete', () => {
    it('preserves locally merged state and definitive mergeability during background sync', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      stores.projects.set([])
      stores.tasks.set([])
      stores.ticketPrs.set(new Map())
      stores.activeProjectId.set('proj-1')

      vi.mocked(ipc.getProjects).mockResolvedValue([])
      vi.mocked(ipc.getTasksForProject).mockResolvedValue([])
      vi.mocked(ipc.getLatestSessions).mockResolvedValue([])
      vi.mocked(ipc.getProjectAttention).mockResolvedValue([{
        project_id: 'proj-1',
        needs_input: 0,
        running_agents: 0,
        ci_failures: 0,
        unaddressed_comments: 0,
        completed_agents: 0
      }])
      vi.mocked(ipc.getProjectConfig).mockResolvedValue(null)

      const prA: PullRequestInfo = {
        id: 42,
        ticket_id: 'T-42',
        repo_owner: 'owner',
        repo_name: 'repo',
        title: 'PR A',
        url: 'https://example.com',
        state: 'merged',
        merged_at: 1000,
        head_sha: 'abc',
        ci_status: null,
        ci_check_runs: null,
        review_status: null,
        mergeable: true,
        mergeable_state: 'clean',
        created_at: 0,
        updated_at: 0,
        draft: false,
        is_queued: false,
        unaddressed_comment_count: 0
      }
      const prB: PullRequestInfo = {
        ...prA,
        id: 99,
        ticket_id: 'T-99',
        title: 'PR B',
        state: 'open',
        merged_at: null,
        mergeable: false,
        mergeable_state: 'dirty'
      }
      
      stores.ticketPrs.set(new Map([
        ['T-42', [prA]],
        ['T-99', [prB]]
      ]))

      const transientPrA = { ...prA, state: 'open', merged_at: null }
      const transientPrB = { ...prB, mergeable: null, mergeable_state: 'unknown' }
      vi.mocked(ipc.getPullRequests).mockResolvedValue([transientPrA, transientPrB])

      render(App)

      await vi.waitFor(() => {
        expect(eventListeners.has('github-sync-complete')).toBe(true)
      })

      const syncCallback = requireDefined(
        eventListeners.get('github-sync-complete'),
        'Expected github-sync-complete listener to be registered',
      )
      await syncCallback()

      await new Promise(r => setTimeout(r, 0))

      const map = get(stores.ticketPrs)
      const newPrA = map.get('T-42')?.[0]
      const newPrB = map.get('T-99')?.[0]

      expect(newPrA?.state).toBe('merged')
      expect(newPrA?.merged_at).toBe(1000)

      expect(newPrB?.mergeable).toBe(false)
      expect(newPrB?.mergeable_state).toBe('dirty')
    })
  })

  describe('task-changed created events', () => {
    it('stores the created task prompt text for the spawned-task toast', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const { getTaskDetail } = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      vi.mocked(getTaskDetail).mockResolvedValue({
        id: 'T-99',
        initial_prompt: '',
        prompt: 'Prompt from task detail',
        summary: null,
        status: 'backlog',
        agent: null,
        permission_mode: null,
        depends_on: [],
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      })

      render(App)

      await vi.waitFor(() => {
        expect(eventListeners.has('task-changed')).toBe(true)
      })

      const callback = eventListeners.get('task-changed')
      expect(callback).toBeDefined()

      await callback?.({ payload: { action: 'created', task_id: 'T-99' } })

      await vi.waitFor(() => {
        expect(get(stores.taskSpawned)).toEqual({ taskId: 'T-99', promptText: 'Prompt from task detail' })
      })
    })
  })
})
