import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge/plugin-sdk/frontend'
import type { FileContent, FileEntry } from '@openforge/plugin-sdk/domain'

vi.mock('lucide-svelte', () => ({
  FileText: vi.fn(() => ({})),
  Folder: vi.fn(() => ({})),
  FolderOpen: vi.fn(() => ({})),
}))

import FilesView from './FilesView.svelte'
import { get } from 'svelte/store'
import { activeProjectId, fileBrowserStates, pendingFileReveal } from './lib/stores'

const fsReadDir = vi.fn()
const fsReadFile = vi.fn()
const openUrl = vi.fn()

function makeApi(): FrontendOpenForgeAPI {
  return {
    fs: { readDir: fsReadDir, readFile: fsReadFile },
    system: { openUrl },
  } as unknown as FrontendOpenForgeAPI
}

const runtimeContext: OpenForgeContextSnapshot = {
  pluginId: 'com.openforge.file-viewer',
  projectId: 'test-project-id',
}

function makeFileEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    name: 'file.ts',
    path: 'file.ts',
    isDir: false,
    size: 512,
    modifiedAt: null,
    ...overrides,
  }
}

const sampleEntries: FileEntry[] = [
  makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null }),
  makeFileEntry({ name: 'README.md', path: 'README.md', isDir: false, size: 1024 }),
]

const sampleFileContent: FileContent = {
  type: 'text',
  content: 'Hello world',
  mimeType: null,
  size: 11,
}

function renderFilesView(props: { projectName?: string; projectId?: string | null; api?: FrontendOpenForgeAPI } = {}) {
  return render(FilesView, {
    props: {
      api: props.api ?? makeApi(),
      context: runtimeContext,
      projectName: props.projectName ?? 'My Project',
      projectId: props.projectId === undefined ? 'test-project-id' : props.projectId,
    },
  })
}

describe('plugin FilesView', () => {
  beforeEach(() => {
    cleanup()
    activeProjectId.set(null)
    fileBrowserStates.set(new Map())
    pendingFileReveal.set(null)
    vi.clearAllMocks()
    vi.mocked(fsReadDir).mockResolvedValue([])
    vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)
  })

  it('fetches the root directory through the typed runtime fs API on mount', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)

    renderFilesView()

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: null })
    })
  })

  it('shows project name in the header', async () => {
    renderFilesView({ projectName: 'My Awesome Project' })

    await waitFor(() => {
      expect(screen.getByText(/My Awesome Project/)).toBeTruthy()
    })
  })

  it('loads directory children when a directory is expanded', async () => {
    vi.mocked(fsReadDir).mockResolvedValueOnce(sampleEntries).mockResolvedValue([])

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: /src\// }))

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src' })
    })
  })

  it('loads selected file content through the typed runtime fs API', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: /README.md/ }))

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'README.md' })
    })
  })

  it('does not call fsReadDir when no project is selected', async () => {
    renderFilesView({ projectId: null })

    await waitFor(() => {
      expect(screen.getByText(/Select a project to browse files/)).toBeTruthy()
    })
    expect(fsReadDir).not.toHaveBeenCalled()
  })

  it('restores expanded directories and selected content after remounting the plugin view', async () => {
    const srcEntry = makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null })
    const mainEntry = makeFileEntry({ name: 'main.ts', path: 'src/main.ts', isDir: false })
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([srcEntry])
      .mockResolvedValueOnce([mainEntry])
    vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)

    const { unmount } = renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: /src\// }))
    await waitFor(() => {
      expect(screen.getByText('main.ts')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: /main.ts/ }))
    await waitFor(() => {
      expect(screen.getByLabelText('File text content').textContent).toContain('Hello world')
    })

    unmount()
    vi.clearAllMocks()

    renderFilesView()

    expect(screen.getByText('src/')).toBeTruthy()
    expect(screen.getAllByText('main.ts').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('File text content').textContent).toContain('Hello world')
    expect(fsReadDir).not.toHaveBeenCalled()
    expect(fsReadFile).not.toHaveBeenCalled()
  })

  it('loads a new project when projectId changes in an already-mounted plugin view', async () => {
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([makeFileEntry({ name: 'a.ts', path: 'a.ts' })])
      .mockResolvedValueOnce([makeFileEntry({ name: 'b.ts', path: 'b.ts' })])

    const { rerender } = renderFilesView({ projectName: 'Project A', projectId: 'project-a' })

    await waitFor(() => {
      expect(screen.getByText('a.ts')).toBeTruthy()
    })

    await rerender({ projectName: 'Project B', projectId: 'project-b' })

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'project-b', path: null })
      expect(screen.getByText('b.ts')).toBeTruthy()
    })
    expect(screen.queryByText('a.ts')).toBeNull()
  })

  it('keeps file browser state separate for each project', async () => {
    const projectASrc = makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null })
    const projectAMain = makeFileEntry({ name: 'main.ts', path: 'src/main.ts', isDir: false })
    const projectBDocs = makeFileEntry({ name: 'docs', path: 'docs', isDir: true, size: null })
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([projectASrc])
      .mockResolvedValueOnce([projectAMain])
      .mockResolvedValueOnce([projectBDocs])

    const { rerender } = renderFilesView({ projectName: 'Project A', projectId: 'project-a' })

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })
    await fireEvent.click(screen.getByRole('button', { name: /src\// }))
    await waitFor(() => {
      expect(screen.getByText('main.ts')).toBeTruthy()
    })

    await rerender({ projectName: 'Project B', projectId: 'project-b' })
    await waitFor(() => {
      expect(screen.getByText('docs/')).toBeTruthy()
    })
    expect(screen.queryByText('main.ts')).toBeNull()

    await rerender({ projectName: 'Project A', projectId: 'project-a' })

    expect(screen.getByText('src/')).toBeTruthy()
    expect(screen.getByText('main.ts')).toBeTruthy()
  })

  it('ignores stale root loads from a previous project', async () => {
    let resolveProjectA!: (entries: FileEntry[]) => void
    const projectARoot = new Promise<FileEntry[]>((resolve) => {
      resolveProjectA = resolve
    })
    vi.mocked(fsReadDir)
      .mockReturnValueOnce(projectARoot)
      .mockResolvedValueOnce([makeFileEntry({ name: 'b.ts', path: 'b.ts' })])

    const { rerender } = renderFilesView({ projectName: 'Project A', projectId: 'project-a' })
    await rerender({ projectName: 'Project B', projectId: 'project-b' })

    await waitFor(() => {
      expect(screen.getByText('b.ts')).toBeTruthy()
    })

    resolveProjectA([makeFileEntry({ name: 'a.ts', path: 'a.ts' })])

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('a.ts')).toBeNull()
    expect(screen.getByText('b.ts')).toBeTruthy()
  })

  it('refetches the open file when returning to a project after a stale response was ignored', async () => {
    const readmeEntry = makeFileEntry({ name: 'README.md', path: 'README.md', isDir: false })
    let resolveStaleRead!: (content: FileContent) => void
    const staleRead = new Promise<FileContent>((resolve) => {
      resolveStaleRead = resolve
    })
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([readmeEntry])
      .mockResolvedValueOnce([])
    vi.mocked(fsReadFile)
      .mockReturnValueOnce(staleRead)
      .mockResolvedValueOnce(sampleFileContent)

    const { rerender } = renderFilesView({ projectName: 'Project A', projectId: 'project-a' })

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    await fireEvent.click(screen.getByRole('button', { name: /README.md/ }))
    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'project-a', path: 'README.md' })
    })

    await rerender({ projectName: 'Project B', projectId: 'project-b' })
    resolveStaleRead(sampleFileContent)

    await rerender({ projectName: 'Project A', projectId: 'project-a' })

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledTimes(2)
      expect(screen.getByText('Hello world')).toBeTruthy()
    })
  })

  it('expands parent directories and selects file for a pending reveal request', async () => {
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null })])
      .mockResolvedValueOnce([makeFileEntry({ name: 'components', path: 'src/components', isDir: true, size: null })])
      .mockResolvedValueOnce([makeFileEntry({ name: 'Button.ts', path: 'src/components/Button.ts' })])

    renderFilesView()

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: null })
    })

    pendingFileReveal.set('src/components/Button.ts')

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src' })
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src/components' })
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src/components/Button.ts' })
    })
  })

  it('skips already-expanded parent directories when revealing a file', async () => {
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null })])
      .mockResolvedValueOnce([makeFileEntry({ name: 'utils.ts', path: 'src/utils.ts' })])

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: /src\// }))
    await waitFor(() => {
      expect(screen.getByText('utils.ts')).toBeTruthy()
    })

    vi.clearAllMocks()
    vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)

    pendingFileReveal.set('src/utils.ts')

    await waitFor(() => {
      expect(fsReadDir).not.toHaveBeenCalled()
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src/utils.ts' })
    })
  })

  it('clears pendingFileReveal after processing', async () => {
    vi.mocked(fsReadDir).mockResolvedValue([makeFileEntry({ name: 'README.md', path: 'README.md' })])
    vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    pendingFileReveal.set('README.md')

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'README.md' })
    })

    await waitFor(() => {
      expect(get(pendingFileReveal)).toBeNull()
    })
  })

  it('does not select a revealed file or clear pending reveal when parent expansion fails', async () => {
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null })])
      .mockRejectedValueOnce(new Error('Permission denied'))

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })

    pendingFileReveal.set('src/secret.ts')

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src' })
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fsReadFile).not.toHaveBeenCalled()
    expect(get(pendingFileReveal)).toBe('src/secret.ts')
  })

  it('does not reveal before the root directory has loaded', async () => {
    vi.mocked(fsReadDir).mockReturnValue(new Promise(() => {}))

    renderFilesView()

    pendingFileReveal.set('some/file.ts')

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(fsReadDir).toHaveBeenCalledTimes(1)
    expect(fsReadFile).not.toHaveBeenCalled()
  })
})
