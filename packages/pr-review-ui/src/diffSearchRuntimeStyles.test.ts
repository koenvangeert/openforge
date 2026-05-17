import { afterEach, describe, expect, it } from 'vitest'
import {
  DIFF_SEARCH_HIGHLIGHT_STYLES,
  applyOccurrenceHighlights,
  applySearchHighlights,
} from './diffSearch'

const originalCSS = globalThis.CSS
const originalHighlight = globalThis.Highlight

class MockHighlight {
  readonly ranges: Range[]

  constructor(...ranges: Range[]) {
    this.ranges = ranges
  }
}

function installHighlightApiMock() {
  const highlights = new Map<string, unknown>()
  Object.defineProperty(globalThis, 'CSS', {
    configurable: true,
    value: { highlights },
  })
  Object.defineProperty(globalThis, 'Highlight', {
    configurable: true,
    value: MockHighlight,
  })
  return highlights
}

function restoreHighlightApi() {
  Object.defineProperty(globalThis, 'CSS', {
    configurable: true,
    value: originalCSS,
  })
  Object.defineProperty(globalThis, 'Highlight', {
    configurable: true,
    value: originalHighlight,
  })
}

function makeRange(): Range {
  const text = document.createTextNode('diff search match')
  document.body.appendChild(text)
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, 4)
  return range
}

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  restoreHighlightApi()
})

describe('diff search CSS Custom Highlight styling', () => {
  it('installs valid ::highlight rules for the registered diff search highlight names', () => {
    const highlights = installHighlightApiMock()
    const range = makeRange()

    applySearchHighlights([range], range)
    applyOccurrenceHighlights([range])

    const style = document.getElementById('openforge-diff-search-highlight-styles')
    expect(style?.textContent).toBe(DIFF_SEARCH_HIGHLIGHT_STYLES)
    expect(document.querySelectorAll('#openforge-diff-search-highlight-styles')).toHaveLength(1)
    expect(DIFF_SEARCH_HIGHLIGHT_STYLES).toContain('::highlight(diff-search-match)')
    expect(DIFF_SEARCH_HIGHLIGHT_STYLES).toContain('::highlight(diff-search-current)')
    expect(DIFF_SEARCH_HIGHLIGHT_STYLES).toContain('::highlight(diff-occurrence-match)')
    expect(highlights.has('diff-search-match')).toBe(true)
    expect(highlights.has('diff-search-current')).toBe(true)
    expect(highlights.has('diff-occurrence-match')).toBe(true)
  })

  it('does not inject highlight styles when the Custom Highlight API is unavailable', () => {
    applySearchHighlights([makeRange()], null)

    expect(document.getElementById('openforge-diff-search-highlight-styles')).toBeNull()
  })
})
