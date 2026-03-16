import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import AppSidebar from './AppSidebar.svelte'
import type { AppView, Project, ProjectAttention } from '../lib/types'
import { projects, activeProjectId, projectAttention } from '../lib/stores'
import { getProjectAttention } from '../lib/ipc'

vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store')
  return {
    projects: writable<Project[]>([]),
    activeProjectId: writable<string | null>(null),
    projectAttention: writable<Map<string, ProjectAttention>>(new Map()),
  }
})

vi.mock('../lib/ipc', () => ({
  getProjectAttention: vi.fn(async () => []),
}))

vi.mock('lucide-svelte', () => {
  const stub = vi.fn()
  return {
    ChevronLeft: stub,
    ChevronRight: stub,
    ListChecks: stub,
    Settings: stub,
    Plus: stub,
  }
})

const sampleProjects: Project[] = [
  { id: 'proj-1', name: 'Alpha Project', path: '/users/alice/alpha', created_at: 0, updated_at: 0 },
  { id: 'proj-2', name: 'Beta Project', path: '/users/bob/beta', created_at: 0, updated_at: 0 },
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

    expect(screen.getByRole('button', { name: /alpha project/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /beta project/i })).toBeTruthy()
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

    await fireEvent.click(screen.getByRole('button', { name: /beta project/i }))
    expect(get(activeProjectId)).toBe('proj-2')
  })

  it('clicking a project while on workqueue navigates to board', async () => {
    const onNavigate = vi.fn()
    renderSidebar({ currentView: 'workqueue', onNavigate })

    await fireEvent.click(screen.getByRole('button', { name: /beta project/i }))
    expect(onNavigate).toHaveBeenCalledWith('board')
  })

  it('clicking a project while on global_settings navigates to board', async () => {
    const onNavigate = vi.fn()
    renderSidebar({ currentView: 'global_settings', onNavigate })

    await fireEvent.click(screen.getByRole('button', { name: /beta project/i }))
    expect(onNavigate).toHaveBeenCalledWith('board')
  })

  it('renders Work Queue nav button', () => {
    renderSidebar()
    expect(screen.getByRole('button', { name: /work queue/i })).toBeTruthy()
  })

  it('renders Settings nav button (labeled "Settings")', () => {
    renderSidebar()
    expect(screen.getByRole('button', { name: /settings/i })).toBeTruthy()
  })

  it('clicking Work Queue calls onNavigate(\'workqueue\')', async () => {
    const onNavigate = vi.fn()
    renderSidebar({ onNavigate })

    await fireEvent.click(screen.getByRole('button', { name: /work queue/i }))
    expect(onNavigate).toHaveBeenCalledWith('workqueue')
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

  it('project is NOT visually active (aria-current) when on workqueue view', () => {
    renderSidebar({ currentView: 'workqueue' })

    const activeProjectButton = screen.getByRole('button', { name: /alpha project/i })
    expect(activeProjectButton.getAttribute('aria-current')).toBeNull()
  })

  it('project is NOT visually active (aria-current) when on global_settings view', () => {
    renderSidebar({ currentView: 'global_settings' })

    const activeProjectButton = screen.getByRole('button', { name: /alpha project/i })
    expect(activeProjectButton.getAttribute('aria-current')).toBeNull()
  })

  it('project IS visually active (aria-current) when on board view', () => {
    renderSidebar({ currentView: 'board' })

    const activeProjectButton = screen.getByRole('button', { name: /alpha project/i })
    expect(activeProjectButton.getAttribute('aria-current')).toBe('true')
  })
})
