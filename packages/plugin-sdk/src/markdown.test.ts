import { describe, expect, it } from 'vitest'
import { renderMarkdownHtml } from './markdown'

describe('renderMarkdownHtml', () => {
  it('resolves relative image sources against the supplied image base URL', () => {
    const html = renderMarkdownHtml('![Architecture](docs/architecture.png)', {
      imageBaseUrl: 'https://raw.githubusercontent.com/acme/repo/abc123/',
    })

    expect(html).toContain('src="https://raw.githubusercontent.com/acme/repo/abc123/docs/architecture.png"')
  })

  it('keeps absolute markdown image sources unchanged', () => {
    const html = renderMarkdownHtml('![Uploaded](https://github.com/user-attachments/assets/image-id)', {
      imageBaseUrl: 'https://raw.githubusercontent.com/acme/repo/abc123/',
    })

    expect(html).toContain('src="https://github.com/user-attachments/assets/image-id"')
  })
})
