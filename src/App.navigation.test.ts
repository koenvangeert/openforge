import { fireEvent, render } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from './lib/types'
import { installAppTestLifecycle } from './App.test-harness'

describe('App navigation shortcuts', () => {
  installAppTestLifecycle()
  describe('keyboard shortcuts', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('CMD+H resets to board view and clears selectedTaskId', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')

      render(App)

      // Simulate being on a task detail view
      stores.selectedTaskId.set('task-123')
      stores.tasks.set([
        {
          id: 'task-123',
          initial_prompt: 'Finish task',
          prompt: null,
          summary: null,
          status: 'doing',
          agent: null,
          permission_mode: null,
          depends_on: [],
          project_id: 'proj-1',
          created_at: 1000,
          updated_at: 1000,
        },
      ])
      stores.currentView.set('settings')

      vi.mocked(nav.resetToBoard).mockClear()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', metaKey: true, bubbles: true }))

      expect(nav.resetToBoard).toHaveBeenCalled()
    })

    it('CMD+G navigates to plugin PR review view', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const pluginStore = await import('./lib/plugin/pluginStore')
      const pluginRegistry = await import('./lib/plugin/pluginRegistry')
      const { GITHUB_SYNC_PLUGIN_ID } = await import('./lib/githubSyncPlugin')
      const { get } = await import('svelte/store')
      const { tick } = await import('svelte')

      stores.currentView.set('board')
      render(App)
      await vi.waitFor(() => {
        expect(get(pluginStore.installedPlugins).has(GITHUB_SYNC_PLUGIN_ID)).toBe(true)
      })
      pluginStore.enabledPluginIds.set(new Set([GITHUB_SYNC_PLUGIN_ID]))
      await pluginRegistry.activatePlugin(GITHUB_SYNC_PLUGIN_ID)
      pluginStore.setRuntimeContributionSource(GITHUB_SYNC_PLUGIN_ID, {
        views: [{ id: 'pr_review', title: 'Pull Requests', icon: 'git-pull-request', showInRail: true, railOrder: 20, shortcut: 'Cmd+G' }],
      })
      await tick()

      await vi.waitFor(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', metaKey: true, bubbles: true }))
        expect(get(stores.currentView)).toBe('plugin:com.openforge.github-sync:pr_review')
      })
    })

  it('CMD+O navigates to the plugin-provided files view', async () => {
    const App = (await import('./App.svelte')).default
    const stores = await import('./lib/stores')
    const { get } = await import('svelte/store')
    const { tick } = await import('svelte')
    const pluginStore = await import('./lib/plugin/pluginStore')
    const pluginRegistry = await import('./lib/plugin/pluginRegistry')
    const { FILE_VIEWER_PLUGIN_ID } = await import('./lib/fileViewerPlugin')

    stores.currentView.set('board')
    render(App)
    await vi.waitFor(() => {
      expect(get(pluginStore.installedPlugins).has(FILE_VIEWER_PLUGIN_ID)).toBe(true)
    })
    pluginStore.enabledPluginIds.set(new Set([FILE_VIEWER_PLUGIN_ID]))
    await pluginRegistry.activatePlugin(FILE_VIEWER_PLUGIN_ID)
    pluginStore.setRuntimeContributionSource(FILE_VIEWER_PLUGIN_ID, {
      views: [{ id: 'files', title: 'Files', icon: 'folder-open', showInRail: true, railOrder: 10, shortcut: 'Cmd+O' }],
    })
    await tick()

    await vi.waitFor(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', metaKey: true, bubbles: true }))
      expect(get(stores.currentView)).toBe('plugin:com.openforge.file-viewer:files')
    })
  })

    it('CMD+L navigates to plugin skills view', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const pluginStore = await import('./lib/plugin/pluginStore')
      const pluginRegistry = await import('./lib/plugin/pluginRegistry')
      const { SKILLS_VIEWER_PLUGIN_ID } = await import('./lib/skillsViewerPlugin')
      const { get } = await import('svelte/store')
      const { tick } = await import('svelte')

      stores.currentView.set('board')
      render(App)
      await vi.waitFor(() => {
        expect(get(pluginStore.installedPlugins).has(SKILLS_VIEWER_PLUGIN_ID)).toBe(true)
      })
      pluginStore.enabledPluginIds.set(new Set([SKILLS_VIEWER_PLUGIN_ID]))
      await pluginRegistry.activatePlugin(SKILLS_VIEWER_PLUGIN_ID)
      pluginStore.setRuntimeContributionSource(SKILLS_VIEWER_PLUGIN_ID, {
        views: [{ id: 'skills', title: 'Skills', icon: 'sparkles', showInRail: true, railOrder: 30, shortcut: 'Cmd+L' }],
      })
      await tick()

      await vi.waitFor(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', metaKey: true, bubbles: true }))
        expect(get(stores.currentView)).toBe('plugin:com.openforge.skills-viewer:skills')
      })
    })

    it('CMD+comma navigates to settings view', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const { get } = await import('svelte/store')

      render(App)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true }))
      expect(get(stores.currentView)).toBe('settings')
    })

    it('dashboard icon resets to board when a task view is open', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')
      const iconRailModule = await import('./components/shell/IconRail.svelte')

      stores.selectedTaskId.set('task-123')
      stores.currentView.set('board')

      render(App)

      await vi.waitFor(() => {
        expect(iconRailModule.default).toHaveBeenCalled()
      })

      const lastCall = vi.mocked(iconRailModule.default).mock.calls.at(-1)
      expect(lastCall).toBeTruthy()

      if (!lastCall) {
        throw new Error('Expected IconRail to receive props')
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
        .find((arg): arg is { onNavigate: (view: string) => void } => 'onNavigate' in arg && typeof arg.onNavigate === 'function')

      if (!propsCandidate) {
        throw new Error('Expected IconRail props to include onNavigate')
      }

      vi.mocked(nav.resetToBoard).mockClear()

      propsCandidate.onNavigate('board')

      expect(nav.resetToBoard).toHaveBeenCalled()
    })

    it('CMD+K opens the action palette', async () => {
      const App = (await import('./App.svelte')).default
      const actionPaletteModule = await import('./components/shell/ActionPalette.svelte')

      render(App)

      await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(actionPaletteModule.default).toHaveBeenCalled()
      })
    })

    it('CMD+SHIFT+P opens the project switcher', async () => {
      const App = (await import('./App.svelte')).default
      const projectSwitcherModule = await import('./components/project/ProjectSwitcherModal.svelte')

      render(App)

      await fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(projectSwitcherModule.default).toHaveBeenCalled()
      })
    })

    it('CMD+P opens the file quick-open overlay from the board', async () => {
      const App = (await import('./App.svelte')).default
      const projectSwitcherModule = await import('./components/project/ProjectSwitcherModal.svelte')
      const fileQuickOpenModule = await import('./components/shell/FileQuickOpen.svelte')

      render(App)

      await fireEvent.keyDown(window, { key: 'p', metaKey: true, bubbles: true })

      expect(projectSwitcherModule.default).not.toHaveBeenCalled()
      await vi.waitFor(() => {
        expect(fileQuickOpenModule.default).toHaveBeenCalled()
      })
    })

    it('CMD+P opens the file quick-open overlay from plugin views', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const fileQuickOpenModule = await import('./components/shell/FileQuickOpen.svelte')

      stores.currentView.set('plugin:com.openforge.github-sync:pr_review')
      stores.selectedTaskId.set(null)
      render(App)

      await fireEvent.keyDown(window, { key: 'p', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(fileQuickOpenModule.default).toHaveBeenCalled()
      })
    })

    it('CMD+P does not open the file quick-open overlay from task views', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const fileQuickOpenModule = await import('./components/shell/FileQuickOpen.svelte')
      const selectedTask: Task = {
        id: 'task-123',
        initial_prompt: 'Finish task',
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
      stores.currentView.set('board')
      render(App)

      await fireEvent.keyDown(window, { key: 'p', metaKey: true, bubbles: true })

      expect(fileQuickOpenModule.default).not.toHaveBeenCalled()
    })

  })
})
