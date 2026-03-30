import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import IconRail from './IconRail.svelte'
import type { AppView } from '../../lib/types'
import { commandHeld } from '../../lib/stores'

describe('IconRail', () => {
  it('renders 5 navigation buttons', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(5)
  })

  it('clicking first button (board) calls onNavigate with "board"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'settings' as AppView, onNavigate } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])
    expect(onNavigate).toHaveBeenCalledWith('board')
  })

  it('clicking second button (files) calls onNavigate with "files"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[1])
    expect(onNavigate).toHaveBeenCalledWith('files')
  })

  it('clicking third button (pr_review) calls onNavigate with "pr_review"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[2])
    expect(onNavigate).toHaveBeenCalledWith('pr_review')
  })

  it('shows review request count badge when reviewRequestCount > 0', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), reviewRequestCount: 3 } })
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('does not show badge when reviewRequestCount is 0', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), reviewRequestCount: 0 } })
    expect(screen.queryByText('0')).toBeNull()
  })

  it('shows authored PR count badge when authoredPrCount > 0', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), reviewRequestCount: 0, authoredPrCount: 5 } })
    expect(screen.getByText('5')).toBeTruthy()
  })

  describe('shortcut badges', () => {
    it('shows shortcut key badges for all nav items when commandHeld is true', () => {
      commandHeld.set(true)
      render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })

      expect(screen.getByText('H')).toBeTruthy()
      expect(screen.getByText('F')).toBeTruthy()
      expect(screen.getByText('G')).toBeTruthy()
      expect(screen.getByText('L')).toBeTruthy()

      commandHeld.set(false)
    })

    it('hides shortcut badges when commandHeld is false', () => {
      commandHeld.set(false)
      render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })

      expect(screen.queryByText('H')).toBeNull()
      expect(screen.queryByText('G')).toBeNull()
    })

    it('shows correct shortcut letter for each view', () => {
      commandHeld.set(true)
      render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })

      expect(screen.getByText('H')).toBeTruthy()  // board (Home)
      expect(screen.getByText('F')).toBeTruthy()  // files (Files)
      expect(screen.getByText('G')).toBeTruthy()  // pr_review (Git)
      expect(screen.getByText('L')).toBeTruthy()  // skills (skiLLs)

      commandHeld.set(false)
    })

    it('hides kbd badges when modalsOpen is true even if commandHeld is true', () => {
      commandHeld.set(true)
      render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), modalsOpen: true } })

      expect(screen.queryByText('H')).toBeNull()
      expect(screen.queryByText('F')).toBeNull()
      expect(screen.queryByText('G')).toBeNull()
      expect(screen.queryByText('L')).toBeNull()

      commandHeld.set(false)
    })
  })

})
