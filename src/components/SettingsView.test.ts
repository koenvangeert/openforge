import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'

vi.mock('../lib/ipc', () => ({
  getProjectConfig: vi.fn(),
  setProjectConfig: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  getAgents: vi.fn(() => Promise.resolve([{ name: 'build' }, { name: 'oracle' }])),
  getConfig: vi.fn(() => Promise.resolve(null)),
  setConfig: vi.fn(() => Promise.resolve(undefined)),
  checkOpenCodeInstalled: vi.fn(() => Promise.resolve({ installed: false, path: null, version: null })),
  checkClaudeInstalled: vi.fn(() => Promise.resolve({ installed: false, path: null, version: null, authenticated: false })),
  getAllWhisperModelStatuses: vi.fn(() => Promise.resolve([])),
  setWhisperModel: vi.fn(),
}))

vi.mock('../lib/actions', () => ({
  loadActions: vi.fn(),
  saveActions: vi.fn(),
  createAction: vi.fn(),
  DEFAULT_ACTIONS: [
    { id: 'builtin-go', name: 'Go', prompt: '', agent: null, builtin: true, enabled: true },
  ],
}))

vi.mock('../lib/stores', () => ({
  activeProjectId: writable('test-project-id'),
  projects: writable([
    {
      id: 'test-project-id',
      name: 'Test Project',
      path: '/tmp/test',
      created_at: Date.now(),
      updated_at: Date.now(),
    },
  ]),
  codeCleanupTasksEnabled: writable(false),
}))

import SettingsView from './SettingsView.svelte'
import { getProjectConfig, setProjectConfig, updateProject, deleteProject, getConfig, setConfig, getAllWhisperModelStatuses } from '../lib/ipc'
import { loadActions, saveActions, createAction } from '../lib/actions'
import { activeProjectId, projects } from '../lib/stores'

const defaultProps = {
  onClose: vi.fn(),
  onProjectDeleted: vi.fn(),
  mode: 'project' as const,
}

const globalProps = {
  onClose: vi.fn(),
  onProjectDeleted: vi.fn(),
  mode: 'global' as const,
}

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    vi.mocked(getConfig).mockResolvedValue(null)
    vi.mocked(setProjectConfig).mockResolvedValue(undefined)
    vi.mocked(setConfig).mockResolvedValue(undefined)
    vi.mocked(updateProject).mockResolvedValue(undefined)
    vi.mocked(deleteProject).mockResolvedValue(undefined)
    vi.mocked(getAllWhisperModelStatuses).mockResolvedValue([])
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

  it('renders General section', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/general/i).length).toBeGreaterThan(0)
  })

  it('renders Integrations section', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/integrations/i).length).toBeGreaterThan(0)
  })

  it('renders Instructions section', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/instructions/i).length).toBeGreaterThan(0)
  })

  it('renders AI section in global mode', () => {
    render(SettingsView, { props: globalProps })
    expect(screen.queryAllByText(/ai/i).length).toBeGreaterThan(0)
  })

  it('renders Credentials section in global mode', () => {
    render(SettingsView, { props: globalProps })
    expect(screen.queryAllByText(/credentials/i).length).toBeGreaterThan(0)
  })

  it('renders Actions section', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/actions/i).length).toBeGreaterThan(0)
  })

  it('renders sidebar nav with General link', () => {
    render(SettingsView, { props: defaultProps })
    const links = screen.getAllByRole('link')
    const texts = links.map((l) => l.textContent ?? '')
    expect(texts.some((t) => /general/i.test(t))).toBe(true)
  })

  it('renders sidebar nav with Integrations link', () => {
    render(SettingsView, { props: defaultProps })
    const links = screen.getAllByRole('link')
    const texts = links.map((l) => l.textContent ?? '')
    expect(texts.some((t) => /integrations/i.test(t))).toBe(true)
  })

  it('renders sidebar nav with Instructions link', () => {
    render(SettingsView, { props: defaultProps })
    const links = screen.getAllByRole('link')
    const texts = links.map((l) => l.textContent ?? '')
    expect(texts.some((t) => /instructions/i.test(t))).toBe(true)
  })

  it('renders sidebar nav with Voice link in global mode', () => {
    render(SettingsView, { props: globalProps })
    const links = screen.getAllByRole('link')
    const texts = links.map((l: HTMLElement) => l.textContent ?? '')
    expect(texts.some((t: string) => /voice/i.test(t))).toBe(true)
  })

  it('renders sidebar nav with Credentials link in global mode', () => {
    render(SettingsView, { props: globalProps })
    const links = screen.getAllByRole('link')
    const texts = links.map((l: HTMLElement) => l.textContent ?? '')
    expect(texts.some((t: string) => /credentials/i.test(t))).toBe(true)
  })

  it('renders sidebar nav with Actions link', () => {
    render(SettingsView, { props: defaultProps })
    const links = screen.getAllByRole('link')
    const texts = links.map((l: HTMLElement) => l.textContent ?? '')
    expect(texts.some((t: string) => /actions/i.test(t))).toBe(true)
  })

  it('renders project name field', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByPlaceholderText('My Project')).toBeTruthy()
  })

  it('renders project path field', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByPlaceholderText('/path/to/project')).toBeTruthy()
  })

  it('renders JIRA board ID field', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByPlaceholderText('e.g. PROJ')).toBeTruthy()
  })

  it('renders GitHub repository field', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByPlaceholderText('owner/repo')).toBeTruthy()
  })

  it('renders AI instructions textarea', () => {
    render(SettingsView, { props: defaultProps })
    expect(
      screen.getByPlaceholderText(
        'Optional instructions prepended to the first prompt when starting a new task...'
      )
    ).toBeTruthy()
  })

  it('renders JIRA base URL field on global page', () => {
    render(SettingsView, { props: globalProps })
    expect(screen.getByPlaceholderText('https://your-domain.atlassian.net')).toBeTruthy()
  })

  it('renders JIRA username field on global page', () => {
    render(SettingsView, { props: globalProps })
    expect(screen.getByPlaceholderText('your@email.com')).toBeTruthy()
  })

  it('renders JIRA API token field on global page', () => {
    render(SettingsView, { props: globalProps })
    expect(screen.getByPlaceholderText('Your JIRA API token')).toBeTruthy()
  })

  it('renders GitHub PAT field on global page', () => {
    render(SettingsView, { props: globalProps })
    expect(screen.getByPlaceholderText('ghp_...')).toBeTruthy()
  })

  it('shows Project Settings header when project is active', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/project settings/i).length).toBeGreaterThan(0)
  })

  it('shows Global Settings header in global mode', () => {
    render(SettingsView, { props: globalProps })
    expect(screen.queryAllByText(/global settings/i).length).toBeGreaterThan(0)
  })

  it('sidebar shows Project label in project mode and Global label in global mode', () => {
    const { unmount } = render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/^project settings$/i).length).toBeGreaterThan(0)
    unmount()
    render(SettingsView, { props: globalProps })
    expect(screen.queryAllByText(/^global settings$/i).length).toBeGreaterThan(0)
  })

  it('does not show global cards on project page', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryByPlaceholderText('https://your-domain.atlassian.net')).toBeNull()
  })

  it('does not show project cards on global page', () => {
    render(SettingsView, { props: globalProps })
    expect(screen.queryByPlaceholderText('My Project')).toBeNull()
  })

  it('renders a single Save Settings button', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByRole('button', { name: /save settings/i })).toBeTruthy()
  })

  it('clicking Save calls setProjectConfig and setConfig', async () => {
    render(SettingsView, { props: defaultProps })

    await new Promise((r) => setTimeout(r, 50))

    const saveBtn = screen.getByRole('button', { name: /save settings/i })
    await fireEvent.click(saveBtn)

    await new Promise((r) => setTimeout(r, 50))

    expect(vi.mocked(setConfig)).toHaveBeenCalled()
    expect(vi.mocked(setProjectConfig)).toHaveBeenCalled()
  })

  it('renders Add Action button', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByRole('button', { name: /add action/i })).toBeTruthy()
  })

  it('clicking Add Action creates a new action entry', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', agent: null, builtin: true, enabled: true },
    ])
    vi.mocked(createAction).mockReturnValue({
      id: 'new-action-id',
      name: 'New Action',
      prompt: '',
      agent: null,
      builtin: false,
      enabled: true,
    })

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })

    const addButton = screen.getByRole('button', { name: /add action/i })
    await fireEvent.click(addButton)

    await vi.waitFor(() => {
      expect(screen.getByDisplayValue('New Action')).toBeTruthy()
    })
  })

  it('renders action toggle checkboxes', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', agent: null, builtin: true, enabled: true },
    ])

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThan(0)
  })

  it('JIRA API token field has type=password on global page', () => {
    render(SettingsView, { props: globalProps })
    const apiTokenInput = screen.getByPlaceholderText('Your JIRA API token') as HTMLInputElement
    expect(apiTokenInput.type).toBe('password')
  })

  it('GitHub PAT field has type=password on global page', () => {
    render(SettingsView, { props: globalProps })
    const patInput = screen.getByPlaceholderText('ghp_...') as HTMLInputElement
    expect(patInput.type).toBe('password')
  })

  it('renders Whisper model selector on global page', async () => {
    vi.mocked(getAllWhisperModelStatuses).mockResolvedValue([
      {
        size: 'tiny',
        display_name: 'Tiny',
        disk_size_mb: 39,
        ram_usage_mb: 125,
        downloaded: true,
        model_path: '/tmp/tiny.bin',
        model_size_bytes: 40960000,
        model_name: 'ggml-tiny',
        is_active: true,
      },
    ])

    render(SettingsView, { props: globalProps })

    await vi.waitFor(() => {
      expect(screen.queryAllByText(/tiny/i).length).toBeGreaterThan(0)
    })
  })

  it('renders a Delete Project button in the danger zone', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByRole('button', { name: /delete project/i })).toBeTruthy()
  })

  it('global mode shows global fields and hides project fields', () => {
    render(SettingsView, { props: globalProps })

    expect(screen.queryByPlaceholderText('My Project')).toBeNull()
    expect(screen.getByPlaceholderText('https://your-domain.atlassian.net')).toBeTruthy()
  })

  it('reset to defaults shows only one confirm dialog', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })

    const resetButton = screen.getByRole('button', { name: /reset to defaults/i })
    await fireEvent.click(resetButton)

    expect(confirmSpy).toHaveBeenCalledTimes(1)

    confirmSpy.mockRestore()
  })

  it('deleting a builtin action shows only one confirm dialog', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })

    const deleteButton = screen.getByTitle('Delete action')
    await fireEvent.click(deleteButton)

    expect(confirmSpy).toHaveBeenCalledTimes(1)

    confirmSpy.mockRestore()
  })

  it('reset to defaults auto-saves actions', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'custom-1', name: 'Custom', prompt: 'test', builtin: false, enabled: true },
    ])
    vi.mocked(saveActions).mockResolvedValue(undefined)

    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByDisplayValue('Custom')).toBeTruthy()
    })

    const resetButton = screen.getByRole('button', { name: /reset to defaults/i })
    await fireEvent.click(resetButton)

    await vi.waitFor(() => {
      expect(saveActions).toHaveBeenCalledWith('test-project-id', expect.any(Array))
    })

    window.confirm = globalThis.confirm
  })

  it('deleting a builtin action auto-saves actions', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])
    vi.mocked(saveActions).mockResolvedValue(undefined)

    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })

    vi.mocked(saveActions).mockClear()

    const deleteButton = screen.getByTitle('Delete action')
    await fireEvent.click(deleteButton)

    await vi.waitFor(() => {
      expect(saveActions).toHaveBeenCalledWith('test-project-id', [])
    })

    window.confirm = globalThis.confirm
  })
})
