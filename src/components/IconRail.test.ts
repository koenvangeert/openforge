import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import IconRail from './IconRail.svelte'
import type { AppView } from '../lib/types'

describe('IconRail', () => {
  it('renders the logo text ">_"', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })
    expect(screen.getByText('>_')).toBeTruthy()
  })

  it('renders 4 navigation buttons', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(4)
  })

  it('clicking first button (dashboard) calls onNavigate with "board"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'settings' as AppView, onNavigate } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])
    expect(onNavigate).toHaveBeenCalledWith('board')
  })

  it('clicking second button (pr) calls onNavigate with "pr_review"', () => {
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

  it('clicking fourth button (settings) calls onNavigate with "settings"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[3])
    expect(onNavigate).toHaveBeenCalledWith('settings')
  })

  it('active board button has text-primary class when currentView is "board"', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })
    const buttons = screen.getAllByRole('button')
    expect(buttons[0].className).toContain('text-primary')
  })

  it('inactive buttons have muted color class when not the active view', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })
    const buttons = screen.getAllByRole('button')
    expect(buttons[1].className).toContain('text-[#666666]')
    expect(buttons[2].className).toContain('text-[#666666]')
    expect(buttons[3].className).toContain('text-[#666666]')
  })

  it('active pr_review button has text-primary class when currentView is "pr_review"', () => {
    render(IconRail, { props: { currentView: 'pr_review' as AppView, onNavigate: vi.fn() } })
    const buttons = screen.getAllByRole('button')
    expect(buttons[1].className).toContain('text-primary')
  })

  it('active skills button has text-primary class when currentView is "skills"', () => {
    render(IconRail, { props: { currentView: 'skills' as AppView, onNavigate: vi.fn() } })
    const buttons = screen.getAllByRole('button')
    expect(buttons[2].className).toContain('text-primary')
  })

  it('active settings button has text-primary class when currentView is "settings"', () => {
    render(IconRail, { props: { currentView: 'settings' as AppView, onNavigate: vi.fn() } })
    const buttons = screen.getAllByRole('button')
    expect(buttons[3].className).toContain('text-primary')
  })

  it('board button is not primary when currentView is "pr_review"', () => {
    render(IconRail, { props: { currentView: 'pr_review' as AppView, onNavigate: vi.fn() } })
    const buttons = screen.getAllByRole('button')
    expect(buttons[0].className).toContain('text-[#666666]')
  })
})
