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

describe('FilesView integration', () => {
  beforeEach(() => {
    activeProjectId.set('test-project-id')
    vi.clearAllMocks()
    vi.mocked(fsReadDir).mockResolvedValue([])
    vi.mocked(fsReadFile).mockResolvedValue({
      type: 'text',
      content: '',
      mimeType: null,
      size: 0,
    })
  })

  describe('full browse flow', () => {
    it('mounts, loads root, expands dir, selects file, content displays', async () => {
      const rootEntries: FileEntry[] = [
        makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null }),
        makeFileEntry({ name: 'index.ts', path: 'index.ts', isDir: false, size: 256 }),
      ]
      const srcEntries: FileEntry[] = [
        makeFileEntry({ name: 'utils.ts', path: 'src/utils.ts', isDir: false, size: 128 }),
      ]
      const fileContent: FileContent = {
        type: 'text',
        content: 'export function hello() {}',
        mimeType: null,
        size: 25,
      }

      vi.mocked(fsReadDir)
        .mockResolvedValueOnce(rootEntries)
        .mockResolvedValueOnce(srcEntries)
      vi.mocked(fsReadFile).mockResolvedValue(fileContent)

      render(FilesView, { props: { projectName: 'Test Project' } })

      await waitFor(() => {
        expect(fsReadDir).toHaveBeenCalledWith('test-project-id', null)
      })

      await waitFor(() => {
        expect(screen.getByText('src/')).toBeTruthy()
        expect(screen.getByText('index.ts')).toBeTruthy()
      })

      const dirButton = screen.getByRole('button', { name: /src\// })
      await fireEvent.click(dirButton)

      await waitFor(() => {
        expect(fsReadDir).toHaveBeenCalledWith('test-project-id', 'src')
      })

      await waitFor(() => {
        expect(screen.getByText('utils.ts')).toBeTruthy()
      })

      const fileButton = screen.getByRole('button', { name: /utils\.ts/ })
      await fireEvent.click(fileButton)

      await waitFor(() => {
        expect(fsReadFile).toHaveBeenCalledWith('test-project-id', 'src/utils.ts')
      })

      await waitFor(() => {
        expect(screen.getByLabelText('File text content')).toBeTruthy()
      })
    })
  })

  describe('error flow', () => {
    it('shows error message when fsReadDir rejects', async () => {
      vi.mocked(fsReadDir).mockRejectedValue(new Error('Permission denied'))

      render(FilesView, { props: { projectName: 'Locked Project' } })

      await waitFor(() => {
        expect(screen.getByText(/Permission denied/)).toBeTruthy()
      })
    })

    it('shows failed to load headline on root error', async () => {
      vi.mocked(fsReadDir).mockRejectedValue(new Error('ENOENT: no such file'))

      render(FilesView, { props: { projectName: 'Missing Project' } })

      await waitFor(() => {
        expect(screen.getByText(/Failed to load files/)).toBeTruthy()
      })
    })
  })

  describe('empty project', () => {
    it('shows empty state when root returns []', async () => {
      vi.mocked(fsReadDir).mockResolvedValue([])

      render(FilesView, { props: { projectName: 'Empty Project' } })

      await waitFor(() => {
        expect(screen.getByText(/This project folder is empty/)).toBeTruthy()
      })
    })

    it('shows 0 items in badge when root is empty', async () => {
      vi.mocked(fsReadDir).mockResolvedValue([])

      render(FilesView, { props: { projectName: 'Empty Project' } })

      await waitFor(() => {
        expect(screen.getByText('0 items')).toBeTruthy()
      })
    })
  })

  describe('deep nesting', () => {
    it('loads each level correctly when expanding nested directories', async () => {
      const rootEntries: FileEntry[] = [
        makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null }),
      ]
      const srcEntries: FileEntry[] = [
        makeFileEntry({ name: 'lib', path: 'src/lib', isDir: true, size: null }),
        makeFileEntry({ name: 'main.ts', path: 'src/main.ts', isDir: false, size: 100 }),
      ]
      const libEntries: FileEntry[] = [
        makeFileEntry({ name: 'utils.ts', path: 'src/lib/utils.ts', isDir: false, size: 200 }),
      ]

      vi.mocked(fsReadDir)
        .mockResolvedValueOnce(rootEntries)
        .mockResolvedValueOnce(srcEntries)
        .mockResolvedValueOnce(libEntries)

      render(FilesView, { props: { projectName: 'Deep Project' } })

      await waitFor(() => {
        expect(screen.getByText('src/')).toBeTruthy()
      })

      await fireEvent.click(screen.getByRole('button', { name: /src\// }))

      await waitFor(() => {
        expect(fsReadDir).toHaveBeenCalledWith('test-project-id', 'src')
        expect(screen.getByText('lib/')).toBeTruthy()
        expect(screen.getByText('main.ts')).toBeTruthy()
      })

      await fireEvent.click(screen.getByRole('button', { name: /lib\// }))

      await waitFor(() => {
        expect(fsReadDir).toHaveBeenCalledWith('test-project-id', 'src/lib')
        expect(screen.getByText('utils.ts')).toBeTruthy()
      })

      expect(fsReadDir).toHaveBeenCalledTimes(3)
    })

    it('keeps nested folders grouped under their parent before sibling files', async () => {
      const rootEntries: FileEntry[] = [
        makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null }),
      ]
      const srcEntries: FileEntry[] = [
        makeFileEntry({ name: 'lib', path: 'src/lib', isDir: true, size: null }),
        makeFileEntry({ name: 'main.ts', path: 'src/main.ts', isDir: false, size: 100 }),
      ]
      const libEntries: FileEntry[] = [
        makeFileEntry({ name: 'utils.ts', path: 'src/lib/utils.ts', isDir: false, size: 200 }),
      ]

      vi.mocked(fsReadDir)
        .mockResolvedValueOnce(rootEntries)
        .mockResolvedValueOnce(srcEntries)
        .mockResolvedValueOnce(libEntries)

      render(FilesView, { props: { projectName: 'Deep Project' } })

      await waitFor(() => {
        expect(screen.getByText('src/')).toBeTruthy()
      })

      await fireEvent.click(screen.getByRole('button', { name: /src\// }))

      await waitFor(() => {
        expect(screen.getByText('lib/')).toBeTruthy()
        expect(screen.getByText('main.ts')).toBeTruthy()
      })

      await fireEvent.click(screen.getByRole('button', { name: /lib\// }))

      await waitFor(() => {
        expect(screen.getByText('utils.ts')).toBeTruthy()
      })

      const labels = screen.getAllByTestId('entry-label').map((node) => node.textContent)
      expect(labels).toEqual(['src/', 'lib/', 'utils.ts', 'main.ts'])
    })

    it('does not re-fetch already-loaded directory on second expand', async () => {
      const rootEntries: FileEntry[] = [
        makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null }),
      ]
      const srcEntries: FileEntry[] = [
        makeFileEntry({ name: 'index.ts', path: 'src/index.ts', isDir: false, size: 50 }),
      ]

      vi.mocked(fsReadDir)
        .mockResolvedValueOnce(rootEntries)
        .mockResolvedValueOnce(srcEntries)

      render(FilesView, { props: { projectName: 'Cache Project' } })

      await waitFor(() => {
        expect(screen.getByText('src/')).toBeTruthy()
      })

      const dirButton = screen.getByRole('button', { name: /src\// })

      await fireEvent.click(dirButton)
      await waitFor(() => {
        expect(fsReadDir).toHaveBeenCalledTimes(2)
      })

      await fireEvent.click(dirButton)

      await fireEvent.click(dirButton)
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(fsReadDir).toHaveBeenCalledTimes(2)
    })
  })

  describe('file content types', () => {
    it('shows text content viewer for text files', async () => {
      const rootEntries: FileEntry[] = [
        makeFileEntry({ name: 'hello.ts', path: 'hello.ts', isDir: false, size: 30 }),
      ]
      const textContent: FileContent = {
        type: 'text',
        content: 'const x = 1',
        mimeType: null,
        size: 11,
      }

      vi.mocked(fsReadDir).mockResolvedValue(rootEntries)
      vi.mocked(fsReadFile).mockResolvedValue(textContent)

      render(FilesView, { props: { projectName: 'Text Project' } })

      await waitFor(() => {
        expect(screen.getByText('hello.ts')).toBeTruthy()
      })

      await fireEvent.click(screen.getByRole('button', { name: /hello\.ts/ }))

      await waitFor(() => {
        expect(screen.getByLabelText('File text content')).toBeTruthy()
      })
    })

    it('shows image viewer for image files', async () => {
      const rootEntries: FileEntry[] = [
        makeFileEntry({ name: 'logo.png', path: 'logo.png', isDir: false, size: 4096 }),
      ]
      const imageContent: FileContent = {
        type: 'image',
        content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        mimeType: 'image/png',
        size: 4096,
      }

      vi.mocked(fsReadDir).mockResolvedValue(rootEntries)
      vi.mocked(fsReadFile).mockResolvedValue(imageContent)

      render(FilesView, { props: { projectName: 'Image Project' } })

      await waitFor(() => {
        expect(screen.getByText('logo.png')).toBeTruthy()
      })

      await fireEvent.click(screen.getByRole('button', { name: /logo\.png/ }))

      await waitFor(() => {
        const img = screen.getByRole('img', { name: /logo\.png preview/ })
        expect(img).toBeTruthy()
      })
    })

    it('shows binary fallback for binary files', async () => {
      const rootEntries: FileEntry[] = [
        makeFileEntry({ name: 'app.exe', path: 'app.exe', isDir: false, size: 102400 }),
      ]
      const binaryContent: FileContent = {
        type: 'binary',
        content: '',
        mimeType: 'application/octet-stream',
        size: 102400,
      }

      vi.mocked(fsReadDir).mockResolvedValue(rootEntries)
      vi.mocked(fsReadFile).mockResolvedValue(binaryContent)

      render(FilesView, { props: { projectName: 'Binary Project' } })

      await waitFor(() => {
        expect(screen.getByText('app.exe')).toBeTruthy()
      })

      await fireEvent.click(screen.getByRole('button', { name: /app\.exe/ }))

      await waitFor(() => {
        expect(screen.getByText(/Cannot preview this file type/)).toBeTruthy()
      })
    })

    it('shows loading spinner while file content is loading', async () => {
      const rootEntries: FileEntry[] = [
        makeFileEntry({ name: 'slow.ts', path: 'slow.ts', isDir: false, size: 100 }),
      ]

      let resolveFile!: (v: FileContent) => void
      const pendingFile = new Promise<FileContent>(res => {
        resolveFile = res
      })

      vi.mocked(fsReadDir).mockResolvedValue(rootEntries)
      vi.mocked(fsReadFile).mockReturnValue(pendingFile)

      render(FilesView, { props: { projectName: 'Slow Project' } })

      await waitFor(() => {
        expect(screen.getByText('slow.ts')).toBeTruthy()
      })

      await fireEvent.click(screen.getByRole('button', { name: /slow\.ts/ }))

      await waitFor(() => {
        expect(screen.getByLabelText('Loading file content')).toBeTruthy()
      })

      resolveFile({ type: 'text', content: '', mimeType: null, size: 0 })
    })
  })
})
