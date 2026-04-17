import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import IconRail from './IconRail.svelte'
import type { AppView } from '../../lib/types'
import { commandHeld } from '../../lib/stores'

describe('IconRail', () => {
  it('renders 2 static navigation buttons', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
  })

  it('clicking first button (board) calls onNavigate with "board"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'settings' as AppView, onNavigate } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])
    expect(onNavigate).toHaveBeenCalledWith('board')
  })

  it('clicking second button (settings) calls onNavigate with "settings"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[1])
    expect(onNavigate).toHaveBeenCalledWith('settings')
  })

  it('renders plugin navigation items after the static entries', () => {
    const onNavigate = vi.fn()
    render(IconRail, {
      props: {
        currentView: 'board' as AppView,
        onNavigate,
        pluginNavItems: [
          {
            viewKey: 'plugin:com.openforge.file-viewer:files',
            icon: 'folder-open',
            title: 'Files',
            shortcut: '⌘O',
          },
        ],
      },
    })

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)

    fireEvent.click(buttons[2])
    expect(onNavigate).toHaveBeenCalledWith('plugin:com.openforge.file-viewer:files')
  })

  it('shows review request count badge when reviewRequestCount > 0', () => {
    render(IconRail, {
      props: {
        currentView: 'board' as AppView,
        onNavigate: vi.fn(),
        reviewRequestCount: 3,
        pluginNavItems: [
          {
            viewKey: 'plugin:com.openforge.github-sync:pr_review',
            icon: 'git-pull-request',
            title: 'Pull Requests',
            shortcut: '⌘G',
          },
        ],
      },
    })
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('does not show badge when reviewRequestCount is 0', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), reviewRequestCount: 0 } })
    expect(screen.queryByText('0')).toBeNull()
  })

  it('shows authored PR count badge when authoredPrCount > 0', () => {
    render(IconRail, {
      props: {
        currentView: 'board' as AppView,
        onNavigate: vi.fn(),
        reviewRequestCount: 0,
        authoredPrCount: 5,
        pluginNavItems: [
          {
            viewKey: 'plugin:com.openforge.github-sync:pr_review',
            icon: 'git-pull-request',
            title: 'Pull Requests',
            shortcut: '⌘G',
          },
        ],
      },
    })
    expect(screen.getByText('5')).toBeTruthy()
  })

  describe('shortcut badges', () => {
    it('shows shortcut key badges for all nav items when commandHeld is true', () => {
      commandHeld.set(true)
      render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })

      expect(screen.getByText('H')).toBeTruthy()
      expect(screen.getByText(',')).toBeTruthy()

      commandHeld.set(false)
    })

    it('hides shortcut badges when commandHeld is false', () => {
      commandHeld.set(false)
      render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })

      expect(screen.queryByText('H')).toBeNull()
      expect(screen.queryByText(',')).toBeNull()
    })

    it('shows correct shortcut letter for each view', () => {
      commandHeld.set(true)
      render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })

      expect(screen.getByText('H')).toBeTruthy()
      expect(screen.getByText(',')).toBeTruthy()

      commandHeld.set(false)
    })

    it('hides kbd badges when modalsOpen is true even if commandHeld is true', () => {
      commandHeld.set(true)
      render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), modalsOpen: true } })

      expect(screen.queryByText('H')).toBeNull()
      expect(screen.queryByText(',')).toBeNull()

      commandHeld.set(false)
    })

    it('shows PR badges on the github sync plugin item', () => {
      render(IconRail, {
        props: {
          currentView: 'board' as AppView,
          onNavigate: vi.fn(),
          reviewRequestCount: 3,
          authoredPrCount: 5,
          pluginNavItems: [
            {
              viewKey: 'plugin:com.openforge.github-sync:pr_review',
              icon: 'git-pull-request',
              title: 'Pull Requests',
              shortcut: '⌘G',
            },
          ],
        },
      })

      expect(screen.getByText('3')).toBeTruthy()
      expect(screen.getByText('5')).toBeTruthy()
    })

    it('shows plugin shortcut badges when commandHeld is true', () => {
      commandHeld.set(true)
      render(IconRail, {
        props: {
          currentView: 'board' as AppView,
          onNavigate: vi.fn(),
          pluginNavItems: [
            {
              viewKey: 'plugin:com.openforge.file-viewer:files',
              icon: 'folder-open',
              title: 'Files',
              shortcut: '⌘O',
            },
          ],
        },
      })

      expect(screen.getByText('O')).toBeTruthy()
      commandHeld.set(false)
    })
  })

})
