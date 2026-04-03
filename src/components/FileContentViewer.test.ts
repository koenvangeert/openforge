import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import FileContentViewer from './FileContentViewer.svelte'
import type { FileContent } from '../lib/types'

const sampleModifiedAt = Date.UTC(2024, 2, 9, 15, 30)
const formattedModifiedAt = new Date(sampleModifiedAt).toLocaleString('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

describe('FileContentViewer', () => {
  it('shows loading spinner when content is null and no error', () => {
    const { container } = render(FileContentViewer, {
      props: {
        content: null,
        fileName: 'README.md',
        error: null,
      },
    })

    expect(container.querySelector('.loading.loading-spinner')).toBeTruthy()
  })

  it('shows error message when error is set', () => {
    render(FileContentViewer, {
      props: {
        content: null,
        fileName: 'missing.txt',
        error: 'File not found',
      },
    })

    expect(screen.getByText('File not found')).toBeTruthy()
    expect(screen.getByText('missing.txt')).toBeTruthy()
  })

  it('renders text content with line numbers', () => {
    const content: FileContent = {
      type: 'text',
      content: 'line1\nline2',
      mimeType: 'text/plain',
      size: 11,
    }

    render(FileContentViewer, {
      props: {
        content,
        fileName: 'notes.txt',
        error: null,
      },
    })

    expect(screen.getByText(/line1/)).toBeTruthy()
    expect(screen.getByText(/line2/)).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('renders highlighted markup for supported text files', () => {
    const content: FileContent = {
      type: 'text',
      content: 'const total = 1',
      mimeType: 'text/plain',
      size: 15,
    }

    const { container } = render(FileContentViewer, {
      props: {
        content,
        fileName: 'notes.ts',
        error: null,
      },
    })

    expect(container.querySelector('.file-preview-code .hljs-keyword')).toBeTruthy()
  })

  it('shows metadata for text previews', () => {
    const content: FileContent = {
      type: 'text',
      content: 'line1\nline2',
      mimeType: 'text/plain',
      size: 11,
    }

    render(FileContentViewer, {
      props: {
        content,
        fileName: 'notes.txt',
        error: null,
        modifiedAt: sampleModifiedAt,
      },
    })

    expect(screen.getByText('11 B')).toBeTruthy()
    expect(screen.getByText('text/plain')).toBeTruthy()
    expect(screen.getByText('2 lines')).toBeTruthy()
    expect(screen.getByText(`Modified ${formattedModifiedAt}`)).toBeTruthy()
  })

  it('renders markdown via MarkdownContent when file is markdown', () => {
    const content: FileContent = {
      type: 'text',
      content: '# Hello World\n\nThis is **bold**.',
      mimeType: 'text/markdown',
      size: 34,
    }

    const { container } = render(FileContentViewer, {
      props: {
        content,
        fileName: 'README.md',
        error: null,
      },
    })

    expect(container.querySelector('.markdown-body')).toBeTruthy()
    expect(screen.getByText('Hello World')).toBeTruthy()
    expect(screen.queryByText('1')).toBeNull()
  })

  it('shows image for image content', () => {
    const content: FileContent = {
      type: 'image',
      content: 'base64data',
      mimeType: 'image/png',
      size: 128,
    }

    render(FileContentViewer, {
      props: {
        content,
        fileName: 'logo.png',
        error: null,
      },
    })

    const image = screen.getByRole('img', { name: 'logo.png preview' })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,base64data')
  })

  it('shows metadata for image previews', () => {
    const content: FileContent = {
      type: 'image',
      content: 'base64data',
      mimeType: 'image/png',
      size: 128,
    }

    render(FileContentViewer, {
      props: {
        content,
        fileName: 'logo.png',
        error: null,
        modifiedAt: sampleModifiedAt,
      },
    })

    expect(screen.getByText('128 B')).toBeTruthy()
    expect(screen.getByText('image/png')).toBeTruthy()
    expect(screen.getByText(`Modified ${formattedModifiedAt}`)).toBeTruthy()
  })

  it('shows cannot-preview for binary', () => {
    const content: FileContent = {
      type: 'binary',
      content: '',
      mimeType: null,
      size: 2048,
    }

    render(FileContentViewer, {
      props: {
        content,
        fileName: 'archive.bin',
        error: null,
      },
    })

    expect(screen.getByText(/Binary preview unavailable/i)).toBeTruthy()
  })

  it('shows file name, type, and size for binary', () => {
    const content: FileContent = {
      type: 'binary',
      content: '',
      mimeType: 'application/octet-stream',
      size: 2048,
    }

    render(FileContentViewer, {
      props: {
        content,
        fileName: 'archive.bin',
        error: null,
      },
    })

    expect(screen.getByText('archive.bin')).toBeTruthy()
    expect(screen.getByText('2.0 KB')).toBeTruthy()
    expect(screen.getByText('application/octet-stream')).toBeTruthy()
  })

  it('shows document fallback message', () => {
    const content: FileContent = {
      type: 'document',
      content: '',
      mimeType: 'application/pdf',
      size: 4096,
    }

    render(FileContentViewer, {
      props: {
        content,
        fileName: 'manual.pdf',
        error: null,
      },
    })

    expect(screen.getByText(/Document preview unavailable/i)).toBeTruthy()
    expect(screen.getByText('manual.pdf')).toBeTruthy()
    expect(screen.getByText('4.0 KB')).toBeTruthy()
    expect(screen.getByText('application/pdf')).toBeTruthy()
  })

  it('shows large-file fallback message', () => {
    const content: FileContent = {
      type: 'large-file',
      content: '',
      mimeType: 'text/plain',
      size: 10 * 1024 * 1024,
    }

    render(FileContentViewer, {
      props: {
        content,
        fileName: 'huge_log.txt',
        error: null,
      },
    })

    expect(screen.getByText(/File too large to preview/i)).toBeTruthy()
    expect(screen.getByText('huge_log.txt')).toBeTruthy()
    expect(screen.getByText('10.0 MB')).toBeTruthy()
    expect(screen.getByText(/metadata is shown/i)).toBeTruthy()
  })
})
