import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import FileContentViewer from './FileContentViewer.svelte'
import type { FileContent } from '../lib/types'

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

    expect(screen.getByText('line1')).toBeTruthy()
    expect(screen.getByText('line2')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
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

    expect(screen.getByText('Cannot preview this file type')).toBeTruthy()
  })

  it('shows file name and size for binary', () => {
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

    expect(screen.getByText('archive.bin')).toBeTruthy()
    expect(screen.getByText('2.0 KB')).toBeTruthy()
  })
})
