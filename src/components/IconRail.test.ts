import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import IconRail from './IconRail.svelte'
import type { AppView } from '../lib/types'
import { commandHeld } from '../lib/stores'

describe('IconRail', () => {
  it('renders 3 navigation buttons', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(4)
  })

  it('clicking first button (board) calls onNavigate with "board"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'settings' as AppView, onNavigate } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])
    expect(onNavigate).toHaveBeenCalledWith('board')
  })

  it('clicking second button (pr_review) calls onNavigate with "pr_review"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[1])
    expect(onNavigate).toHaveBeenCalledWith('pr_review')
  })

  it('clicking third button (skills) calls onNavigate with "skills"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[2])
    expect(onNavigate).toHaveBeenCalledWith('skills')
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
      expect(screen.getByText('G')).toBeTruthy()  // pr_review (Git)
      expect(screen.getByText('L')).toBeTruthy()  // skills (skiLLs)

      commandHeld.set(false)
    })

    it('hides kbd badges when modalsOpen is true even if commandHeld is true', () => {
      commandHeld.set(true)
      render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), modalsOpen: true } })

      expect(screen.queryByText('H')).toBeNull()
      expect(screen.queryByText('G')).toBeNull()
      expect(screen.queryByText('L')).toBeNull()

      commandHeld.set(false)
    })
  })

  it('shows shepherd button when shepherdEnabled is true', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), authoredPrCount: 0, shepherdEnabled: true, modalsOpen: false } })
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(5)
  })

  it('clicking shepherd button calls onNavigate with "shepherd"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate, authoredPrCount: 0, shepherdEnabled: true, modalsOpen: false } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[4])
    expect(onNavigate).toHaveBeenCalledWith('shepherd')
  })

  it('does not show shepherd button when shepherdEnabled is false', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), authoredPrCount: 0, shepherdEnabled: false, modalsOpen: false } })
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(4)
  })

  describe('action item dot indicator', () => {
    it('shows dot when shepherdEnabled=true and actionItemCount > 0', () => {
      render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), authoredPrCount: 0, shepherdEnabled: true, actionItemCount: 3, modalsOpen: false } })
      const dots = document.querySelectorAll('span.rounded-full')
      expect(dots.length).toBeGreaterThan(0)
    })

    it('does not show dot when shepherdEnabled=true and actionItemCount=0', () => {
      render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), authoredPrCount: 0, shepherdEnabled: true, actionItemCount: 0, modalsOpen: false } })
      const dots = document.querySelectorAll('span.rounded-full.bg-primary')
      expect(dots).toHaveLength(0)
    })

    it('does not show dot when shepherdEnabled=false and actionItemCount > 0', () => {
      render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), authoredPrCount: 0, shepherdEnabled: false, actionItemCount: 3, modalsOpen: false } })
      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(4)
    })
  })
})
