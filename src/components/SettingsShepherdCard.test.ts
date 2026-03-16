import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import SettingsShepherdCard from './SettingsShepherdCard.svelte'

vi.mock('../lib/ipc', () => ({
  listOpenCodeAgents: vi.fn(async () => [
    { name: 'shepherd', hidden: false, mode: null },
    { name: 'coder', hidden: false, mode: null },
    { name: 'internal', hidden: true, mode: null },
  ]),
  getProjectConfig: vi.fn(async () => null),
  setProjectConfig: vi.fn(async () => {}),
}))

vi.mock('../lib/stores', () => {
  const { writable } = require('svelte/store')
  return { activeProjectId: writable('P-1') }
})

function renderCard(shepherdEnabled: boolean, onShepherdToggle = vi.fn()) {
  return render(SettingsShepherdCard, {
    props: { shepherdEnabled, onShepherdToggle },
  })
}

describe('SettingsShepherdCard', () => {
  it('renders "Task Shepherd" title', () => {
    renderCard(false)
    expect(screen.getByText('Task Shepherd')).toBeTruthy()
  })

  it('renders "Experimental" badge text', () => {
    renderCard(false)
    expect(screen.getByText('Experimental')).toBeTruthy()
  })

  it('renders toggle with data-testid="shepherd-toggle"', () => {
    renderCard(false)
    expect(screen.getByTestId('shepherd-toggle')).toBeTruthy()
  })

  it('toggle is checked when shepherdEnabled=true', () => {
    renderCard(true)
    const toggle = screen.getByTestId('shepherd-toggle') as HTMLInputElement
    expect(toggle.checked).toBe(true)
  })

  it('toggle is unchecked when shepherdEnabled=false', () => {
    renderCard(false)
    const toggle = screen.getByTestId('shepherd-toggle') as HTMLInputElement
    expect(toggle.checked).toBe(false)
  })

  it('calls onShepherdToggle when toggle changes', async () => {
    const onShepherdToggle = vi.fn()
    renderCard(false, onShepherdToggle)
    const toggle = screen.getByTestId('shepherd-toggle')
    await fireEvent.change(toggle)
    expect(onShepherdToggle).toHaveBeenCalledOnce()
  })

  it('shows agent selector when enabled', async () => {
    renderCard(true)
    await vi.dynamicImportSettled()
    expect(screen.getByTestId('shepherd-agent-select')).toBeTruthy()
  })

  it('hides agent selector when disabled', () => {
    renderCard(false)
    expect(screen.queryByTestId('shepherd-agent-select')).toBeNull()
  })

  it('agent selector has Default option', async () => {
    renderCard(true)
    await vi.dynamicImportSettled()
    expect(screen.getByText('Default')).toBeTruthy()
  })

  it('saves agent selection via setProjectConfig', async () => {
    const { setProjectConfig } = await import('../lib/ipc')
    renderCard(true)
    await vi.dynamicImportSettled()
    const select = screen.getByTestId('shepherd-agent-select')
    await fireEvent.change(select, { target: { value: 'shepherd' } })
    expect(setProjectConfig).toHaveBeenCalledWith('P-1', 'shepherd_agent', 'shepherd')
  })
})
