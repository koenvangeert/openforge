import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'

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
    { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
  ],
}))

vi.mock('../lib/boardColumns', () => ({
  loadBoardColumns: vi.fn(() => Promise.resolve([])),
  saveBoardColumns: vi.fn(() => Promise.resolve(undefined)),
  validateBoardColumns: vi.fn(() => ({ valid: true, errors: [] })),
  ALL_TASK_STATES: ['idle', 'active', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted', 'pr-draft', 'pr-open', 'ci-running', 'review-pending', 'ci-failed', 'changes-requested', 'unaddressed-comments', 'ready-to-merge', 'pr-queued', 'pr-merged'],
  TASK_STATE_LABELS: {
    idle: 'Idle', active: 'Running', 'needs-input': 'Needs Input', 'paused': 'Paused',
    'agent-done': 'Agent Done', 'failed': 'Failed', 'interrupted': 'Interrupted', 'pr-draft': 'PR Draft',
    'pr-open': 'PR Open', 'ci-running': 'CI Running', 'review-pending': 'Awaiting Review',
    'ci-failed': 'CI Failed', 'changes-requested': 'Changes Requested', 'unaddressed-comments': 'Unaddressed Comments',
    'ready-to-merge': 'Ready to Merge', 'pr-queued': 'In Merge Queue', 'pr-merged': 'PR Merged',
  },
  DEFAULT_BOARD_COLUMNS: [],
}))

vi.mock('../lib/boardFilters', () => ({
  loadFocusFilterStates: vi.fn(() => Promise.resolve(['idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted', 'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments', 'ready-to-merge', 'pr-merged'])),
  saveFocusFilterStates: vi.fn(() => Promise.resolve(undefined)),
  DEFAULT_FOCUS_STATES: ['idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted', 'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments', 'ready-to-merge', 'pr-merged'],
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

  it('renders AI section', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/ai/i).length).toBeGreaterThan(0)
  })

  it('renders Credentials section on global page', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    expect(screen.queryAllByText(/credentials/i).length).toBeGreaterThan(0)
  })

  it('renders Actions section', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/actions/i).length).toBeGreaterThan(0)
  })

  it('renders General section card', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/general/i).length).toBeGreaterThan(0)
  })

  it('renders Integrations section card', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/integrations/i).length).toBeGreaterThan(0)
  })

  it('renders Instructions section card', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/instructions/i).length).toBeGreaterThan(0)
  })

  it('does not render sidebar nav in global mode', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    const links = screen.queryAllByRole('link')
    expect(links.length).toBe(0)
  })

  it('does not render sidebar nav with Credentials link on global page', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    const links = screen.queryAllByRole('link')
    expect(links.length).toBe(0)
  })

  it('renders Actions section card', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/actions/i).length).toBeGreaterThan(0)
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
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    expect(screen.getByPlaceholderText('https://your-domain.atlassian.net')).toBeTruthy()
  })

  it('renders JIRA username field on global page', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    expect(screen.getByPlaceholderText('your@email.com')).toBeTruthy()
  })

  it('renders JIRA API token field on global page', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    expect(screen.getByPlaceholderText('Your JIRA API token')).toBeTruthy()
  })

  it('renders GitHub PAT field on global page', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    expect(screen.getByPlaceholderText('ghp_...')).toBeTruthy()
  })

  it('shows Project Settings header when project is active', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByText('Test Project — Settings')).toBeTruthy()
  })

  it('shows Global Settings header when no project is active', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    expect(screen.queryAllByText(/global settings/i).length).toBeGreaterThan(0)
  })

  it('renders project name in header in project mode', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByText(/Test Project/)).toBeTruthy()
  })

  it('does not render sidebar Global group label in global mode', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    const links = screen.queryAllByRole('link')
    expect(links.length).toBe(0)
  })

  it('does not show global cards on project page', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryByPlaceholderText('https://your-domain.atlassian.net')).toBeNull()
  })

  it('does not show project cards on global page', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    expect(screen.queryByPlaceholderText('My Project')).toBeNull()
  })

  it('does not render a Save Settings button (auto-save replaces it)', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryByRole('button', { name: /save settings/i })).toBeNull()
  })

  describe('auto-save', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('saves project settings after debounce when a field changes', async () => {
      render(SettingsView, { props: defaultProps })

      await vi.advanceTimersByTimeAsync(50)
      vi.mocked(setProjectConfig).mockClear()
      vi.mocked(setConfig).mockClear()
      vi.mocked(updateProject).mockClear()

      const nameInput = screen.getByPlaceholderText('My Project')
      await fireEvent.input(nameInput, { target: { value: 'New Name' } })

      expect(vi.mocked(setProjectConfig)).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(600)

      expect(vi.mocked(updateProject)).toHaveBeenCalled()
      expect(vi.mocked(setProjectConfig)).toHaveBeenCalled()
      expect(vi.mocked(setConfig)).toHaveBeenCalled()
    })

    it('updates projects store with new name and path after save', async () => {
      render(SettingsView, { props: defaultProps })

      await vi.advanceTimersByTimeAsync(50)
      vi.mocked(updateProject).mockClear()

      const nameInput = screen.getByPlaceholderText('My Project')
      await fireEvent.input(nameInput, { target: { value: 'Updated Name' } })

      await vi.advanceTimersByTimeAsync(600)

      const updatedProject = get(projects).find(p => p.id === 'test-project-id')
      expect(updatedProject?.name).toBe('Updated Name')
      expect(updatedProject?.path).toBe('/tmp/test')
      expect(get(projects).length).toBe(1)
    })

    it('saves global settings after debounce when a field changes', async () => {
      activeProjectId.set(null)
      projects.set([])
      render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

      await vi.advanceTimersByTimeAsync(50)
      vi.mocked(setConfig).mockClear()

      const jiraInput = screen.getByPlaceholderText('https://your-domain.atlassian.net')
      await fireEvent.input(jiraInput, { target: { value: 'https://test.atlassian.net' } })

      await vi.advanceTimersByTimeAsync(600)

      expect(vi.mocked(setConfig)).toHaveBeenCalled()
    })

    it('resets debounce when multiple changes happen quickly', async () => {
      render(SettingsView, { props: defaultProps })

      await vi.advanceTimersByTimeAsync(50)
      vi.mocked(setProjectConfig).mockClear()
      vi.mocked(setConfig).mockClear()
      vi.mocked(updateProject).mockClear()

      const nameInput = screen.getByPlaceholderText('My Project')

      await fireEvent.input(nameInput, { target: { value: 'A' } })
      await vi.advanceTimersByTimeAsync(200)
      await fireEvent.input(nameInput, { target: { value: 'AB' } })
      await vi.advanceTimersByTimeAsync(200)
      await fireEvent.input(nameInput, { target: { value: 'ABC' } })

      expect(vi.mocked(updateProject)).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(600)

      expect(vi.mocked(updateProject)).toHaveBeenCalledTimes(1)
    })
  })

  it('renders Add Action button', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByRole('button', { name: /add action/i })).toBeTruthy()
  })

  it('clicking Add Action creates a new action entry', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])
    vi.mocked(createAction).mockReturnValue({
      id: 'new-action-id',
      name: 'New Action',
      prompt: '',
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
      { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThan(0)
  })

  it('JIRA API token field has type=password on global page', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    const apiTokenInput = screen.getByPlaceholderText('Your JIRA API token') as HTMLInputElement
    expect(apiTokenInput.type).toBe('password')
  })

  it('GitHub PAT field has type=password on global page', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    const patInput = screen.getByPlaceholderText('ghp_...') as HTMLInputElement
    expect(patInput.type).toBe('password')
  })

  it('renders Whisper model selector on global page', async () => {
    activeProjectId.set(null)
    projects.set([])
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

    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

    await vi.waitFor(() => {
      expect(screen.queryAllByText(/tiny/i).length).toBeGreaterThan(0)
    })
  })

  it('renders a Delete Project button in the danger zone', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByRole('button', { name: /delete project/i })).toBeTruthy()
  })

  it('defaults to global page when activeProjectId is null', () => {
    activeProjectId.set(null)
    projects.set([])

    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

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

  describe('Board layout setting', () => {
    it('renders board layout select with Kanban as default', async () => {
      vi.mocked(getProjectConfig).mockResolvedValue(null)
      render(SettingsView, { props: defaultProps })

      await vi.waitFor(() => {
        const select = screen.getByTestId('board-layout-select') as HTMLSelectElement
        expect(select).toBeTruthy()
        expect(select.value).toBe('kanban')
      })
    })

    it('renders board layout select with Focus Flow option', async () => {
      vi.mocked(getProjectConfig).mockResolvedValue(null)
      render(SettingsView, { props: defaultProps })

      await vi.waitFor(() => {
        const options = screen.getAllByRole('option')
        const focusOption = options.find((opt) => opt.textContent?.includes('Focus Flow'))
        expect(focusOption).toBeTruthy()
      })
    })

    it('saves focus layout when changed to Focus Flow', async () => {
      vi.useFakeTimers()
      vi.mocked(getProjectConfig).mockResolvedValue(null)
      render(SettingsView, { props: defaultProps })

      await vi.advanceTimersByTimeAsync(50)
      vi.mocked(setProjectConfig).mockClear()

      const select = screen.getByTestId('board-layout-select') as HTMLSelectElement
      await fireEvent.change(select, { target: { value: 'focus' } })

      await vi.advanceTimersByTimeAsync(600)

      expect(vi.mocked(setProjectConfig)).toHaveBeenCalledWith(
        'test-project-id',
        'board_layout',
        'focus'
      )

      vi.useRealTimers()
    })

    it('saves kanban layout when changed back to Kanban', async () => {
      vi.useFakeTimers()
      vi.mocked(getProjectConfig).mockImplementation((_pid, key) => {
        if (key === 'board_layout') return Promise.resolve('focus')
        return Promise.resolve(null)
      })
      render(SettingsView, { props: defaultProps })

      await vi.advanceTimersByTimeAsync(50)
      vi.mocked(setProjectConfig).mockClear()

      const select = screen.getByTestId('board-layout-select') as HTMLSelectElement
      await fireEvent.change(select, { target: { value: 'kanban' } })

      await vi.advanceTimersByTimeAsync(600)

      expect(vi.mocked(setProjectConfig)).toHaveBeenCalledWith(
        'test-project-id',
        'board_layout',
        'kanban'
      )

      vi.useRealTimers()
    })

    it('loads focus layout from config', async () => {
      vi.mocked(getProjectConfig).mockImplementation((_pid, key) => {
        if (key === 'board_layout') return Promise.resolve('focus')
        return Promise.resolve(null)
      })
      render(SettingsView, { props: defaultProps })

      await vi.waitFor(() => {
        const select = screen.getByTestId('board-layout-select') as HTMLSelectElement
        expect(select.value).toBe('focus')
      })
    })
  })
})
