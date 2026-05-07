import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { FileEntry, FileContent } from '../lib/types'

vi.mock('../lib/stores', () => ({
  activeProjectId: writable<string | null>('test-project-id'),
  fileBrowserStates: writable(new Map()),
  pendingFileReveal: writable<string | null>(null),
}))

vi.mock('../lib/ipc', () => ({
  fsReadDir: vi.fn(),
  fsReadFile: vi.fn(),
}))

import FilesView from './FilesView.svelte'
import { activeProjectId, fileBrowserStates, pendingFileReveal } from '../lib/stores'
import { fsReadDir, fsReadFile } from '../lib/ipc'

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

describe('FilesView', () => {
  beforeEach(() => {
    activeProjectId.set('test-project-id')
    fileBrowserStates.set(new Map())
    pendingFileReveal.set(null)
    vi.clearAllMocks()
    vi.mocked(fsReadDir).mockResolvedValue([])
    vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)
  })

  it('fetches root directory on mount', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)
    render(FilesView, { props: { projectName: 'My Project' } })

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith('test-project-id', null)
    })
  })

  it('shows project name in header', async () => {
    vi.mocked(fsReadDir).mockResolvedValue([])
    render(FilesView, { props: { projectName: 'My Awesome Project' } })

    await waitFor(() => {
      expect(screen.getByText(/My Awesome Project/)).toBeTruthy()
    })
  })

  it('clicking directory triggers fsReadDir for subdir', async () => {
    vi.mocked(fsReadDir).mockResolvedValueOnce(sampleEntries).mockResolvedValue([])
    render(FilesView, { props: { projectName: 'My Project' } })

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })

    const dirButton = screen.getByRole('button', { name: /src\// })
    await fireEvent.click(dirButton)

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith('test-project-id', 'src')
    })
  })

  it('clicking file triggers fsReadFile', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)
    render(FilesView, { props: { projectName: 'My Project' } })

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    const fileButton = screen.getByRole('button', { name: /README.md/ })
    await fireEvent.click(fileButton)

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith('test-project-id', 'README.md')
    })
  })

  it('shows empty state when root returns empty array', async () => {
    vi.mocked(fsReadDir).mockResolvedValue([])
    render(FilesView, { props: { projectName: 'Empty Project' } })

    await waitFor(() => {
      expect(screen.getByText(/This project folder is empty/)).toBeTruthy()
    })
  })

  it('shows error state when fsReadDir rejects', async () => {
    vi.mocked(fsReadDir).mockRejectedValue(new Error('Permission denied'))
    render(FilesView, { props: { projectName: 'My Project' } })

    await waitFor(() => {
      expect(screen.getByText(/Permission denied/)).toBeTruthy()
    })
  })

  it('shows no project message when activeProjectId is null', async () => {
    activeProjectId.set(null)
    render(FilesView, { props: { projectName: 'My Project' } })

    await waitFor(() => {
      expect(screen.getByText(/Select a project to browse files/)).toBeTruthy()
    })
  })

  it('does not call fsReadDir when no active project', async () => {
    activeProjectId.set(null)
    render(FilesView, { props: { projectName: 'My Project' } })

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(fsReadDir).not.toHaveBeenCalled()
  })

  it('restores expanded directories and the open file after remounting the Files view', async () => {
    const srcEntry = makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null })
    const mainEntry = makeFileEntry({ name: 'main.ts', path: 'src/main.ts', isDir: false })
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([srcEntry])
      .mockResolvedValueOnce([mainEntry])
    vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)

    const { unmount } = render(FilesView, { props: { projectName: 'My Project' } })

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: /src\// }))
    await waitFor(() => {
      expect(screen.getByText('main.ts')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: /main.ts/ }))
    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith('test-project-id', 'src/main.ts')
    })

    unmount()
    vi.clearAllMocks()

    render(FilesView, { props: { projectName: 'My Project' } })

    expect(screen.getByText('src/')).toBeTruthy()
    expect(screen.getAllByText('main.ts').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('File text content').textContent).toContain('Hello world')
    expect(fsReadDir).not.toHaveBeenCalled()
    expect(fsReadFile).not.toHaveBeenCalled()
  })

  it('refetches the open file when returning to a project after a stale response was ignored', async () => {
    const readmeEntry = makeFileEntry({ name: 'README.md', path: 'README.md', isDir: false })
    let resolveStaleRead: (content: FileContent) => void = () => {}
    const staleRead = new Promise<FileContent>((resolve) => {
      resolveStaleRead = resolve
    })
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([readmeEntry])
      .mockResolvedValueOnce([])
    vi.mocked(fsReadFile)
      .mockReturnValueOnce(staleRead)
      .mockResolvedValueOnce(sampleFileContent)

    const { rerender } = render(FilesView, { props: { projectName: 'Project A' } })

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    await fireEvent.click(screen.getByRole('button', { name: /README.md/ }))
    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith('test-project-id', 'README.md')
    })

    activeProjectId.set('project-b')
    await rerender({ projectName: 'Project B' })
    resolveStaleRead(sampleFileContent)

    activeProjectId.set('test-project-id')
    await rerender({ projectName: 'Project A' })

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledTimes(2)
      expect(screen.getByText('Hello world')).toBeTruthy()
    })
  })

  it('keeps file browser state separate for each project', async () => {
    const projectASrc = makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null })
    const projectAMain = makeFileEntry({ name: 'main.ts', path: 'src/main.ts', isDir: false })
    const projectBDocs = makeFileEntry({ name: 'docs', path: 'docs', isDir: true, size: null })
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([projectASrc])
      .mockResolvedValueOnce([projectAMain])
      .mockResolvedValueOnce([projectBDocs])

    const { rerender } = render(FilesView, { props: { projectName: 'Project A' } })

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })
    await fireEvent.click(screen.getByRole('button', { name: /src\// }))
    await waitFor(() => {
      expect(screen.getByText('main.ts')).toBeTruthy()
    })

    activeProjectId.set('project-b')
    await rerender({ projectName: 'Project B' })
    await waitFor(() => {
      expect(screen.getByText('docs/')).toBeTruthy()
    })
    expect(screen.queryByText('main.ts')).toBeNull()

    activeProjectId.set('test-project-id')
    await rerender({ projectName: 'Project A' })

    expect(screen.getByText('src/')).toBeTruthy()
    expect(screen.getByText('main.ts')).toBeTruthy()
  })
})

describe('revealPath', () => {
  beforeEach(() => {
    activeProjectId.set('test-project-id')
    fileBrowserStates.set(new Map())
    pendingFileReveal.set(null)
    vi.clearAllMocks()
    vi.mocked(fsReadDir).mockResolvedValue([])
    vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)
  })

  it('expands all parent directories for deeply nested file', async () => {
    const srcEntry = makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null })
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([srcEntry])
      .mockResolvedValueOnce([makeFileEntry({ name: 'components', path: 'src/components', isDir: true, size: null })])
      .mockResolvedValueOnce([makeFileEntry({ name: 'Button.tsx', path: 'src/components/Button.tsx' })])

    render(FilesView, { props: { projectName: 'My Project' } })

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith('test-project-id', null)
    })

    pendingFileReveal.set('src/components/Button.tsx')

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith('test-project-id', 'src')
      expect(fsReadDir).toHaveBeenCalledWith('test-project-id', 'src/components')
      expect(fsReadFile).toHaveBeenCalledWith('test-project-id', 'src/components/Button.tsx')
    })
  })

  it('skips already-expanded parent directories', async () => {
    const srcEntry = makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null })
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([srcEntry])
      .mockResolvedValueOnce([makeFileEntry({ name: 'utils.ts', path: 'src/utils.ts' })])
      .mockResolvedValueOnce([])

    render(FilesView, { props: { projectName: 'My Project' } })

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith('test-project-id', null)
    })

    const srcButton = screen.getByRole('button', { name: /src\// })
    await fireEvent.click(srcButton)

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith('test-project-id', 'src')
    })

    vi.clearAllMocks()
    vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)

    pendingFileReveal.set('src/utils.ts')

    await waitFor(() => {
      expect(fsReadDir).not.toHaveBeenCalled()
      expect(fsReadFile).toHaveBeenCalledWith('test-project-id', 'src/utils.ts')
    })
  })

  it('clears pendingFileReveal after processing', async () => {
    vi.mocked(fsReadDir).mockResolvedValue([])
    vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)

    render(FilesView, { props: { projectName: 'My Project' } })

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith('test-project-id', null)
    })

    const rootFile = makeFileEntry({ name: 'README.md', path: 'README.md' })
    vi.mocked(fsReadDir).mockResolvedValue([rootFile])

    render(FilesView, { props: { projectName: 'My Project' } })

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalled()
    })

    pendingFileReveal.set('README.md')

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalled()
    })

    let cleared = false
    pendingFileReveal.subscribe(v => { if (v === null) cleared = true })()
    expect(cleared).toBe(true)
  })

  it('does not reveal when hasLoaded is false', async () => {
    vi.mocked(fsReadDir).mockReturnValue(new Promise(() => {}))

    render(FilesView, { props: { projectName: 'My Project' } })

    pendingFileReveal.set('some/file.ts')

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(fsReadDir).toHaveBeenCalledTimes(1)
    expect(fsReadFile).not.toHaveBeenCalled()
  })
})
