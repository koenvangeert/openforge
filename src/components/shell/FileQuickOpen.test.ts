import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'

const mockActiveProjectId = writable<string | null>('test-project-id')
const mockPendingFileReveal = writable<string | null>(null)
const mockFsSearchFiles = vi.fn<(projectId: string, query: string, limit: number) => Promise<string[]>>()
const mockNavigate = vi.fn()

vi.mock('../../lib/stores', () => ({
  activeProjectId: mockActiveProjectId,
  pendingFileReveal: mockPendingFileReveal,
}))

vi.mock('../../lib/ipc', () => ({
  fsSearchFiles: mockFsSearchFiles,
}))

vi.mock('../../lib/router.svelte', () => ({
  useAppRouter: () => ({ navigate: mockNavigate }),
}))

Element.prototype.scrollIntoView = vi.fn()

async function renderFileQuickOpen(onClose = vi.fn()) {
  const { default: FileQuickOpen } = await import('./FileQuickOpen.svelte')
  return render(FileQuickOpen, { props: { onClose } })
}

function getDialogInput(): HTMLInputElement {
  const input = screen.getByRole('dialog').querySelector('input')
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('Expected input element in quick-open dialog')
  }
  return input
}

describe('FileQuickOpen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveProjectId.set('test-project-id')
    mockPendingFileReveal.set(null)
    mockFsSearchFiles.mockResolvedValue([])
  })

  it('renders search input and focuses it on mount', async () => {
    await renderFileQuickOpen()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()

    const input = dialog.querySelector('input')
    expect(input).toBeTruthy()

    await waitFor(() => {
      expect(document.activeElement).toBe(input)
    })
  })

  it('calls fsSearchFiles with debounced query', async () => {
    mockFsSearchFiles.mockResolvedValue(['src/lib/ipc.ts'])
    await renderFileQuickOpen()

    const input = getDialogInput()
    await fireEvent.input(input, { target: { value: 'ipc' } })

    expect(mockFsSearchFiles).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(mockFsSearchFiles).toHaveBeenCalledWith('test-project-id', 'ipc', 50)
    }, { timeout: 400 })
  })

  it('shows no-match state when search returns empty', async () => {
    mockFsSearchFiles.mockResolvedValue([])
    await renderFileQuickOpen()

    const input = getDialogInput()
    await fireEvent.input(input, { target: { value: 'zzz' } })

    await waitFor(() => {
      expect(mockFsSearchFiles).toHaveBeenCalled()
      expect(screen.getByText(/No files match your search/i)).toBeTruthy()
    }, { timeout: 400 })
  })

  it('filters out directory entries from results', async () => {
    mockFsSearchFiles.mockResolvedValue(['src/lib/', 'src/lib/ipc.ts'])
    await renderFileQuickOpen()

    const input = getDialogInput()
    await fireEvent.input(input, { target: { value: 'lib' } })

    await waitFor(() => {
      expect(screen.getByText('ipc.ts')).toBeTruthy()
    }, { timeout: 400 })

    expect(screen.queryByText('lib')).toBeNull()
  })

  it('supports keyboard navigation and select via Enter', async () => {
    mockFsSearchFiles.mockResolvedValue(['a.ts', 'b.ts', 'c.ts'])
    const onClose = vi.fn()
    await renderFileQuickOpen(onClose)

    const input = getDialogInput()
    await fireEvent.input(input, { target: { value: 'ts' } })

    await waitFor(() => {
      expect(screen.getByText('a.ts')).toBeTruthy()
      expect(screen.getByText('b.ts')).toBeTruthy()
    }, { timeout: 400 })

    const dialog = screen.getByRole('dialog')
    await fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    await fireEvent.keyDown(dialog, { key: 'Enter' })

    expect(get(mockPendingFileReveal)).toBe('b.ts')
    expect(mockNavigate).toHaveBeenCalledWith('plugin:com.openforge.file-viewer:files')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape closes the modal', async () => {
    const onClose = vi.fn()
    await renderFileQuickOpen(onClose)

    const dialog = screen.getByRole('dialog')
    await fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('backdrop click closes modal', async () => {
    const onClose = vi.fn()
    await renderFileQuickOpen(onClose)

    const backdrop = screen.getByTestId('file-quick-open-backdrop')
    await fireEvent.click(backdrop)

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows project-required state when no active project', async () => {
    mockActiveProjectId.set(null)
    await renderFileQuickOpen()

    expect(screen.getByText(/Select a project first/i)).toBeTruthy()
  })

  it('clears debounce timer on unmount', async () => {
    const { unmount } = await renderFileQuickOpen()

    const input = getDialogInput()
    await fireEvent.input(input, { target: { value: 'test' } })

    unmount()

    const callCount = mockFsSearchFiles.mock.calls.length
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(mockFsSearchFiles.mock.calls.length).toBe(callCount)
  })

  it('supports Ctrl+J/K for keyboard navigation', async () => {
    mockFsSearchFiles.mockResolvedValue(['a.ts', 'b.ts', 'c.ts'])
    const onClose = vi.fn()
    await renderFileQuickOpen(onClose)

    const input = getDialogInput()
    await fireEvent.input(input, { target: { value: 'ts' } })

    await waitFor(() => {
      expect(screen.getByText('a.ts')).toBeTruthy()
    }, { timeout: 400 })

    const dialog = screen.getByRole('dialog')
    await fireEvent.keyDown(dialog, { key: 'j', ctrlKey: true })
    await fireEvent.keyDown(dialog, { key: 'k', ctrlKey: true })
    await fireEvent.keyDown(dialog, { key: 'j', ctrlKey: true })
    await fireEvent.keyDown(dialog, { key: 'Enter' })

    expect(get(mockPendingFileReveal)).toBe('b.ts')
  })

  it('displays file name and directory path for results', async () => {
    mockFsSearchFiles.mockResolvedValue(['src/components/App.svelte'])
    await renderFileQuickOpen()

    const input = getDialogInput()
    await fireEvent.input(input, { target: { value: 'App' } })

    await waitFor(() => {
      expect(screen.getByText('App.svelte')).toBeTruthy()
      expect(screen.getByText('src/components')).toBeTruthy()
    }, { timeout: 400 })
  })
})
