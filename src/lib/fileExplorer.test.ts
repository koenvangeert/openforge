import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileEntry, FileContent } from './types'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}))

vi.mock('./desktopIpc', () => ({
  invokeDesktopCommand: invokeMock,
  isElectronDesktopBridgeAvailable: vi.fn(() => true),
}))

import { fsReadDir, fsReadFile } from './ipc'

describe('File Explorer IPC Wrappers', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  describe('fsReadDir', () => {
    it('calls fs_read_dir with projectId and dirPath', async () => {
      const mockFiles: FileEntry[] = [
        {
          name: 'src',
          path: 'src',
          isDir: true,
          size: null,
          modifiedAt: 1000000,
        },
        {
          name: 'README.md',
          path: 'README.md',
          isDir: false,
          size: 256,
          modifiedAt: 1000001,
        },
      ]

      invokeMock.mockResolvedValueOnce(mockFiles)

      const result = await fsReadDir('proj-1', 'src')

      expect(invokeMock).toHaveBeenCalledWith('fs_read_dir', {
        projectId: 'proj-1',
        dirPath: 'src',
      })
      expect(result).toEqual(mockFiles)
    })

    it('handles null dirPath for root directory', async () => {
      const mockFiles: FileEntry[] = [
        {
          name: 'src',
          path: 'src',
          isDir: true,
          size: null,
          modifiedAt: 1000000,
        },
      ]

      invokeMock.mockResolvedValueOnce(mockFiles)

      const result = await fsReadDir('proj-1', null)

      expect(invokeMock).toHaveBeenCalledWith('fs_read_dir', {
        projectId: 'proj-1',
        dirPath: null,
      })
      expect(result).toEqual(mockFiles)
    })

    it('returns empty array for empty directories', async () => {
      invokeMock.mockResolvedValueOnce([])

      const result = await fsReadDir('proj-1', 'empty')

      expect(result).toEqual([])
    })
  })

  describe('fsReadFile', () => {
    it('calls fs_read_file with projectId and filePath', async () => {
      const mockContent: FileContent = {
        type: 'text',
        content: 'console.log("hello")',
        mimeType: 'text/javascript',
        size: 21,
      }

      invokeMock.mockResolvedValueOnce(mockContent)

      const result = await fsReadFile('proj-1', 'src/main.ts')

      expect(invokeMock).toHaveBeenCalledWith('fs_read_file', {
        projectId: 'proj-1',
        filePath: 'src/main.ts',
      })
      expect(result).toEqual(mockContent)
    })

    it('handles binary files', async () => {
      const mockContent: FileContent = {
        type: 'binary',
        content: '',
        mimeType: 'application/octet-stream',
        size: 1024,
      }

      invokeMock.mockResolvedValueOnce(mockContent)

      const result = await fsReadFile('proj-1', 'dist/app.bin')

      expect(result).toEqual(mockContent)
    })

    it('handles image files with base64 content', async () => {
      const mockContent: FileContent = {
        type: 'image',
        content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        mimeType: 'image/png',
        size: 68,
      }

      invokeMock.mockResolvedValueOnce(mockContent)

      const result = await fsReadFile('proj-1', 'assets/logo.png')

      expect(result).toEqual(mockContent)
    })
  })

  describe('Type Verification', () => {
    it('FileEntry has correct shape', () => {
      const entry: FileEntry = {
        name: 'test.ts',
        path: 'src/test.ts',
        isDir: false,
        size: 1024,
        modifiedAt: Date.now(),
      }
      expect(entry.name).toBe('test.ts')
      expect(entry.isDir).toBe(false)
    })

    it('FileContent has correct shape', () => {
      const content: FileContent = {
        type: 'text',
        content: 'hello',
        mimeType: 'text/plain',
        size: 5,
      }
      expect(content.type).toBe('text')
      expect(content.mimeType).toBe('text/plain')
    })
  })
})
