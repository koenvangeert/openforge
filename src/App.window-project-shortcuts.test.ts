import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from './lib/types'
import {
  closeRequestedHandler,
  installedPluginRows,
  installAppTestLifecycle,
  mockExecutePluginCommand,
  mockWindowDestroy,
  mockWindowOnCloseRequested,
} from './App.test-harness'

describe('App window and project shortcuts', () => {
  installAppTestLifecycle()
  describe('keyboard shortcuts', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('CMD+SHIFT+F opens search tasks', async () => {
      const App = (await import('./App.svelte')).default
      const commandPaletteModule = await import('./components/shell/CommandPalette.svelte')

      render(App)

      await fireEvent.keyDown(window, { key: 'F', metaKey: true, shiftKey: true, bubbles: true })

      expect(commandPaletteModule.default).toHaveBeenCalled()
    })

    it('CMD+SHIFT+R triggers GitHub refresh through the plugin command shortcut', async () => {
      const App = (await import('./App.svelte')).default
      const ipc = await import('./lib/ipc')
      const pluginStore = await import('./lib/plugin/pluginStore')

      vi.mocked(ipc.forceGithubSync).mockResolvedValue({
        new_comments: 0,
        ci_changes: 0,
        review_changes: 0,
        pr_changes: 0,
        errors: 0,
        rate_limited: false,
        rate_limit_reset_at: null,
      })

      render(App)

      await vi.waitFor(() => {
        expect(installedPluginRows.some((row) => row.id === 'com.openforge.github-sync')).toBe(true)
      })
      pluginStore.enabledPluginIds.set(new Set(['com.openforge.github-sync']))
      pluginStore.runtimeContributionSources.set(new Map([[
        'com.openforge.github-sync',
        { pluginId: 'com.openforge.github-sync', commands: [{ id: 'refresh', title: 'Refresh Pull Requests', shortcut: 'Cmd+Shift+R' }] },
      ]]))

      await fireEvent.keyDown(window, { key: 'R', metaKey: true, shiftKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(mockExecutePluginCommand).toHaveBeenCalledWith('com.openforge.github-sync', 'refresh')
      })
    })

    it('Shift+/ opens the keyboard shortcuts dialog', async () => {
      const App = (await import('./App.svelte')).default

      render(App)

      await fireEvent.keyDown(window, { key: '?', shiftKey: true, bubbles: true })

      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.getByText('Keyboard Shortcuts')).toBeTruthy()
    })

    it('shows the registered file quick-open shortcut in keyboard shortcuts help', async () => {
      const App = (await import('./App.svelte')).default

      render(App)

      await fireEvent.keyDown(window, { key: '?', shiftKey: true, bubbles: true })

      const filesRow = screen.getByText('Files').closest('div')

      expect(filesRow?.textContent).toContain('⌘P')
    })

    it('prevents window close requests and shows a confirmation modal', async () => {
      const App = (await import('./App.svelte')).default

      render(App)

      await vi.waitFor(() => {
        expect(mockWindowOnCloseRequested).toHaveBeenCalled()
      })

      const preventDefault = vi.fn()
      if (!closeRequestedHandler) {
        throw new Error('Expected close request handler to be registered')
      }

      await closeRequestedHandler({ preventDefault })

      expect(preventDefault).toHaveBeenCalled()
      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.getByText('Quit Open Forge?')).toBeTruthy()
      expect(mockWindowDestroy).not.toHaveBeenCalled()
    })

    it('focuses the Quit button when the close confirmation opens', async () => {
      const App = (await import('./App.svelte')).default

      render(App)

      await vi.waitFor(() => {
        expect(mockWindowOnCloseRequested).toHaveBeenCalled()
      })

      if (!closeRequestedHandler) {
        throw new Error('Expected close request handler to be registered')
      }

      await closeRequestedHandler({ preventDefault: vi.fn() })

      const quitButton = screen.getByRole('button', { name: 'Quit' })
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(quitButton)
      })
    })

    it('destroys the window after the user confirms close', async () => {
      const App = (await import('./App.svelte')).default

      render(App)

      await vi.waitFor(() => {
        expect(mockWindowOnCloseRequested).toHaveBeenCalled()
      })

      if (!closeRequestedHandler) {
        throw new Error('Expected close request handler to be registered')
      }

      await closeRequestedHandler({ preventDefault: vi.fn() })
      await fireEvent.click(screen.getByRole('button', { name: 'Quit' }))

      expect(mockWindowDestroy).toHaveBeenCalledTimes(1)
    })

    it('keeps the app open when the user cancels close', async () => {
      const App = (await import('./App.svelte')).default

      render(App)

      await vi.waitFor(() => {
        expect(mockWindowOnCloseRequested).toHaveBeenCalled()
      })

      if (!closeRequestedHandler) {
        throw new Error('Expected close request handler to be registered')
      }

      await closeRequestedHandler({ preventDefault: vi.fn() })
      await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByText('Quit Open Forge?')).toBeNull()
      expect(mockWindowDestroy).not.toHaveBeenCalled()
    })

    it('pressing 2 cycles to next project and resets to board', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const nav = await import('./lib/router.svelte')
      const { get } = await import('svelte/store')

      const projectList: Project[] = [
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
        { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
      ]
      vi.mocked(ipc.getProjects).mockResolvedValue(projectList)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.projects)).toHaveLength(2)
      })

      vi.mocked(nav.resetToBoard).mockClear()
      stores.activeProjectId.set('proj-1')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }))

      expect(get(stores.activeProjectId)).toBe('proj-2')
      expect(nav.resetToBoard).toHaveBeenCalled()
    })

    it('resets remembered Flow board tab when switching projects', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      const projectList: Project[] = [
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
        { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
      ]
      vi.mocked(ipc.getProjects).mockResolvedValue(projectList)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.projects)).toHaveLength(2)
      })

      stores.focusBoardFilters.set(new Map([
        ['proj-1', 'backlog'],
        ['proj-2', 'in-progress'],
      ]))

      stores.activeProjectId.set('proj-1')
      await vi.waitFor(() => {
        expect(get(stores.focusBoardFilters).get('proj-1')).toBeUndefined()
      })

      stores.focusBoardFilters.set(new Map([
        ['proj-1', 'backlog'],
        ['proj-2', 'in-progress'],
      ]))

      stores.activeProjectId.set('proj-2')
      await vi.waitFor(() => {
        expect(get(stores.focusBoardFilters).get('proj-2')).toBeUndefined()
      })
      expect(get(stores.focusBoardFilters).get('proj-1')).toBe('backlog')
    })

    it('pressing 1 cycles to previous project', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      const projectList: Project[] = [
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
        { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
      ]
      vi.mocked(ipc.getProjects).mockResolvedValue(projectList)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.projects)).toHaveLength(2)
      })

      stores.activeProjectId.set('proj-2')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))

      expect(get(stores.activeProjectId)).toBe('proj-1')
    })

    it('pressing 2 wraps around to first project', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      const projectList: Project[] = [
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
        { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
      ]
      vi.mocked(ipc.getProjects).mockResolvedValue(projectList)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.projects)).toHaveLength(2)
      })

      stores.activeProjectId.set('proj-2')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }))

      expect(get(stores.activeProjectId)).toBe('proj-1')
    })

    it('pressing Ctrl+N cycles to next project on the board and resets to board', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const nav = await import('./lib/router.svelte')
      const { get } = await import('svelte/store')

      const projectList: Project[] = [
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
        { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
      ]
      vi.mocked(ipc.getProjects).mockResolvedValue(projectList)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.projects)).toHaveLength(2)
      })

      stores.currentView.set('board')
      stores.selectedTaskId.set(null)
      vi.mocked(nav.resetToBoard).mockClear()
      stores.activeProjectId.set('proj-1')

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }))

      expect(get(stores.activeProjectId)).toBe('proj-2')
      expect(nav.resetToBoard).toHaveBeenCalled()
    })

    it('pressing Ctrl+P cycles to previous project on the board', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const nav = await import('./lib/router.svelte')
      const { get } = await import('svelte/store')

      const projectList: Project[] = [
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
        { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
      ]
      vi.mocked(ipc.getProjects).mockResolvedValue(projectList)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.projects)).toHaveLength(2)
      })

      stores.currentView.set('board')
      stores.selectedTaskId.set(null)
      vi.mocked(nav.resetToBoard).mockClear()
      stores.activeProjectId.set('proj-2')

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }))

      expect(get(stores.activeProjectId)).toBe('proj-1')
      expect(nav.resetToBoard).toHaveBeenCalled()
    })

    it('1 and 2 do not fire when input is focused', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      const projectList: Project[] = [
        { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
        { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
      ]
      vi.mocked(ipc.getProjects).mockResolvedValue(projectList)

      render(App)

      await vi.waitFor(() => {
        expect(get(stores.projects)).toHaveLength(2)
      })

      stores.activeProjectId.set('proj-1')
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))

      expect(get(stores.activeProjectId)).toBe('proj-1')
    })

    it('Shift+/ does NOT open dialog when input is focused', async () => {
      const App = (await import('./App.svelte')).default
      render(App)

      // Create and focus an input element
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      // Dispatch ? key and check if preventDefault was called
      const event = new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
      window.dispatchEvent(event)

      // preventDefault should NOT be called (handler should not run)
      expect(preventDefaultSpy).not.toHaveBeenCalled()
    })

    it('s does NOT navigate when input is focused', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const { get } = await import('svelte/store')

      stores.currentView.set('board')
      render(App)

      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
      expect(get(stores.currentView)).toBe('board')
    })

    it('Shift+/ opens dialog when input is NOT focused', async () => {
      const App = (await import('./App.svelte')).default
      render(App)

      // Ensure no stray input holds focus from a previous test
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }

      await fireEvent.keyDown(window, { key: '?', shiftKey: true, bubbles: true })

      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.getByText('Keyboard Shortcuts')).toBeTruthy()
    })
  })
})
