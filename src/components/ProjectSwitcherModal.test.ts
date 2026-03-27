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

const { mockResetToBoard } = vi.hoisted(() => ({
  mockResetToBoard: vi.fn(),
}))

vi.mock('../lib/router.svelte', () => ({
  resetToBoard: mockResetToBoard,
  useAppRouter: () => ({
    resetToBoard: mockResetToBoard,
  }),
}))

const sampleProjects: Project[] = [
  { id: 'proj-1', name: 'Alpha Project', path: '/users/alice/alpha', created_at: 0, updated_at: 0 },
  { id: 'proj-2', name: 'Beta Project', path: '/users/bob/beta', created_at: 0, updated_at: 0 },
  { id: 'proj-3', name: 'Gamma Repo', path: '/users/carol/gamma', created_at: 0, updated_at: 0 },
]

describe('ProjectSwitcherModal', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetProjectAttention.mockResolvedValue([])
    mockProjects.set(sampleProjects)
    mockActiveProjectId.set(null)
    mockProjectAttention.set(new Map())
  })

  describe('Rendering', () => {
    it('renders a dialog with search input', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      render(Modal, { props: { onClose: vi.fn() } })

      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeTruthy()

      const input = screen.getByPlaceholderText('Switch project...')
      expect(input).toBeTruthy()
    })

    it('auto-focuses the search input on mount', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      render(Modal, { props: { onClose: vi.fn() } })

      await vi.waitFor(() => {
        const input = screen.getByPlaceholderText('Switch project...')
        expect(document.activeElement).toBe(input)
      })
    })

    it('renders all project names from store', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      render(Modal, { props: { onClose: vi.fn() } })

      expect(screen.getByText('Alpha Project')).toBeTruthy()
      expect(screen.getByText('Beta Project')).toBeTruthy()
      expect(screen.getByText('Gamma Repo')).toBeTruthy()
    })

    it('shows empty state when no projects match search', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      render(Modal, { props: { onClose: vi.fn() } })

      const input = screen.getByPlaceholderText('Switch project...')
      await fireEvent.input(input, { target: { value: 'zzznomatch' } })

      expect(screen.getByText(/no projects match/i)).toBeTruthy()
    })

    it('shows checkmark for the currently active project', async () => {
      mockActiveProjectId.set('proj-2')
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      render(Modal, { props: { onClose: vi.fn() } })

      // The active project row should contain a checkmark
      const checkmarks = screen.getAllByText('✓')
      expect(checkmarks.length).toBeGreaterThan(0)
    })

    it('has aria-modal attribute for accessibility', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      render(Modal, { props: { onClose: vi.fn() } })

      const dialog = screen.getByRole('dialog')
      expect(dialog.getAttribute('aria-modal')).toBe('true')
    })
  })

  describe('Search filtering', () => {
    it('filters projects by name on input (case-insensitive)', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      render(Modal, { props: { onClose: vi.fn() } })

      const input = screen.getByPlaceholderText('Switch project...')
      await fireEvent.input(input, { target: { value: 'alpha' } })

      expect(screen.getByText('Alpha Project')).toBeTruthy()
      expect(screen.queryByText('Beta Project')).toBeNull()
      expect(screen.queryByText('Gamma Repo')).toBeNull()
    })

    it('filters case-insensitively with uppercase query', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      render(Modal, { props: { onClose: vi.fn() } })

      const input = screen.getByPlaceholderText('Switch project...')
      await fireEvent.input(input, { target: { value: 'BETA' } })

      expect(screen.queryByText('Alpha Project')).toBeNull()
      expect(screen.getByText('Beta Project')).toBeTruthy()
    })

    it('auto-selects first result when typing a search query', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      mockActiveProjectId.set(null)
      const onClose = vi.fn()
      render(Modal, { props: { onClose } })

      const input = screen.getByPlaceholderText('Switch project...')
      await fireEvent.input(input, { target: { value: 'beta' } })

      // First (and only) filtered result should be auto-selected — Enter selects it
      const dialog = screen.getByRole('dialog')
      await fireEvent.keyDown(dialog, { key: 'Enter' })

      expect(get(mockActiveProjectId)).toBe('proj-2')
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('shows all projects when search is empty', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      render(Modal, { props: { onClose: vi.fn() } })

      const input = screen.getByPlaceholderText('Switch project...')
      await fireEvent.input(input, { target: { value: 'alpha' } })
      await fireEvent.input(input, { target: { value: '' } })

      expect(screen.getByText('Alpha Project')).toBeTruthy()
      expect(screen.getByText('Beta Project')).toBeTruthy()
      expect(screen.getByText('Gamma Repo')).toBeTruthy()
    })
  })

  describe('Keyboard navigation', () => {
    it('pressing ArrowDown moves highlight to next item', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      render(Modal, { props: { onClose: vi.fn() } })

      const dialog = screen.getByRole('dialog')
      await fireEvent.keyDown(dialog, { key: 'ArrowDown' })

      // The first item (index 0) should now be highlighted
      // We verify by pressing Enter and checking which project gets selected
      const onClose = vi.fn()
      // Re-render fresh to avoid state bleed
      const { unmount } = render(Modal, { props: { onClose } })
      const dialog2 = screen.getAllByRole('dialog')[1]
      await fireEvent.keyDown(dialog2, { key: 'ArrowDown' })
      mockActiveProjectId.set(null) // reset

      // After ArrowDown, selectedIndex moves from -1 to 0
      // Enter on this should select first project
      await fireEvent.keyDown(dialog2, { key: 'Enter' })
      expect(get(mockActiveProjectId)).toBe('proj-1')
      unmount()
    })

    it('pressing ArrowUp from first item wraps to last', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      mockActiveProjectId.set(null)
      const onClose = vi.fn()
      render(Modal, { props: { onClose } })

      const dialog = screen.getByRole('dialog')
      // Go to first item
      await fireEvent.keyDown(dialog, { key: 'ArrowDown' })
      // Now go up — should wrap to last
      await fireEvent.keyDown(dialog, { key: 'ArrowUp' })
      await fireEvent.keyDown(dialog, { key: 'Enter' })

      expect(get(mockActiveProjectId)).toBe('proj-3')
    })

    it('pressing ArrowDown from last item wraps to first', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      mockActiveProjectId.set(null)
      const onClose = vi.fn()
      render(Modal, { props: { onClose } })

      const dialog = screen.getByRole('dialog')
      // Navigate to last item (3 downs from -1: 0,1,2)
      await fireEvent.keyDown(dialog, { key: 'ArrowDown' })
      await fireEvent.keyDown(dialog, { key: 'ArrowDown' })
      await fireEvent.keyDown(dialog, { key: 'ArrowDown' })
      // One more wraps to 0
      await fireEvent.keyDown(dialog, { key: 'ArrowDown' })
      await fireEvent.keyDown(dialog, { key: 'Enter' })

      expect(get(mockActiveProjectId)).toBe('proj-1')
    })
  })

  describe('Selection via Enter', () => {
    it('Enter on highlighted item sets activeProjectId, resets to board and calls onClose', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      const onClose = vi.fn()
      render(Modal, { props: { onClose } })

      const dialog = screen.getByRole('dialog')
      await fireEvent.keyDown(dialog, { key: 'ArrowDown' }) // select first
      await fireEvent.keyDown(dialog, { key: 'Enter' })

      expect(get(mockActiveProjectId)).toBe('proj-1')
      expect(mockResetToBoard).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('Enter with no item highlighted does nothing', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      const onClose = vi.fn()
      render(Modal, { props: { onClose } })

      const dialog = screen.getByRole('dialog')
      await fireEvent.keyDown(dialog, { key: 'Enter' }) // selectedIndex = -1

      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('Selection via click', () => {
    it('clicking a project row sets activeProjectId, resets to board and calls onClose', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      const onClose = vi.fn()
      render(Modal, { props: { onClose } })

      await fireEvent.click(screen.getByText('Beta Project'))

      expect(get(mockActiveProjectId)).toBe('proj-2')
      expect(mockResetToBoard).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledOnce()
    })
  })

  describe('Closing the modal', () => {
    it('Escape key calls onClose', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      const onClose = vi.fn()
      render(Modal, { props: { onClose } })

      const dialog = screen.getByRole('dialog')
      await fireEvent.keyDown(dialog, { key: 'Escape' })

      expect(onClose).toHaveBeenCalledOnce()
    })

    it('clicking the backdrop calls onClose', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      const onClose = vi.fn()
      render(Modal, { props: { onClose } })

      // The backdrop is the outermost element with role="presentation" or a data-testid
      const backdrop = screen.getByTestId('modal-backdrop')
      await fireEvent.click(backdrop)

      expect(onClose).toHaveBeenCalledOnce()
    })
  })

  describe('Active project pre-highlight', () => {
    it('pre-highlights active project on open (Enter immediately selects it)', async () => {
      mockActiveProjectId.set('proj-2')
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      const onClose = vi.fn()
      render(Modal, { props: { onClose } })

      const dialog = screen.getByRole('dialog')
      // Without moving, Enter should select the pre-highlighted active project
      await fireEvent.keyDown(dialog, { key: 'Enter' })

      expect(get(mockActiveProjectId)).toBe('proj-2')
      expect(onClose).toHaveBeenCalledOnce()
    })
  })

  describe('Attention indicators', () => {
    it('shows attention indicator for projects with needs_input', async () => {
      mockProjectAttention.set(new Map([
        ['proj-1', { project_id: 'proj-1', needs_input: 2, running_agents: 0, ci_failures: 0, unaddressed_comments: 0, completed_agents: 0 }]
      ]))
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      render(Modal, { props: { onClose: vi.fn() } })

      const indicator = screen.getByTitle(/2 agent.*need/i)
      expect(indicator).toBeTruthy()
    })

    it('shows running indicator for projects with running_agents', async () => {
      mockProjectAttention.set(new Map([
        ['proj-2', { project_id: 'proj-2', needs_input: 0, running_agents: 1, ci_failures: 0, unaddressed_comments: 0, completed_agents: 0 }]
      ]))
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      render(Modal, { props: { onClose: vi.fn() } })

      const indicator = screen.getByTitle(/1 agent.*running/i)
      expect(indicator).toBeTruthy()
    })
  })

  describe('IPC call on mount', () => {
    it('calls getProjectAttention on mount', async () => {
      const { default: Modal } = await import('./ProjectSwitcherModal.svelte')
      render(Modal, { props: { onClose: vi.fn() } })

      await vi.waitFor(() => {
        expect(mockGetProjectAttention).toHaveBeenCalledOnce()
      })
    })
  })
})
