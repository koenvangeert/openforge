// ============================================================================
// Diff Search Engine
// ============================================================================
//
// Pure search engine for the diff viewer. Uses the CSS Custom Highlight API
// to apply non-intrusive visual highlights without touching the DOM structure.
//
// CSS Custom Highlight API requires `::highlight()` pseudo-element CSS rules
// to be defined in the consuming stylesheet:
//
//   ::highlight(diff-search-match)    { background-color: ...; }  /* amber */
//   ::highlight(diff-search-current)  { background-color: ...; }  /* bright amber */
//   ::highlight(diff-occurrence-match) { background-color: ...; } /* blue */

/** All search matches (amber) */
const SEARCH_MATCH_HIGHLIGHT = 'diff-search-match'

/** Active/current search match (bright amber) */
const SEARCH_CURRENT_HIGHLIGHT = 'diff-search-current'

/** Double-click word occurrence matches (blue) — separate from search */
const OCCURRENCE_MATCH_HIGHLIGHT = 'diff-occurrence-match'

// ============================================================================
// Internal types
// ============================================================================

/**
 * Maps a character position in a concatenated text string back to the
 * original text node and its position within the DOM subtree.
 */
interface TextNodeEntry {
  /** The actual DOM Text node */
  node: Text
  /** Inclusive start offset in the parent content item's concatenated string */
  start: number
  /** Exclusive end offset in the parent content item's concatenated string */
  end: number
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Returns true if the CSS Custom Highlight API is available in this browser.
 */
function isHighlightSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS
}

/**
 * Returns true if a node is inside a `.diff-line-content-operator` element.
 * Operator spans contain the `+`/`-`/space prefix and must not be searched.
 */
function isInsideOperator(node: Node): boolean {
  let current: Node | null = node.parentNode
  while (current !== null) {
    if (
      current instanceof Element &&
      current.classList.contains('diff-line-content-operator')
    ) {
      return true
    }
    current = current.parentNode
  }
  return false
}

/**
 * Collects all text nodes within a `.diff-line-content-item` element,
 * skipping any nodes inside `.diff-line-content-operator` spans.
 *
 * Returns an array of entries mapping each text node to its character
 * offset range within the concatenated text of the entire content item.
 */
function collectTextNodes(contentItem: Element): TextNodeEntry[] {
  const entries: TextNodeEntry[] = []
  let offset = 0

  const walker = document.createTreeWalker(contentItem, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      if (isInsideOperator(node)) {
        return NodeFilter.FILTER_SKIP
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let node: Node | null
  while ((node = walker.nextNode()) !== null) {
    const textNode = node as Text
    const length = textNode.textContent?.length ?? 0
    if (length > 0) {
      entries.push({ node: textNode, start: offset, end: offset + length })
      offset += length
    }
  }

  return entries
}

/**
 * Finds all matches of `query` within a single `.diff-line-content-item`
 * element. Handles syntax-highlighted `<span>` fragmentation by:
 *  1. Concatenating text from all non-operator text nodes.
 *  2. Searching the concatenated string with `String.indexOf`.
 *  3. Mapping match positions back to the original text nodes as `Range` objects.
 */
function findMatchesInContentItem(
  contentItem: Element,
  query: string,
  caseSensitive: boolean,
): Range[] {
  const textNodes = collectTextNodes(contentItem)
  if (textNodes.length === 0) return []

  // Build the concatenated string representation of this line's content
  const fullText = textNodes.map((e) => e.node.textContent ?? '').join('')
  const compareText = caseSensitive ? fullText : fullText.toLowerCase()
  const compareQuery = caseSensitive ? query : query.toLowerCase()

  const ranges: Range[] = []
  let searchFrom = 0

  while (searchFrom < compareText.length) {
    const matchIndex = compareText.indexOf(compareQuery, searchFrom)
    if (matchIndex === -1) break

    const matchEnd = matchIndex + compareQuery.length

    // Find the text node containing the match start
    const startEntry = textNodes.find(
      (e) => matchIndex >= e.start && matchIndex < e.end,
    )
    // Find the text node containing the match end
    const endEntry = textNodes.find(
      (e) => matchEnd > e.start && matchEnd <= e.end,
    )

    if (startEntry !== undefined && endEntry !== undefined) {
      const range = document.createRange()
      range.setStart(startEntry.node, matchIndex - startEntry.start)
      range.setEnd(endEntry.node, matchEnd - endEntry.start)
      ranges.push(range)
    }

    // Advance by 1 to allow overlapping matches to be found
    searchFrom = matchIndex + 1
  }

  return ranges
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Finds all occurrences of `query` within a container element by searching
 * inside every `.diff-line-content-item` descendant.
 *
 * Handles syntax-highlighted `<span>` fragmentation: a word like "className"
 * split across `<span>class</span><span>Name</span>` will still match
 * the query "className".
 *
 * Does NOT search inside line number cells, gutter elements, or
 * `.diff-line-content-operator` spans (the +/-/space prefix).
 *
 * @param container - The root element to search within
 * @param query - The text to search for (empty string returns [])
 * @param options - Optional search configuration
 * @param options.caseSensitive - If true, matching is case-sensitive (default: false)
 * @returns Array of Range objects representing every match position
 */
export function findMatchesInContainer(
  container: HTMLElement,
  query: string,
  options?: { caseSensitive?: boolean },
): Range[] {
  if (query.length === 0) return []

  const caseSensitive = options?.caseSensitive ?? false
  const contentItems = container.querySelectorAll('.diff-line-content-item')
  const allRanges: Range[] = []

  for (const contentItem of contentItems) {
    const matches = findMatchesInContentItem(contentItem, query, caseSensitive)
    allRanges.push(...matches)
  }

  return allRanges
}

/**
 * Registers all match ranges as the `diff-search-match` highlight and the
 * currently active match as the `diff-search-current` highlight using the
 * CSS Custom Highlight API.
 *
 * Call this after `applyOccurrenceHighlights` to ensure the current match
 * receives its distinct styling on top of the general occurrence highlight.
 *
 * No-ops silently if the browser does not support the CSS Custom Highlight API.
 *
 * @param matches - Array of all match Range objects returned by findMatchesInContainer
 * @param currentIndex - Zero-based index of the currently focused match
 */
export function applySearchHighlights(matches: Range[], currentIndex: number): void {
  if (!isHighlightSupported()) return

  if (matches.length === 0) {
    CSS.highlights.delete(SEARCH_MATCH_HIGHLIGHT)
    CSS.highlights.delete(SEARCH_CURRENT_HIGHLIGHT)
    return
  }

  CSS.highlights.set(SEARCH_MATCH_HIGHLIGHT, new Highlight(...matches))

  if (currentIndex >= 0 && currentIndex < matches.length) {
    CSS.highlights.set(SEARCH_CURRENT_HIGHLIGHT, new Highlight(matches[currentIndex]))
  } else {
    CSS.highlights.delete(SEARCH_CURRENT_HIGHLIGHT)
  }
}

/**
 * Registers all match ranges as the `diff-search-match` CSS Custom Highlight,
 * making all occurrences of the search query visible simultaneously.
 *
 * Requires `::highlight(diff-search-match) { ... }` CSS rule in the stylesheet.
 * No-ops silently if the browser does not support the CSS Custom Highlight API.
 *
 * @param matches - Array of Range objects representing all matches
 */
export function applyOccurrenceHighlights(matches: Range[]): void {
  if (!isHighlightSupported()) return

  if (matches.length === 0) {
    CSS.highlights.delete(OCCURRENCE_MATCH_HIGHLIGHT)
    return
  }

  CSS.highlights.set(OCCURRENCE_MATCH_HIGHLIGHT, new Highlight(...matches))
}

/**
 * Removes the active match CSS Custom Highlight (`diff-search-current`).
 * Call this when the search query is cleared or the search panel is closed.
 * No-ops silently if the browser does not support the CSS Custom Highlight API.
 */
export function clearSearchHighlights(): void {
  if (!isHighlightSupported()) return
  CSS.highlights.delete(SEARCH_MATCH_HIGHLIGHT)
  CSS.highlights.delete(SEARCH_CURRENT_HIGHLIGHT)
}

/**
 * Removes the all-occurrences CSS Custom Highlight (`diff-search-match`).
 * Call this when the search query is cleared or the search panel is closed.
 * No-ops silently if the browser does not support the CSS Custom Highlight API.
 */
export function clearOccurrenceHighlights(): void {
  if (!isHighlightSupported()) return
  CSS.highlights.delete(OCCURRENCE_MATCH_HIGHLIGHT)
}

/**
 * Returns the currently selected text if the selection anchor is inside
 * a `.diff-line-content-item` element. Returns null if:
 * - There is no selection or the selection is collapsed (cursor only)
 * - The selection is outside diff line content (e.g. in the UI shell)
 * - The selection text is empty after trimming
 *
 * Useful for populating the search query from a text selection.
 *
 * @returns The trimmed selected text, or null
 */
export function getWordAtSelection(): string | null {
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }

  const anchorNode = selection.anchorNode
  if (anchorNode === null) return null

  // Walk up the DOM to check if the anchor is inside a diff content item
  let current: Node | null = anchorNode
  while (current !== null) {
    if (
      current instanceof Element &&
      current.classList.contains('diff-line-content-item')
    ) {
      const text = selection.toString().trim()
      return text.length > 0 ? text : null
    }
    current = current.parentNode
  }

  return null
}

/**
 * Scrolls the viewport so that the given match Range is centered vertically,
 * using smooth scrolling animation.
 *
 * Uses `range.startContainer.parentElement.scrollIntoView()` since Range
 * objects do not have a scroll method directly.
 *
 * @param range - The Range object representing the match to scroll to
 */
export function scrollToMatch(range: Range): void {
  const element = range.startContainer.parentElement
  if (element === null) return
  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
