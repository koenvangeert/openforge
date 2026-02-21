import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  findMatchesInContainer,
  applySearchHighlights,
  clearSearchHighlights,
  applyOccurrenceHighlights,
  clearOccurrenceHighlights,
  getWordAtSelection,
  scrollToMatch,
} from './diffSearch'

// ============================================================================
// CSS Custom Highlight API Mocks
// ============================================================================

// jsdom does not support the CSS Custom Highlight API, so we mock it here.
// CSS.highlights is a HighlightRegistry (Map-like), and Highlight is a class
// that accepts Range objects in its constructor.

const mockHighlights = new Map<string, unknown>()

Object.defineProperty(globalThis, 'CSS', {
  value: { highlights: mockHighlights },
  writable: true,
  configurable: true,
})

class MockHighlight {
  ranges: AbstractRange[]
  constructor(...ranges: AbstractRange[]) {
    this.ranges = ranges
  }
}

;(globalThis as unknown as Record<string, unknown>).Highlight = MockHighlight

// ============================================================================
// DOM Fixture Helpers
// ============================================================================

function createDiffDOM(...lines: string[]): HTMLDivElement {
  const container = document.createElement('div')
  for (const line of lines) {
    const contentItem = document.createElement('div')
    contentItem.className = 'diff-line-content-item'

    const operator = document.createElement('span')
    operator.className = 'diff-line-content-operator'
    operator.textContent = '+'
    contentItem.appendChild(operator)

    const content = document.createElement('span')
    content.textContent = line
    contentItem.appendChild(content)

    container.appendChild(contentItem)
  }
  return container
}

function createFragmentedLine(fragments: string[]): HTMLDivElement {
  const container = document.createElement('div')
  const contentItem = document.createElement('div')
  contentItem.className = 'diff-line-content-item'

  const operator = document.createElement('span')
  operator.className = 'diff-line-content-operator'
  operator.textContent = ' '
  contentItem.appendChild(operator)

  for (const frag of fragments) {
    const span = document.createElement('span')
    span.textContent = frag
    contentItem.appendChild(span)
  }

  container.appendChild(contentItem)
  return container
}

// ============================================================================
// findMatchesInContainer Tests
// ============================================================================

describe('findMatchesInContainer', () => {
  it('returns empty array for empty query', () => {
    const container = createDiffDOM('hello world')
    expect(findMatchesInContainer(container, '')).toHaveLength(0)
  })

  it('returns empty array when no matches found', () => {
    const container = createDiffDOM('hello world')
    expect(findMatchesInContainer(container, 'xyz')).toHaveLength(0)
  })

  it('returns empty array for empty container with no diff-line-content-item elements', () => {
    const container = document.createElement('div')
    expect(findMatchesInContainer(container, 'hello')).toHaveLength(0)
  })

  it('finds a single match in simple text content', () => {
    const container = createDiffDOM('hello world')
    const matches = findMatchesInContainer(container, 'hello')
    expect(matches).toHaveLength(1)
    expect(matches[0]).toBeInstanceOf(Range)
  })

  it('finds multiple occurrences of the same query within a single line', () => {
    const container = createDiffDOM('foo foo foo')
    const matches = findMatchesInContainer(container, 'foo')
    expect(matches).toHaveLength(3)
  })

  it('finds matches across multiple .diff-line-content-item elements', () => {
    const container = createDiffDOM(
      'import React from "react"',
      'import { useState } from "react"',
    )
    const matches = findMatchesInContainer(container, 'import')
    expect(matches).toHaveLength(2)
  })

  it('is case-insensitive by default — finds HELLO when searching hello', () => {
    const container = createDiffDOM('HELLO World')
    expect(findMatchesInContainer(container, 'hello')).toHaveLength(1)
  })

  it('is case-insensitive by default — finds IMPORT when searching IMPORT', () => {
    const container = createDiffDOM('import React from "react"')
    expect(findMatchesInContainer(container, 'IMPORT')).toHaveLength(1)
  })

  it('respects caseSensitive: true — does not match wrong case', () => {
    const container = createDiffDOM('HELLO world')
    expect(
      findMatchesInContainer(container, 'hello', { caseSensitive: true }),
    ).toHaveLength(0)
  })

  it('respects caseSensitive: true — matches exact case', () => {
    const container = createDiffDOM('Hello world')
    expect(
      findMatchesInContainer(container, 'Hello', { caseSensitive: true }),
    ).toHaveLength(1)
  })

  it('handles syntax-highlighted span fragmentation — matches across two spans', () => {
    // Simulates <span>class</span><span>Name</span> → "className" search
    const container = createFragmentedLine(['class', 'Name'])
    const matches = findMatchesInContainer(container, 'className')
    expect(matches).toHaveLength(1)
  })

  it('handles syntax-highlighted span fragmentation — matches across three spans', () => {
    const container = createFragmentedLine(['con', 'st ', 'foo'])
    const matches = findMatchesInContainer(container, 'const foo')
    expect(matches).toHaveLength(1)
  })

  it('handles fragmented spans — partial match does not bleed across fragments', () => {
    const container = createFragmentedLine(['hello', 'world'])
    expect(findMatchesInContainer(container, 'hello')).toHaveLength(1)
    expect(findMatchesInContainer(container, 'world')).toHaveLength(1)
  })

  it('skips text content outside .diff-line-content-item', () => {
    const container = document.createElement('div')

    const outsideDiv = document.createElement('div')
    outsideDiv.textContent = 'hello'
    container.appendChild(outsideDiv)

    const contentItem = document.createElement('div')
    contentItem.className = 'diff-line-content-item'
    const span = document.createElement('span')
    span.textContent = 'world'
    contentItem.appendChild(span)
    container.appendChild(contentItem)

    expect(findMatchesInContainer(container, 'hello')).toHaveLength(0)
    expect(findMatchesInContainer(container, 'world')).toHaveLength(1)
  })

  it('skips text inside .diff-line-content-operator spans', () => {
    const container = createDiffDOM('some code')
    expect(findMatchesInContainer(container, '+')).toHaveLength(0)
  })

  it('returns Range objects with startContainer and endContainer set', () => {
    const container = createDiffDOM('const x = 1')
    const matches = findMatchesInContainer(container, 'const')
    expect(matches[0].startContainer).toBeDefined()
    expect(matches[0].endContainer).toBeDefined()
  })

  it('finds overlapping matches by advancing search position by 1', () => {
    // 'aa' appears twice in 'aaa': at index 0 and at index 1
    const container = createDiffDOM('aaa')
    expect(findMatchesInContainer(container, 'aa')).toHaveLength(2)
  })
})

// ============================================================================
// applySearchHighlights Tests
// ============================================================================

describe('applySearchHighlights', () => {
  beforeEach(() => {
    mockHighlights.clear()
  })

  it('sets diff-search-match highlight with all match ranges', () => {
    const container = createDiffDOM('hello world', 'hello there')
    const matches = findMatchesInContainer(container, 'hello')

    applySearchHighlights(matches, 0)

    expect(mockHighlights.has('diff-search-match')).toBe(true)
  })

  it('diff-search-match contains all ranges', () => {
    const container = createDiffDOM('hello world', 'hello there')
    const matches = findMatchesInContainer(container, 'hello')

    applySearchHighlights(matches, 0)

    const matchHighlight = mockHighlights.get('diff-search-match') as MockHighlight
    expect(matchHighlight.ranges).toHaveLength(2)
  })

  it('sets diff-search-current highlight for the given currentIndex', () => {
    const container = createDiffDOM('hello world', 'hello there')
    const matches = findMatchesInContainer(container, 'hello')

    applySearchHighlights(matches, 1)

    expect(mockHighlights.has('diff-search-current')).toBe(true)
  })

  it('diff-search-current contains only the range at currentIndex', () => {
    const container = createDiffDOM('hello world', 'hello there')
    const matches = findMatchesInContainer(container, 'hello')

    applySearchHighlights(matches, 0)

    const currentHighlight = mockHighlights.get('diff-search-current') as MockHighlight
    expect(currentHighlight.ranges).toHaveLength(1)
    expect(currentHighlight.ranges[0]).toBe(matches[0])
  })

  it('diff-search-current uses second match when currentIndex is 1', () => {
    const container = createDiffDOM('hello world', 'hello there')
    const matches = findMatchesInContainer(container, 'hello')

    applySearchHighlights(matches, 1)

    const currentHighlight = mockHighlights.get('diff-search-current') as MockHighlight
    expect(currentHighlight.ranges[0]).toBe(matches[1])
  })

  it('clears both highlights when matches array is empty', () => {
    mockHighlights.set('diff-search-match', {})
    mockHighlights.set('diff-search-current', {})

    applySearchHighlights([], 0)

    expect(mockHighlights.has('diff-search-match')).toBe(false)
    expect(mockHighlights.has('diff-search-current')).toBe(false)
  })

  it('deletes diff-search-current when currentIndex is out of bounds (too high)', () => {
    const container = createDiffDOM('hello world')
    const matches = findMatchesInContainer(container, 'hello')
    mockHighlights.set('diff-search-current', {})

    applySearchHighlights(matches, 99)

    expect(mockHighlights.has('diff-search-current')).toBe(false)
  })

  it('deletes diff-search-current when currentIndex is negative', () => {
    const container = createDiffDOM('hello world')
    const matches = findMatchesInContainer(container, 'hello')
    mockHighlights.set('diff-search-current', {})

    applySearchHighlights(matches, -1)

    expect(mockHighlights.has('diff-search-current')).toBe(false)
  })

  it('handles single match at index 0 correctly', () => {
    const container = createDiffDOM('hello world')
    const matches = findMatchesInContainer(container, 'hello')

    applySearchHighlights(matches, 0)

    expect(mockHighlights.has('diff-search-match')).toBe(true)
    expect(mockHighlights.has('diff-search-current')).toBe(true)
    const currentHighlight = mockHighlights.get('diff-search-current') as MockHighlight
    expect(currentHighlight.ranges).toHaveLength(1)
  })
})

// ============================================================================
// clearSearchHighlights Tests
// ============================================================================

describe('clearSearchHighlights', () => {
  beforeEach(() => {
    mockHighlights.clear()
  })

  it('removes diff-search-match from CSS.highlights', () => {
    mockHighlights.set('diff-search-match', {})

    clearSearchHighlights()

    expect(mockHighlights.has('diff-search-match')).toBe(false)
  })

  it('removes diff-search-current from CSS.highlights', () => {
    mockHighlights.set('diff-search-current', {})

    clearSearchHighlights()

    expect(mockHighlights.has('diff-search-current')).toBe(false)
  })

  it('removes both highlights simultaneously', () => {
    mockHighlights.set('diff-search-match', {})
    mockHighlights.set('diff-search-current', {})

    clearSearchHighlights()

    expect(mockHighlights.size).toBe(0)
  })

  it('is idempotent — does not throw when highlights are already absent', () => {
    expect(() => clearSearchHighlights()).not.toThrow()
    expect(mockHighlights.size).toBe(0)
  })

  it('does not remove unrelated highlight entries', () => {
    mockHighlights.set('diff-occurrence-match', {})
    mockHighlights.set('diff-search-match', {})
    mockHighlights.set('diff-search-current', {})

    clearSearchHighlights()

    expect(mockHighlights.has('diff-occurrence-match')).toBe(true)
  })
})

// ============================================================================
// applyOccurrenceHighlights Tests
// ============================================================================

describe('applyOccurrenceHighlights', () => {
  beforeEach(() => {
    mockHighlights.clear()
  })

  it('sets diff-occurrence-match highlight with the given ranges', () => {
    const container = createDiffDOM('hello world')
    const matches = findMatchesInContainer(container, 'hello')

    applyOccurrenceHighlights(matches)

    expect(mockHighlights.has('diff-occurrence-match')).toBe(true)
  })

  it('stores all match ranges inside diff-occurrence-match', () => {
    const container = createDiffDOM('foo bar', 'foo baz')
    const matches = findMatchesInContainer(container, 'foo')

    applyOccurrenceHighlights(matches)

    const highlight = mockHighlights.get('diff-occurrence-match') as MockHighlight
    expect(highlight.ranges).toHaveLength(2)
  })

  it('clears diff-occurrence-match when matches array is empty', () => {
    mockHighlights.set('diff-occurrence-match', {})

    applyOccurrenceHighlights([])

    expect(mockHighlights.has('diff-occurrence-match')).toBe(false)
  })

  it('does not touch search highlight entries', () => {
    mockHighlights.set('diff-search-match', {})
    const container = createDiffDOM('hello world')
    const matches = findMatchesInContainer(container, 'hello')

    applyOccurrenceHighlights(matches)

    expect(mockHighlights.has('diff-search-match')).toBe(true)
  })
})

// ============================================================================
// clearOccurrenceHighlights Tests
// ============================================================================

describe('clearOccurrenceHighlights', () => {
  beforeEach(() => {
    mockHighlights.clear()
  })

  it('removes diff-occurrence-match from CSS.highlights', () => {
    mockHighlights.set('diff-occurrence-match', {})

    clearOccurrenceHighlights()

    expect(mockHighlights.has('diff-occurrence-match')).toBe(false)
  })

  it('is idempotent — does not throw when highlight is already absent', () => {
    expect(() => clearOccurrenceHighlights()).not.toThrow()
  })

  it('does not remove diff-search-match or diff-search-current entries', () => {
    mockHighlights.set('diff-occurrence-match', {})
    mockHighlights.set('diff-search-match', {})

    clearOccurrenceHighlights()

    expect(mockHighlights.has('diff-search-match')).toBe(true)
    expect(mockHighlights.has('diff-occurrence-match')).toBe(false)
  })
})

// ============================================================================
// getWordAtSelection Tests
// ============================================================================

describe('getWordAtSelection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when window.getSelection() returns null', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(null)
    expect(getWordAtSelection()).toBeNull()
  })

  it('returns null when selection is collapsed (cursor only, no range)', () => {
    const textNode = document.createTextNode('hello')
    const mockSelection = {
      isCollapsed: true,
      rangeCount: 1,
      anchorNode: textNode,
      toString: () => 'hello',
    } as unknown as Selection
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBeNull()
  })

  it('returns null when rangeCount is 0', () => {
    const textNode = document.createTextNode('hello')
    const mockSelection = {
      isCollapsed: false,
      rangeCount: 0,
      anchorNode: textNode,
      toString: () => 'hello',
    } as unknown as Selection
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBeNull()
  })

  it('returns null when anchorNode is null', () => {
    const mockSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: null,
      toString: () => 'hello',
    } as unknown as Selection
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBeNull()
  })

  it('returns null when selection anchor is outside .diff-line-content-item', () => {
    const outsideDiv = document.createElement('div')
    outsideDiv.textContent = 'hello'
    const textNode = outsideDiv.firstChild as Text

    const mockSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textNode,
      toString: () => 'hello',
    } as unknown as Selection
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBeNull()
  })

  it('returns trimmed selected text when anchor is a direct child of .diff-line-content-item', () => {
    const contentItem = document.createElement('div')
    contentItem.className = 'diff-line-content-item'
    const textNode = document.createTextNode('hello')
    contentItem.appendChild(textNode)

    const mockSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textNode,
      toString: () => 'hello',
    } as unknown as Selection
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBe('hello')
  })

  it('returns trimmed selected text when anchor is nested inside .diff-line-content-item', () => {
    const contentItem = document.createElement('div')
    contentItem.className = 'diff-line-content-item'
    const span = document.createElement('span')
    span.textContent = 'nested'
    contentItem.appendChild(span)
    const textNode = span.firstChild as Text

    const mockSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textNode,
      toString: () => 'nested',
    } as unknown as Selection
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBe('nested')
  })

  it('finds .diff-line-content-item through deeply nested elements', () => {
    const contentItem = document.createElement('div')
    contentItem.className = 'diff-line-content-item'
    const outer = document.createElement('span')
    const inner = document.createElement('span')
    inner.textContent = 'deep'
    outer.appendChild(inner)
    contentItem.appendChild(outer)
    const textNode = inner.firstChild as Text

    const mockSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textNode,
      toString: () => 'deep',
    } as unknown as Selection
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBe('deep')
  })

  it('returns null when selected text is only whitespace', () => {
    const contentItem = document.createElement('div')
    contentItem.className = 'diff-line-content-item'
    const textNode = document.createTextNode('   ')
    contentItem.appendChild(textNode)

    const mockSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textNode,
      toString: () => '   ',
    } as unknown as Selection
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBeNull()
  })

  it('trims leading and trailing whitespace from selected text', () => {
    const contentItem = document.createElement('div')
    contentItem.className = 'diff-line-content-item'
    const textNode = document.createTextNode('  hello  ')
    contentItem.appendChild(textNode)

    const mockSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textNode,
      toString: () => '  hello  ',
    } as unknown as Selection
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBe('hello')
  })
})

// ============================================================================
// scrollToMatch Tests
// ============================================================================

describe('scrollToMatch', () => {
  it('calls scrollIntoView on the range start container parent element', () => {
    const contentItem = document.createElement('div')
    contentItem.className = 'diff-line-content-item'
    const span = document.createElement('span')
    span.textContent = 'hello'
    contentItem.appendChild(span)
    document.body.appendChild(contentItem)

    const scrollIntoViewMock = vi.fn()
    span.scrollIntoView = scrollIntoViewMock

    const range = document.createRange()
    range.setStart(span.firstChild!, 0)
    range.setEnd(span.firstChild!, 5)

    scrollToMatch(range)

    expect(scrollIntoViewMock).toHaveBeenCalledOnce()
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })

    document.body.removeChild(contentItem)
  })

  it('does not throw when the range start container has no parent element', () => {
    // A detached text node has parentElement === null
    const textNode = document.createTextNode('hello')
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 5)

    expect(() => scrollToMatch(range)).not.toThrow()
  })

  it('does not call scrollIntoView when parentElement is null', () => {
    const textNode = document.createTextNode('hello')
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 5)

    scrollToMatch(range)
  })
})
