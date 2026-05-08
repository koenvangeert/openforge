import { marked } from 'marked'
import { sanitizeHtml } from './sanitize'

const RELATIVE_PARENT_SEGMENT = /^\.\.\//
const RELATIVE_CURRENT_SEGMENT = /^\.\//

interface RenderMarkdownOptions {
  imageBaseUrl?: string | null
}

const markedOptions = {
  gfm: true,
  breaks: true,
}

function hasAbsoluteOrSpecialUrl(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//') || value.startsWith('#')
}

function normalizeRepoRelativeImagePath(value: string): string {
  let normalized = value.startsWith('/') ? value.slice(1) : value

  while (RELATIVE_CURRENT_SEGMENT.test(normalized)) {
    normalized = normalized.replace(RELATIVE_CURRENT_SEGMENT, '')
  }

  while (RELATIVE_PARENT_SEGMENT.test(normalized)) {
    normalized = normalized.replace(RELATIVE_PARENT_SEGMENT, '')
  }

  return normalized
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

export function resolveMarkdownImageSrc(src: string | null, imageBaseUrl: string | null | undefined): string | null {
  if (!src || !imageBaseUrl) return null

  const trimmedSrc = src.trim()
  if (!trimmedSrc || hasAbsoluteOrSpecialUrl(trimmedSrc)) return null

  try {
    return new URL(normalizeRepoRelativeImagePath(trimmedSrc), withTrailingSlash(imageBaseUrl)).href
  } catch {
    return null
  }
}

function resolveMarkdownImageSources(html: string, imageBaseUrl: string | null | undefined): string {
  if (!imageBaseUrl || typeof document === 'undefined') return html

  const template = document.createElement('template')
  template.innerHTML = html

  for (const image of template.content.querySelectorAll('img[src]')) {
    const resolvedSrc = resolveMarkdownImageSrc(image.getAttribute('src'), imageBaseUrl)
    if (resolvedSrc) {
      image.setAttribute('src', resolvedSrc)
    }
  }

  return template.innerHTML
}

export function renderMarkdownHtml(content: string, options: RenderMarkdownOptions = {}): string {
  const rawHtml = marked.parse(content, markedOptions) as string
  return sanitizeHtml(resolveMarkdownImageSources(rawHtml, options.imageBaseUrl))
}
