import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import IconRail from './IconRail.svelte'
import type { AppView } from '../lib/types'

describe('IconRail', () => {
  it('renders the logo text ">_"', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), creaturesEnabled: false, authoredPrCount: 0 } })
    expect(screen.getByText('>_')).toBeTruthy()
  })

  it('renders 6 navigation buttons when creatures is disabled', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), creaturesEnabled: false, authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(6)
  })

  it('renders 7 navigation buttons when creatures is enabled', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), creaturesEnabled: true, authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(7)
  })

  it('clicking first button (dashboard) calls onNavigate with "board"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'settings' as AppView, onNavigate, creaturesEnabled: false, authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])
    expect(onNavigate).toHaveBeenCalledWith('board')
  })

  it('clicking second button (pr) calls onNavigate with "pr_review"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate, creaturesEnabled: false, authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[1])
    expect(onNavigate).toHaveBeenCalledWith('pr_review')
  })

  it('clicking third button (my_prs) calls onNavigate with "my_prs"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate, creaturesEnabled: false, authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[2])
    expect(onNavigate).toHaveBeenCalledWith('my_prs')
  })

  it('clicking fourth button (skills) calls onNavigate with "skills"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate, creaturesEnabled: false, authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[3])
    expect(onNavigate).toHaveBeenCalledWith('skills')
  })

  it('clicking creatures button calls onNavigate with "creatures" when enabled', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate, creaturesEnabled: true, authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[4])
    expect(onNavigate).toHaveBeenCalledWith('creatures')
  })

  it('clicking workqueue button calls onNavigate with "workqueue" (creatures disabled)', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate, creaturesEnabled: false, authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[4])
    expect(onNavigate).toHaveBeenCalledWith('workqueue')
  })

  it('clicking workqueue button calls onNavigate with "workqueue" (creatures enabled)', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate, creaturesEnabled: true, authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[5])
    expect(onNavigate).toHaveBeenCalledWith('workqueue')
  })

  it('clicking settings button calls onNavigate with "settings" (creatures disabled)', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate, creaturesEnabled: false, authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[5])
    expect(onNavigate).toHaveBeenCalledWith('settings')
  })

  it('clicking settings button calls onNavigate with "settings" (creatures enabled)', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate, creaturesEnabled: true, authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[6])
    expect(onNavigate).toHaveBeenCalledWith('settings')
  })

  it('shows review request count badge when reviewRequestCount > 0', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), reviewRequestCount: 3, authoredPrCount: 0, creaturesEnabled: false } })
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('does not show badge when reviewRequestCount is 0', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), reviewRequestCount: 0, authoredPrCount: 0, creaturesEnabled: false } })
    expect(screen.queryByText('0')).toBeNull()
  })

  it('shows authored PR count badge when authoredPrCount > 0', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), reviewRequestCount: 0, authoredPrCount: 5, creaturesEnabled: false } })
    expect(screen.getByText('5')).toBeTruthy()
  })

})
