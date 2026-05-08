import { render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import MarkdownContent from './MarkdownContent.svelte'

vi.mock('../../../lib/ipc', () => ({
  openUrl: vi.fn(),
}))

describe('MarkdownContent', () => {
  it('resolves relative image sources against the supplied image base URL', () => {
    render(MarkdownContent, {
      props: {
        content: '![Architecture](docs/architecture.png)',
        imageBaseUrl: 'https://raw.githubusercontent.com/acme/repo/abc123/',
      },
    })

    const image = screen.getByRole('img', { name: 'Architecture' })
    expect(image.getAttribute('src')).toBe('https://raw.githubusercontent.com/acme/repo/abc123/docs/architecture.png')
  })

  it('keeps absolute markdown image sources unchanged', () => {
    render(MarkdownContent, {
      props: {
        content: '![Uploaded](https://github.com/user-attachments/assets/image-id)',
        imageBaseUrl: 'https://raw.githubusercontent.com/acme/repo/abc123/',
      },
    })

    const image = screen.getByRole('img', { name: 'Uploaded' })
    expect(image.getAttribute('src')).toBe('https://github.com/user-attachments/assets/image-id')
  })
})
