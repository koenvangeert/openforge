import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/ipc', () => ({
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
  checkOpenCodeInstalled: vi.fn().mockResolvedValue({ installed: false, path: null, version: null }),
  checkClaudeInstalled: vi.fn().mockResolvedValue({ installed: false, path: null, version: null, authenticated: false }),
}))

import GlobalSettingsPanel from './GlobalSettingsPanel.svelte'
import { getConfig, setConfig } from '../lib/ipc'

describe('GlobalSettingsPanel', () => {
  beforeEach(() => {
    vi.mocked(getConfig).mockClear()
    vi.mocked(setConfig).mockClear()
    vi.mocked(getConfig).mockResolvedValue(null)
    vi.mocked(setConfig).mockResolvedValue(undefined)
  })

  it('renders JIRA section with base URL, username, and API token fields', () => {
    render(GlobalSettingsPanel)
    
    expect(screen.getByText('JIRA')).toBeTruthy()
    expect(screen.getByPlaceholderText('https://your-domain.atlassian.net')).toBeTruthy()
    expect(screen.getByPlaceholderText('your@email.com')).toBeTruthy()
    expect(screen.getByPlaceholderText('Your JIRA API token')).toBeTruthy()
  })

  it('renders GitHub section with PAT field', () => {
    render(GlobalSettingsPanel)
    
    expect(screen.getByText('GitHub')).toBeTruthy()
    expect(screen.getByPlaceholderText('ghp_...')).toBeTruthy()
  })

  it('renders API token and PAT as password fields', () => {
    render(GlobalSettingsPanel)
    
    const apiTokenInput = screen.getByPlaceholderText('Your JIRA API token') as HTMLInputElement
    expect(apiTokenInput.type).toBe('password')
    
    const patInput = screen.getByPlaceholderText('ghp_...') as HTMLInputElement
    expect(patInput.type).toBe('password')
  })

  it('renders save button', () => {
    render(GlobalSettingsPanel)
    
    expect(screen.getByRole('button', { name: 'Save Settings' })).toBeTruthy()
  })

  it('renders all 4 credential input fields', () => {
    render(GlobalSettingsPanel)
    
    const baseUrlInput = screen.getByPlaceholderText('https://your-domain.atlassian.net') as HTMLInputElement
    const usernameInput = screen.getByPlaceholderText('your@email.com') as HTMLInputElement
    const apiTokenInput = screen.getByPlaceholderText('Your JIRA API token') as HTMLInputElement
    const patInput = screen.getByPlaceholderText('ghp_...') as HTMLInputElement
    
    expect(baseUrlInput).toBeTruthy()
    expect(usernameInput).toBeTruthy()
    expect(apiTokenInput).toBeTruthy()
    expect(patInput).toBeTruthy()
  })

  it('calls setConfig with correct keys on save', async () => {
    render(GlobalSettingsPanel)
    
    await new Promise((r) => setTimeout(r, 50))
    
    const baseUrlInput = screen.getByPlaceholderText('https://your-domain.atlassian.net') as HTMLInputElement
    const usernameInput = screen.getByPlaceholderText('your@email.com') as HTMLInputElement
    const apiTokenInput = screen.getByPlaceholderText('Your JIRA API token') as HTMLInputElement
    const patInput = screen.getByPlaceholderText('ghp_...') as HTMLInputElement
    
    await fireEvent.input(baseUrlInput, { target: { value: 'https://test.atlassian.net' } })
    await fireEvent.input(usernameInput, { target: { value: 'test@example.com' } })
    await fireEvent.input(apiTokenInput, { target: { value: 'token123' } })
    await fireEvent.input(patInput, { target: { value: 'ghp_abc123' } })
    
    const saveBtn = screen.getByRole('button', { name: 'Save Settings' })
    await fireEvent.click(saveBtn)
    
    await new Promise((r) => setTimeout(r, 50))
    
    expect(vi.mocked(setConfig)).toHaveBeenCalledWith('jira_base_url', 'https://test.atlassian.net')
    expect(vi.mocked(setConfig)).toHaveBeenCalledWith('jira_username', 'test@example.com')
    expect(vi.mocked(setConfig)).toHaveBeenCalledWith('jira_api_token', 'token123')
    expect(vi.mocked(setConfig)).toHaveBeenCalledWith('github_token', 'ghp_abc123')
    expect(vi.mocked(setConfig)).toHaveBeenCalledWith('ai_provider', 'opencode')
    expect(vi.mocked(setConfig)).toHaveBeenCalledTimes(5)
  })
})
