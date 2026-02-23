import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SettingsPanel from './SettingsPanel.svelte'
import { activeProjectId, projects } from '../lib/stores'

vi.mock('../lib/ipc', () => ({
  getProjectConfig: vi.fn(),
  setProjectConfig: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  getAgents: vi.fn(() => Promise.resolve([{ name: 'build' }, { name: 'oracle' }])),
  getAllWhisperModelStatuses: vi.fn(() => Promise.resolve([])),
  setWhisperModel: vi.fn(),
}))

vi.mock('../lib/actions', () => ({
  loadActions: vi.fn(),
  saveActions: vi.fn(),
  createAction: vi.fn(),
  DEFAULT_ACTIONS: [
    { id: 'builtin-start-implementation', name: 'Start Implementation', prompt: 'Implement this task...', agent: null, builtin: true, enabled: true },
    { id: 'builtin-plan-design', name: 'Plan/Design', prompt: 'Analyze this task...', agent: null, builtin: true, enabled: true },
    { id: 'builtin-manual-testing', name: 'Manual Testing', prompt: 'Create a comprehensive manual testing plan...', agent: null, builtin: true, enabled: true },
  ],
}))

import { getProjectConfig } from '../lib/ipc'
import { loadActions, createAction, DEFAULT_ACTIONS } from '../lib/actions'

describe('SettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getProjectConfig).mockResolvedValue('')
    vi.mocked(loadActions).mockResolvedValue([])
    activeProjectId.set('test-project-id')
    projects.set([
      {
        id: 'test-project-id',
        name: 'Test Project',
        path: '/tmp/test',
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    ])
  })

  it('does not render JIRA credential fields', () => {
    render(SettingsPanel)
    
    expect(screen.queryByPlaceholderText('https://your-domain.atlassian.net')).toBeNull()
    expect(screen.queryByPlaceholderText('your@email.com')).toBeNull()
    expect(screen.queryByPlaceholderText('Your JIRA API token')).toBeNull()
  })

  it('does not render GitHub PAT field', () => {
    render(SettingsPanel)
    
    expect(screen.queryByPlaceholderText('ghp_...')).toBeNull()
  })

  it('renders Board ID field', () => {
    render(SettingsPanel)
    
    expect(screen.getByPlaceholderText('e.g. PROJ')).toBeTruthy()
  })

  it('renders Default Repository field', () => {
    render(SettingsPanel)
    
    expect(screen.getByPlaceholderText('owner/repo')).toBeTruthy()
  })

  it('renders additional instructions textarea', () => {
    render(SettingsPanel)
    expect(screen.getByPlaceholderText('Optional instructions prepended to the first prompt when starting a new task...')).toBeTruthy()
  })

  it('renders project name field', () => {
    render(SettingsPanel)
    
    expect(screen.getByPlaceholderText('My Project')).toBeTruthy()
  })

  it('renders actions section with defaults', async () => {
    vi.mocked(loadActions).mockResolvedValue(DEFAULT_ACTIONS)
    
    render(SettingsPanel)
    
    await vi.waitFor(() => {
      expect(screen.getByText('Start Implementation')).toBeTruthy()
    })
    
    expect(screen.getByText('Plan/Design')).toBeTruthy()
    expect(screen.getByText('Manual Testing')).toBeTruthy()
  })

  it('add action creates new entry', async () => {
    const mockActions = [...DEFAULT_ACTIONS]
    vi.mocked(loadActions).mockResolvedValue(mockActions)
    vi.mocked(createAction).mockReturnValue({
      id: 'new-action-id',
      name: 'New Action',
      prompt: '',
      agent: null,
      builtin: false,
      enabled: true,
    })
    
    render(SettingsPanel)
    
    await vi.waitFor(() => {
      expect(screen.getByText('Start Implementation')).toBeTruthy()
    })
    
    const addButton = screen.getByRole('button', { name: /add action/i })
    await fireEvent.click(addButton)
    
    await vi.waitFor(() => {
      expect(screen.getByDisplayValue('New Action')).toBeTruthy()
    })
  })
})
