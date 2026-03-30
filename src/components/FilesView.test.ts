import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { FileEntry, FileContent } from '../lib/types'

vi.mock('../lib/stores', () => ({
  activeProjectId: writable<string | null>('test-project-id'),
}))

vi.mock('../lib/ipc', () => ({
  fsReadDir: vi.fn(),
  fsReadFile: vi.fn(),
}))

import FilesView from './FilesView.svelte'
import { activeProjectId } from '../lib/stores'
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
})
