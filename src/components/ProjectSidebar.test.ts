import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Project, ProjectAttention } from '../lib/types'

const mockProjects = writable<Project[]>([])
const mockActiveProjectId = writable<string | null>(null)
const mockProjectAttention = writable<Map<string, ProjectAttention>>(new Map())

vi.mock('../lib/stores', () => ({
  projects: mockProjects,
  activeProjectId: mockActiveProjectId,
  projectAttention: mockProjectAttention,
}))

const mockGetProjectAttention = vi.fn(async () => [])

vi.mock('../lib/ipc', () => ({
  getProjectAttention: mockGetProjectAttention,
}))

const sampleProjects: Project[] = [
  { id: 'proj-1', name: 'Alpha Project', path: '/users/alice/alpha', created_at: 0, updated_at: 0 },
  { id: 'proj-2', name: 'Beta Project', path: '/users/bob/beta', created_at: 0, updated_at: 0 },
  { id: 'proj-3', name: 'Gamma Repo', path: '/users/carol/gamma', created_at: 0, updated_at: 0 },
]

describe('ProjectSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjects.set(sampleProjects)
    mockActiveProjectId.set('proj-1')
    mockProjectAttention.set(new Map())
    mockGetProjectAttention.mockResolvedValue([])
  })

  it('renders all projects from store', async () => {
    const { default: ProjectSidebar } = await import('./ProjectSidebar.svelte')
    render(ProjectSidebar)

    expect(screen.getByText('Alpha Project')).toBeTruthy()
    expect(screen.getByText('Beta Project')).toBeTruthy()
    expect(screen.getByText('Gamma Repo')).toBeTruthy()
  })

  it('marks the active project row for accessibility', async () => {
    mockActiveProjectId.set('proj-2')
    const { default: ProjectSidebar } = await import('./ProjectSidebar.svelte')
    render(ProjectSidebar)

    const activeRow = screen.getByRole('button', { name: /beta project/i })
    expect(activeRow.getAttribute('aria-current')).toBe('true')
  })

  it('clicking a project sets activeProjectId', async () => {
    const { default: ProjectSidebar } = await import('./ProjectSidebar.svelte')
    render(ProjectSidebar)

    await fireEvent.click(screen.getByRole('button', { name: /gamma repo/i }))
    expect(get(mockActiveProjectId)).toBe('proj-3')
  })

  it('shows attention status from store data', async () => {
    mockProjectAttention.set(new Map([
      ['proj-1', { project_id: 'proj-1', needs_input: 0, running_agents: 2, ci_failures: 0, unaddressed_comments: 0, completed_agents: 0 }],
      ['proj-2', { project_id: 'proj-2', needs_input: 1, running_agents: 0, ci_failures: 0, unaddressed_comments: 0, completed_agents: 0 }],
    ]))

    const { default: ProjectSidebar } = await import('./ProjectSidebar.svelte')
    render(ProjectSidebar)

    expect(screen.getByText('2 running')).toBeTruthy()
    expect(screen.getByText('1 needs input')).toBeTruthy()
  })

  it('shows idle when no attention data exists', async () => {
    const { default: ProjectSidebar } = await import('./ProjectSidebar.svelte')
    render(ProjectSidebar)

    const idleStatuses = screen.getAllByText('idle')
    expect(idleStatuses.length).toBe(3)
  })

  it('shows idle when attention exists but all counters are zero', async () => {
    mockProjectAttention.set(new Map([
      ['proj-1', { project_id: 'proj-1', needs_input: 0, running_agents: 0, ci_failures: 0, unaddressed_comments: 0, completed_agents: 0 }],
    ]))

    const { default: ProjectSidebar } = await import('./ProjectSidebar.svelte')
    render(ProjectSidebar)

    expect(screen.getAllByText('idle').length).toBe(3)
  })

  it('calls onNewProject when + button is clicked', async () => {
    const onNewProject = vi.fn()
    const { default: ProjectSidebar } = await import('./ProjectSidebar.svelte')
    render(ProjectSidebar, { props: { onNewProject } })

    await fireEvent.click(screen.getByRole('button', { name: /add project/i }))
    expect(onNewProject).toHaveBeenCalledOnce()
  })

  it('calls getProjectAttention on mount', async () => {
    const { default: ProjectSidebar } = await import('./ProjectSidebar.svelte')
    render(ProjectSidebar)

    await vi.waitFor(() => {
      expect(mockGetProjectAttention).toHaveBeenCalledOnce()
    })
  })
})
