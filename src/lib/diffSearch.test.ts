import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  findMatchesInContainer,
  applySearchHighlights,
  clearSearchHighlights,
  applyOccurrenceHighlights,
  clearOccurrenceHighlights,
  getWordAtSelection,
  scrollToMatch,
  countMatchesInPatch,
} from './diffSearch'

// ============================================================================
// CSS Custom Highlight API Mocks
// ============================================================================

// jsdom does not support the CSS Custom Highlight API, so we mock it here.
// CSS.highlights is a HighlightRegistry (Map-like), and Highlight is a class
// that accepts Range objects in its constructor.

const mockHighlights = new Map<string, MockHighlight | object>()

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

Object.defineProperty(globalThis, 'Highlight', {
  value: MockHighlight,
  writable: true,
  configurable: true,
})

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

function appendText(parent: Node, text: string): Text {
  const textNode = document.createTextNode(text)
  parent.appendChild(textNode)
  return textNode
}

function getMockHighlight(name: string): MockHighlight {
  const highlight = mockHighlights.get(name)
  if (!(highlight instanceof MockHighlight)) {
    throw new Error(`Expected ${name} highlight to be a MockHighlight instance`)
  }
  return highlight
}

interface MockSelectionOptions {
  isCollapsed: boolean
  rangeCount: number
  anchorNode: Node | null
  text: string
}

class MockSelection implements Selection {
  readonly anchorNode
  readonly anchorOffset = 0
  readonly focusNode
  readonly focusOffset = 0
  readonly isCollapsed
  readonly rangeCount
  readonly type

  private readonly text

  constructor({ isCollapsed, rangeCount, anchorNode, text }: MockSelectionOptions) {
    this.anchorNode = anchorNode
    this.focusNode = anchorNode
    this.isCollapsed = isCollapsed
    this.rangeCount = rangeCount
    this.type = rangeCount > 0 ? 'Range' : 'None'
    this.text = text
  }

  addRange(_range: Range): void {
    throw new Error('MockSelection.addRange is not implemented for this test')
  }

  collapse(_node?: Node | null, _offset?: number): void {
    throw new Error('MockSelection.collapse is not implemented for this test')
  }

  collapseToEnd(): void {
    throw new Error('MockSelection.collapseToEnd is not implemented for this test')
  }

  collapseToStart(): void {
    throw new Error('MockSelection.collapseToStart is not implemented for this test')
  }

  containsNode(_node: Node, _allowPartialContainment?: boolean): boolean {
    throw new Error('MockSelection.containsNode is not implemented for this test')
  }

  deleteFromDocument(): void {
    throw new Error('MockSelection.deleteFromDocument is not implemented for this test')
  }

  empty(): void {
    throw new Error('MockSelection.empty is not implemented for this test')
  }

  extend(_node: Node, _offset?: number): void {
    throw new Error('MockSelection.extend is not implemented for this test')
  }

  getRangeAt(_index: number): Range {
    throw new Error('MockSelection.getRangeAt is not implemented for this test')
  }

  modify(_alter?: string, _direction?: string, _granularity?: string): void {
    throw new Error('MockSelection.modify is not implemented for this test')
  }

  removeAllRanges(): void {
    throw new Error('MockSelection.removeAllRanges is not implemented for this test')
  }

  removeRange(_range: Range): void {
    throw new Error('MockSelection.removeRange is not implemented for this test')
  }

  selectAllChildren(_node: Node): void {
    throw new Error('MockSelection.selectAllChildren is not implemented for this test')
  }

  setBaseAndExtent(
    _anchorNode: Node,
    _anchorOffset: number,
    _focusNode: Node,
    _focusOffset: number,
  ): void {
    throw new Error('MockSelection.setBaseAndExtent is not implemented for this test')
  }

  setPosition(_node?: Node | null, _offset?: number): void {
    throw new Error('MockSelection.setPosition is not implemented for this test')
  }

  toString(): string {
    return this.text
  }
}

function createSelection(options: MockSelectionOptions): Selection {
  return new MockSelection(options)
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

    applySearchHighlights(matches, matches[0])

    expect(mockHighlights.has('diff-search-match')).toBe(true)
  })

  it('diff-search-match contains all ranges', () => {
    const container = createDiffDOM('hello world', 'hello there')
    const matches = findMatchesInContainer(container, 'hello')

    applySearchHighlights(matches, matches[0])

    const matchHighlight = getMockHighlight('diff-search-match')
    expect(matchHighlight.ranges).toHaveLength(2)
  })

  it('sets diff-search-current highlight for the given currentRange', () => {
    const container = createDiffDOM('hello world', 'hello there')
    const matches = findMatchesInContainer(container, 'hello')

    applySearchHighlights(matches, matches[1])

    expect(mockHighlights.has('diff-search-current')).toBe(true)
  })

  it('diff-search-current contains only the provided currentRange', () => {
    const container = createDiffDOM('hello world', 'hello there')
    const matches = findMatchesInContainer(container, 'hello')

    applySearchHighlights(matches, matches[0])

    const currentHighlight = getMockHighlight('diff-search-current')
    expect(currentHighlight.ranges).toHaveLength(1)
    expect(currentHighlight.ranges[0]).toBe(matches[0])
  })

  it('diff-search-current uses the provided range when it is the second match', () => {
    const container = createDiffDOM('hello world', 'hello there')
    const matches = findMatchesInContainer(container, 'hello')

    applySearchHighlights(matches, matches[1])

    const currentHighlight = getMockHighlight('diff-search-current')
    expect(currentHighlight.ranges[0]).toBe(matches[1])
  })

  it('clears both highlights when matches array is empty', () => {
    mockHighlights.set('diff-search-match', {})
    mockHighlights.set('diff-search-current', {})

    applySearchHighlights([], null)

    expect(mockHighlights.has('diff-search-match')).toBe(false)
    expect(mockHighlights.has('diff-search-current')).toBe(false)
  })

  it('deletes diff-search-current when currentRange is null', () => {
    const container = createDiffDOM('hello world')
    const matches = findMatchesInContainer(container, 'hello')
    mockHighlights.set('diff-search-current', {})

    applySearchHighlights(matches, null)

    expect(mockHighlights.has('diff-search-current')).toBe(false)
  })

  it('handles single match with its range as current', () => {
    const container = createDiffDOM('hello world')
    const matches = findMatchesInContainer(container, 'hello')

    applySearchHighlights(matches, matches[0])

    expect(mockHighlights.has('diff-search-match')).toBe(true)
    expect(mockHighlights.has('diff-search-current')).toBe(true)
    const currentHighlight = getMockHighlight('diff-search-current')
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

    const highlight = getMockHighlight('diff-occurrence-match')
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
    const mockSelection = createSelection({
      isCollapsed: true,
      rangeCount: 1,
      anchorNode: textNode,
      text: 'hello',
    })
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBeNull()
  })

  it('returns null when rangeCount is 0', () => {
    const textNode = document.createTextNode('hello')
    const mockSelection = createSelection({
      isCollapsed: false,
      rangeCount: 0,
      anchorNode: textNode,
      text: 'hello',
    })
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBeNull()
  })

  it('returns null when anchorNode is null', () => {
    const mockSelection = createSelection({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: null,
      text: 'hello',
    })
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBeNull()
  })

  it('returns null when selection anchor is outside .diff-line-content-item', () => {
    const outsideDiv = document.createElement('div')
    const textNode = appendText(outsideDiv, 'hello')

    const mockSelection = createSelection({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textNode,
      text: 'hello',
    })
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBeNull()
  })

  it('returns trimmed selected text when anchor is a direct child of .diff-line-content-item', () => {
    const contentItem = document.createElement('div')
    contentItem.className = 'diff-line-content-item'
    const textNode = appendText(contentItem, 'hello')

    const mockSelection = createSelection({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textNode,
      text: 'hello',
    })
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBe('hello')
  })

  it('returns trimmed selected text when anchor is nested inside .diff-line-content-item', () => {
    const contentItem = document.createElement('div')
    contentItem.className = 'diff-line-content-item'
    const span = document.createElement('span')
    const textNode = appendText(span, 'nested')
    contentItem.appendChild(span)

    const mockSelection = createSelection({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textNode,
      text: 'nested',
    })
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBe('nested')
  })

  it('finds .diff-line-content-item through deeply nested elements', () => {
    const contentItem = document.createElement('div')
    contentItem.className = 'diff-line-content-item'
    const outer = document.createElement('span')
    const inner = document.createElement('span')
    const textNode = appendText(inner, 'deep')
    outer.appendChild(inner)
    contentItem.appendChild(outer)

    const mockSelection = createSelection({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textNode,
      text: 'deep',
    })
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBe('deep')
  })

  it('returns null when selected text is only whitespace', () => {
    const contentItem = document.createElement('div')
    contentItem.className = 'diff-line-content-item'
    const textNode = appendText(contentItem, '   ')

    const mockSelection = createSelection({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textNode,
      text: '   ',
    })
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBeNull()
  })

  it('trims leading and trailing whitespace from selected text', () => {
    const contentItem = document.createElement('div')
    contentItem.className = 'diff-line-content-item'
    const textNode = appendText(contentItem, '  hello  ')

    const mockSelection = createSelection({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textNode,
      text: '  hello  ',
    })
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)

    expect(getWordAtSelection()).toBe('hello')
  })
})

// ============================================================================
// scrollToMatch Tests
// ============================================================================

// ============================================================================
// countMatchesInPatch Tests
// ============================================================================

describe('countMatchesInPatch', () => {
  // --- Basic / edge cases ---

  it('returns 0 for null patch', () => {
    expect(countMatchesInPatch(null, 'hello')).toBe(0)
  })

  it('returns 0 for empty string patch', () => {
    expect(countMatchesInPatch('', 'hello')).toBe(0)
  })

  it('returns 0 for empty query', () => {
    expect(countMatchesInPatch('+hello world', '')).toBe(0)
  })

  // --- Single line types ---

  it('counts match in added line (+ prefix)', () => {
    expect(countMatchesInPatch('+hello world', 'hello')).toBe(1)
  })

  it('counts match in removed line (- prefix)', () => {
    expect(countMatchesInPatch('-hello world', 'hello')).toBe(1)
  })

  it('counts match in context line (space prefix) once in unified mode', () => {
    expect(countMatchesInPatch(' hello world', 'hello')).toBe(1)
  })

  it('counts match in context line (space prefix) twice in split mode', () => {
    expect(countMatchesInPatch(' hello world', 'hello', { isSplitMode: true })).toBe(2)
  })

  // --- Operator exclusion ---

  it('does not match the operator prefix character itself', () => {
    expect(countMatchesInPatch('+content', '+')).toBe(0)
  })

  it('matches operator characters inside content after the prefix', () => {
    expect(countMatchesInPatch('+a + b', '+')).toBe(1)
  })

  // --- Multiple matches ---

  it('counts multiple occurrences on a single line', () => {
    expect(countMatchesInPatch('+foo foo foo', 'foo')).toBe(3)
  })

  it('counts matches across multiple lines', () => {
    const patch = '+hello world\n-goodbye hello\n hello again'
    expect(countMatchesInPatch(patch, 'hello')).toBe(3)
  })

  it('finds overlapping matches (e.g. "aa" in "aaa")', () => {
    expect(countMatchesInPatch('+aaa', 'aa')).toBe(2)
  })

  // --- Skipped lines ---

  it('skips hunk headers (@@ ... @@)', () => {
    const patch = '@@ -1,3 +1,4 @@ some context\n+hello'
    expect(countMatchesInPatch(patch, 'some')).toBe(0)
    expect(countMatchesInPatch(patch, 'hello')).toBe(1)
  })

  it('skips no-newline-at-end-of-file markers (\\ prefix)', () => {
    const patch = '+hello\n\\ No newline at end of file'
    expect(countMatchesInPatch(patch, 'No newline')).toBe(0)
    expect(countMatchesInPatch(patch, 'hello')).toBe(1)
  })

  // --- Case sensitivity ---

  it('is case-insensitive by default', () => {
    expect(countMatchesInPatch('+HELLO World', 'hello')).toBe(1)
    expect(countMatchesInPatch('+hello World', 'HELLO')).toBe(1)
  })

  it('respects caseSensitive: true — does not match wrong case', () => {
    expect(countMatchesInPatch('+HELLO World', 'hello', { caseSensitive: true })).toBe(0)
  })

  it('respects caseSensitive: true — matches exact case', () => {
    expect(countMatchesInPatch('+Hello World', 'Hello', { caseSensitive: true })).toBe(1)
  })

  // --- Complex patches ---

  it('handles multi-hunk patch correctly', () => {
    const patch = [
      '@@ -1,3 +1,4 @@ context',
      ' unchanged',
      '-removed line',
      '+added line',
      ' context',
      '@@ -10,3 +11,4 @@ more context',
      ' unchanged',
      '+new line',
    ].join('\n')
    expect(countMatchesInPatch(patch, 'line')).toBe(3)
  })

  it('handles patch with mixed line types and split mode counting', () => {
    const patch = [
      '@@ -1,3 +1,3 @@',
      ' context with target',
      '-old target removed',
      '+new target added',
    ].join('\n')
    expect(countMatchesInPatch(patch, 'target')).toBe(3)
    expect(countMatchesInPatch(patch, 'target', { isSplitMode: true })).toBe(4)
  })

  it('handles lines with no content after operator (empty content)', () => {
    const patch = '+\n-\n '
    expect(countMatchesInPatch(patch, 'anything')).toBe(0)
  })

  it('handles lines that are only an operator character', () => {
    expect(countMatchesInPatch('+', 'anything')).toBe(0)
  })

  it('skips empty lines in patch', () => {
    const patch = '+hello\n\n+world'
    expect(countMatchesInPatch(patch, 'hello')).toBe(1)
    expect(countMatchesInPatch(patch, 'world')).toBe(1)
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
    const textNode = appendText(span, 'hello')
    contentItem.appendChild(span)
    document.body.appendChild(contentItem)

    const scrollIntoViewMock = vi.fn()
    span.scrollIntoView = scrollIntoViewMock

    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 5)

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
