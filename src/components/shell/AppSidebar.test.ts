import { fireEvent, render, screen } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getProjectAttention, setConfig } from '../../lib/ipc'
import { activeProjectId, projectAttention, projects } from '../../lib/stores'
import type { AppView, Project, ProjectAttention } from '../../lib/types'
import AppSidebar from './AppSidebar.svelte'

vi.mock('../../lib/stores', async () => {
  const { writable } = await import('svelte/store')
  return {
    projects: writable<Project[]>([]),
    activeProjectId: writable<string | null>(null),
    projectAttention: writable<Map<string, ProjectAttention>>(new Map()),
  }
})

vi.mock('../../lib/ipc', () => ({
  getProjectAttention: vi.fn(async () => []),
  setConfig: vi.fn(async () => {}),
  getGitBranch: vi.fn(async () => 'main'),
}))

const { mockResetToBoard } = vi.hoisted(() => ({
  mockResetToBoard: vi.fn(),
}))

vi.mock('../../lib/router.svelte', () => ({
  resetToBoard: mockResetToBoard,
  useAppRouter: () => ({
    resetToBoard: mockResetToBoard,
  }),
}))

vi.mock('lucide-svelte', () => {
  const stub = vi.fn()
  return {
    ChevronLeft: stub,
    ChevronRight: stub,
    Settings: stub,
    Plus: stub,
    ArrowUp: stub,
    ArrowDown: stub,
  }
})

const sampleProjects: Project[] = [
  { id: 'proj-1', name: 'Alpha Project', path: '/users/alice/alpha', created_at: 0, updated_at: 0 },
  { id: 'proj-2', name: 'Beta Project', path: '/users/bob/beta', created_at: 0, updated_at: 0 },
  { id: 'proj-3', name: 'Gamma Project', path: '/users/charlie/gamma', created_at: 0, updated_at: 0 },
]

function renderSidebar(props?: Partial<{ collapsed: boolean; currentView: AppView; onToggleCollapse: () => void; onNewProject?: () => void; onNavigate: (view: AppView) => void }>) {
  const defaultProps = {
    collapsed: false,
    currentView: 'board' as AppView,
    onToggleCollapse: vi.fn(),
    onNewProject: vi.fn(),
    onNavigate: vi.fn(),
  }

  return render(AppSidebar, { props: { ...defaultProps, ...props } })
}

describe('AppSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    projects.set(sampleProjects)
    activeProjectId.set('proj-1')
    projectAttention.set(new Map())
    vi.mocked(getProjectAttention).mockResolvedValue([])
  })

  it('renders the >_ logo', () => {
    renderSidebar()
    expect(screen.getByText('>_')).toBeTruthy()
  })

  it('shows "PROJECTS" label when expanded (collapsed=false)', () => {
    renderSidebar({ collapsed: false })
    expect(screen.getByText('PROJECTS')).toBeTruthy()
  })

  it('does NOT show "PROJECTS" label when collapsed (collapsed=true)', () => {
    renderSidebar({ collapsed: true })
    expect(screen.queryByText('PROJECTS')).toBeNull()
  })

  it('shows "open_forge" text when expanded', () => {
    renderSidebar({ collapsed: false })
    expect(screen.getByText('open_forge')).toBeTruthy()
  })

  it('does NOT show "open_forge" text when collapsed', () => {
    renderSidebar({ collapsed: true })
    expect(screen.queryByText('open_forge')).toBeNull()
  })

  it('renders project buttons for each project in the store', () => {
    renderSidebar({ collapsed: false })

    expect(screen.getByRole('button', { name: /^alpha project$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^beta project$/i })).toBeTruthy()
  })

  it('shows first-letter avatars when collapsed', () => {
    renderSidebar({ collapsed: true })

    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText('B')).toBeTruthy()
  })

  it('shows project names when expanded', () => {
    renderSidebar({ collapsed: false })

    expect(screen.getByText('Alpha Project')).toBeTruthy()
    expect(screen.getByText('Beta Project')).toBeTruthy()
  })

  it('clicking a project button sets activeProjectId', async () => {
    renderSidebar({ collapsed: false })

    await fireEvent.click(screen.getByRole('button', { name: /^beta project$/i }))
    expect(get(activeProjectId)).toBe('proj-2')
  })

  it('clicking a project while on global_settings resets to board', async () => {
    const { resetToBoard } = await import('../../lib/router.svelte')
    vi.mocked(resetToBoard).mockClear()
    renderSidebar({ currentView: 'global_settings' })

    await fireEvent.click(screen.getByRole('button', { name: /^beta project$/i }))
    expect(resetToBoard).toHaveBeenCalled()
  })

  it('does not render Work Queue nav button', () => {
    renderSidebar()
    expect(screen.queryByRole('button', { name: /work queue/i })).toBeNull()
  })

  it('renders Settings nav button (labeled "Settings")', () => {
    renderSidebar()
    expect(screen.getByRole('button', { name: /settings/i })).toBeTruthy()
  })

  it('clicking Settings calls onNavigate(\'global_settings\')', async () => {
    const onNavigate = vi.fn()
    renderSidebar({ onNavigate })

    await fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(onNavigate).toHaveBeenCalledWith('global_settings')
  })

  it('clicking collapse toggle calls onToggleCollapse', async () => {
    const onToggleCollapse = vi.fn()
    renderSidebar({ collapsed: false, onToggleCollapse })

    await fireEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    expect(onToggleCollapse).toHaveBeenCalledOnce()
  })

  it('calls onNewProject when add project button is clicked', async () => {
    const onNewProject = vi.fn()
    renderSidebar({ onNewProject })

    await fireEvent.click(screen.getByRole('button', { name: /add project/i }))
    expect(onNewProject).toHaveBeenCalledOnce()
  })

  it('shows attention status from store data', () => {
    projectAttention.set(new Map([
      ['proj-1', { project_id: 'proj-1', needs_input: 0, running_agents: 2, ci_failures: 0, unaddressed_comments: 0, completed_agents: 0 }],
      ['proj-2', { project_id: 'proj-2', needs_input: 1, running_agents: 0, ci_failures: 0, unaddressed_comments: 0, completed_agents: 0 }],
    ]))

    renderSidebar({ collapsed: false })

    expect(screen.getByText('2 running')).toBeTruthy()
    expect(screen.getByText('1 needs input')).toBeTruthy()
  })

  it('calls getProjectAttention on mount', async () => {
    renderSidebar()

    await vi.waitFor(() => {
      expect(getProjectAttention).toHaveBeenCalledOnce()
    })
  })

  it('project is NOT visually active (aria-current) when on global_settings view', () => {
    renderSidebar({ currentView: 'global_settings' })

    const activeProjectButton = screen.getByRole('button', { name: /^alpha project$/i })
    expect(activeProjectButton.getAttribute('aria-current')).toBeNull()
  })

  it('project IS visually active (aria-current) when on board view', () => {
    renderSidebar({ currentView: 'board' })

    const activeProjectButton = screen.getByRole('button', { name: /^alpha project$/i })
    expect(activeProjectButton.getAttribute('aria-current')).toBe('true')
  })

  describe('Project reordering', () => {
    it('does not show move buttons when collapsed', () => {
      renderSidebar({ collapsed: true })
      expect(screen.queryByLabelText(/Move Alpha Project up/i)).toBeNull()
      expect(screen.queryByLabelText(/Move Alpha Project down/i)).toBeNull()
    })

    it('shows move buttons when expanded', () => {
      renderSidebar({ collapsed: false })
      expect(screen.queryByLabelText(/Move Alpha Project up/i)).toBeNull()
      expect(screen.getByLabelText(/Move Alpha Project down/i)).toBeTruthy()
      
      expect(screen.getByLabelText(/Move Beta Project up/i)).toBeTruthy()
      expect(screen.getByLabelText(/Move Beta Project down/i)).toBeTruthy()
      
      expect(screen.getByLabelText(/Move Gamma Project up/i)).toBeTruthy()
      expect(screen.queryByLabelText(/Move Gamma Project down/i)).toBeNull()
    })

    it('moves a project down', async () => {
      renderSidebar({ collapsed: false })
      await fireEvent.click(screen.getByLabelText(/Move Alpha Project down/i))
      
      const currentProjects = get(projects)
      expect(currentProjects[0].id).toBe('proj-2')
      expect(currentProjects[1].id).toBe('proj-1')
      expect(currentProjects[2].id).toBe('proj-3')
      
      expect(setConfig).toHaveBeenCalledWith('project_sidebar_order', JSON.stringify(['proj-2', 'proj-1', 'proj-3']))
    })

    it('moves a project up', async () => {
      renderSidebar({ collapsed: false })
      await fireEvent.click(screen.getByLabelText(/Move Gamma Project up/i))
      
      const currentProjects = get(projects)
      expect(currentProjects[0].id).toBe('proj-1')
      expect(currentProjects[1].id).toBe('proj-3')
      expect(currentProjects[2].id).toBe('proj-2')

      expect(setConfig).toHaveBeenCalledWith('project_sidebar_order', JSON.stringify(['proj-1', 'proj-3', 'proj-2']))
    })

    it('reverts the optimistic order if persisting fails', async () => {
      vi.mocked(setConfig).mockRejectedValueOnce(new Error('save failed'))

      renderSidebar({ collapsed: false })
      await fireEvent.click(screen.getByLabelText(/Move Alpha Project down/i))

      expect(get(projects).map((project) => project.id)).toEqual(['proj-1', 'proj-2', 'proj-3'])
    })

    it('disables further reordering while a save is in progress', async () => {
      let resolveSave!: () => void
      vi.mocked(setConfig).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve
          })
      )

      renderSidebar({ collapsed: false })
      await fireEvent.click(screen.getByLabelText(/Move Alpha Project down/i))

      const alphaMoveUpButton = screen.getByLabelText(/Move Alpha Project up/i)
      expect(alphaMoveUpButton.hasAttribute('disabled')).toBe(true)

      await fireEvent.click(alphaMoveUpButton)
      expect(get(projects).map((project) => project.id)).toEqual(['proj-2', 'proj-1', 'proj-3'])
      expect(setConfig).toHaveBeenCalledTimes(1)

      resolveSave()
    })
  })
})
