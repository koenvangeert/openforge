import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import SettingsShepherdCard from './SettingsShepherdCard.svelte'

vi.mock('../lib/ipc', () => ({
  listShepherdAgents: vi.fn(async () => [
    { name: 'shepherd', hidden: false, mode: null },
    { name: 'coder', hidden: false, mode: null },
    { name: 'internal', hidden: true, mode: null },
  ]),
  listOpenCodeModels: vi.fn(async () => [
    { provider_id: 'anthropic', model_id: 'claude-sonnet', name: 'Claude Sonnet' },
    { provider_id: 'openai', model_id: 'gpt-4o', name: 'GPT-4o' },
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

  it('agent and model selectors have Default options', async () => {
    renderCard(true)
    await vi.dynamicImportSettled()
    const agentSelect = screen.getByTestId('shepherd-agent-select')
    const modelSelect = screen.getByTestId('shepherd-model-select')
    expect(agentSelect.querySelector('option[value=""]')?.textContent).toBe('Default')
    expect(modelSelect.querySelector('option[value=""]')?.textContent).toBe('Default')
  })

  it('saves agent selection via setProjectConfig', async () => {
    const { setProjectConfig } = await import('../lib/ipc')
    renderCard(true)
    await vi.dynamicImportSettled()
    const select = screen.getByTestId('shepherd-agent-select')
    await fireEvent.change(select, { target: { value: 'shepherd' } })
    expect(setProjectConfig).toHaveBeenCalledWith('P-1', 'shepherd_agent', 'shepherd')
  })

  it('shows model selector when enabled', async () => {
    renderCard(true)
    await vi.dynamicImportSettled()
    expect(screen.getByTestId('shepherd-model-select')).toBeTruthy()
  })

  it('hides model selector when disabled', () => {
    renderCard(false)
    expect(screen.queryByTestId('shepherd-model-select')).toBeNull()
  })

  it('saves model selection via setProjectConfig', async () => {
    const { setProjectConfig } = await import('../lib/ipc')
    renderCard(true)
    await vi.dynamicImportSettled()
    const select = screen.getByTestId('shepherd-model-select')
    await fireEvent.change(select, { target: { value: 'anthropic/claude-sonnet' } })
    expect(setProjectConfig).toHaveBeenCalledWith('P-1', 'shepherd_model', 'anthropic/claude-sonnet')
  })

  it('shows initial prompt textarea when enabled', async () => {
    renderCard(true)
    await vi.dynamicImportSettled()
    expect(screen.getByTestId('shepherd-initial-prompt')).toBeTruthy()
  })

  it('hides initial prompt textarea when disabled', () => {
    renderCard(false)
    expect(screen.queryByTestId('shepherd-initial-prompt')).toBeNull()
  })

  it('saves initial prompt via setProjectConfig after debounce', async () => {
    vi.useFakeTimers()
    const { setProjectConfig } = await import('../lib/ipc')
    renderCard(true)
    await vi.dynamicImportSettled()
    const textarea = screen.getByTestId('shepherd-initial-prompt')
    await fireEvent.input(textarea, { target: { value: 'Custom prompt text' } })
    vi.advanceTimersByTime(500)
    expect(setProjectConfig).toHaveBeenCalledWith('P-1', 'shepherd_initial_prompt', 'Custom prompt text')
    vi.useRealTimers()
  })

  it('uses listShepherdAgents instead of listOpenCodeAgents', async () => {
    const { listShepherdAgents } = await import('../lib/ipc')
    renderCard(true)
    await vi.dynamicImportSettled()
    expect(listShepherdAgents).toHaveBeenCalledWith('P-1')
  })

  it('uses listOpenCodeModels to populate model dropdown', async () => {
    const { listOpenCodeModels } = await import('../lib/ipc')
    renderCard(true)
    await vi.dynamicImportSettled()
    expect(listOpenCodeModels).toHaveBeenCalledWith('P-1')
  })
})
