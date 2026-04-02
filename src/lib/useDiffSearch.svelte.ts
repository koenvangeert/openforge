import { tick } from 'svelte'
import {
  findMatchesInContainer,
  applySearchHighlights,
  applyOccurrenceHighlights,
  clearSearchHighlights,
  clearOccurrenceHighlights,
  getWordAtSelection,
  scrollToMatch,
  countMatchesInPatch,
} from './diffSearch'
import { getHTMLElement } from './domUtils'
import type { PrFileDiff } from './types'

interface FileMatchInfo {
  filename: string
  fileIndex: number
  matchCount: number
  cumulativeStart: number
}

export interface DiffSearchState {
  inputEl: HTMLInputElement | null

  readonly query: string
  readonly visible: boolean
  readonly isSearchActive: boolean
  readonly matchCount: number
  readonly currentIndex: number

  open: () => void
  close: () => void
  goToNext: () => void
  goToPrev: () => void
  handleKeydown: (e: KeyboardEvent) => void
  handleRootKeydown: (e: KeyboardEvent) => void
  handleDoubleClick: (e: MouseEvent) => void
  handleContainerClick: () => void
  setQuery: (value: string) => void
}

export function createDiffSearch(deps: {
  isSplitMode: () => boolean
  getDiffViewWrap: () => boolean
  getCollapsedFiles: () => Set<string>
  getSortedFiles: () => PrFileDiff[]
  getScrollContainer: () => HTMLElement | null
  getVisibleItems: () => unknown[]
  scrollToIndex: (index: number, opts?: { align?: string; behavior?: string }) => void
  onUncollapseFile: (filename: string) => void
}): DiffSearchState {
  let query = $state('')
  let currentIndex = $state(-1)
  let visible = $state(false)
  let occurrenceWord = $state('')
  let inputEl = $state<HTMLInputElement | null>(null)

  let totalMatchCount = $state(0)
  let fileMatchInfos = $state<FileMatchInfo[]>([])

  let searchTimeout: ReturnType<typeof setTimeout> | null = null
  let clickClearTimeout: ReturnType<typeof setTimeout> | null = null

  // ---------------------------------------------------------------------------
  // Effect 1: Text-based counting (debounced 200ms)
  // Searches patch strings — no DOM needed, works with virtualization enabled.
  // ---------------------------------------------------------------------------
  $effect(() => {
    const q = query
    const files = deps.getSortedFiles()
    const splitMode = deps.isSplitMode()

    if (searchTimeout) clearTimeout(searchTimeout)

    if (!q) {
      totalMatchCount = 0
      fileMatchInfos = []
      currentIndex = -1
      clearSearchHighlights()
      return
    }

    searchTimeout = setTimeout(() => {
      let cumulative = 0
      const infos: FileMatchInfo[] = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const count = countMatchesInPatch(file.patch, q, { isSplitMode: splitMode })
        if (count > 0) {
          infos.push({
            filename: file.filename,
            fileIndex: i,
            matchCount: count,
            cumulativeStart: cumulative,
          })
          cumulative += count
        }
      }

      totalMatchCount = cumulative
      fileMatchInfos = infos
      currentIndex = cumulative > 0 ? 0 : -1

      if (cumulative > 0) {
        navigateToCurrentMatch()
      }
    }, 200)
  })

  // ---------------------------------------------------------------------------
  // Effect 2: DOM highlights for visible files (immediate, no debounce)
  // Re-applies CSS highlights whenever visible content or navigation changes.
  // Only searches the few files currently rendered by the virtualizer.
  // ---------------------------------------------------------------------------
  $effect(() => {
    const q = query
    const idx = currentIndex
    void deps.getVisibleItems()
    void deps.getDiffViewWrap()
    void deps.getCollapsedFiles()
    void deps.isSplitMode()

    const container = deps.getScrollContainer()
    if (!q || !container) {
      clearSearchHighlights()
      return
    }

    const visibleRanges = findMatchesInContainer(container, q)

    let currentRange: Range | null = null
    if (idx >= 0) {
      const target = getTargetFileInfo(idx)
      if (target) {
        currentRange = resolveCurrentRange(container, target, q, idx)
      }
    }

    applySearchHighlights(visibleRanges, currentRange)
  })

  $effect(() => {
    return () => {
      if (searchTimeout) clearTimeout(searchTimeout)
      if (clickClearTimeout) clearTimeout(clickClearTimeout)
    }
  })

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function getTargetFileInfo(matchIndex: number): FileMatchInfo | undefined {
    for (let i = fileMatchInfos.length - 1; i >= 0; i--) {
      if (matchIndex >= fileMatchInfos[i].cumulativeStart) {
        return fileMatchInfos[i]
      }
    }
    return undefined
  }

  function resolveCurrentRange(
    container: HTMLElement,
    target: FileMatchInfo,
    q: string,
    globalIndex: number,
  ): Range | null {
    const fileEls = container.querySelectorAll('[data-diff-file]')
    for (const el of fileEls) {
      if (el.getAttribute('data-diff-file') === target.filename && el instanceof HTMLElement) {
        const fileRanges = findMatchesInContainer(el, q)
        const localIndex = globalIndex - target.cumulativeStart
        if (localIndex >= 0 && localIndex < fileRanges.length) {
          return fileRanges[localIndex]
        }
        break
      }
    }
    return null
  }

  async function navigateToCurrentMatch() {
    if (currentIndex < 0 || totalMatchCount === 0) return

    const target = getTargetFileInfo(currentIndex)
    if (!target) return

    if (deps.getCollapsedFiles().has(target.filename)) {
      deps.onUncollapseFile(target.filename)
    }

    deps.scrollToIndex(target.fileIndex, { align: 'start' })

    await tick()
    await new Promise<void>(r => requestAnimationFrame(() => r()))
    await tick()

    const container = deps.getScrollContainer()
    if (!container) return

    const range = resolveCurrentRange(container, target, query, currentIndex)
    if (range) {
      scrollToMatch(range)
    }
  }

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------

  function open() {
    visible = true
    tick().then(() => inputEl?.focus())
  }

  function close() {
    visible = false
    query = ''
    totalMatchCount = 0
    fileMatchInfos = []
    currentIndex = -1
    clearSearchHighlights()
  }

  function goToNext() {
    if (totalMatchCount === 0) return
    currentIndex = (currentIndex + 1) % totalMatchCount
    navigateToCurrentMatch()
  }

  function goToPrev() {
    if (totalMatchCount === 0) return
    currentIndex = (currentIndex - 1 + totalMatchCount) % totalMatchCount
    navigateToCurrentMatch()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      goToPrev()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      goToNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  function handleRootKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault()
      e.stopPropagation()
      open()
    }
  }

  function handleDoubleClick(e: MouseEvent) {
    if (clickClearTimeout) {
      clearTimeout(clickClearTimeout)
      clickClearTimeout = null
    }

    const clickTarget = getHTMLElement(e.target)
    if (!clickTarget) return
    if (!clickTarget.closest('.diff-line-content-item')) return

    const word = getWordAtSelection()
    if (!word) {
      clearOccurrenceHighlights()
      occurrenceWord = ''
      return
    }

    const container = deps.getScrollContainer()
    if (!container) return

    const found = findMatchesInContainer(container, word)
    applyOccurrenceHighlights(found)
    occurrenceWord = word
  }

  function handleContainerClick() {
    if (!occurrenceWord) return
    clickClearTimeout = setTimeout(() => {
      clearOccurrenceHighlights()
      occurrenceWord = ''
      clickClearTimeout = null
    }, 200)
  }

  return {
    get inputEl() { return inputEl },
    set inputEl(el: HTMLInputElement | null) { inputEl = el },

    get query() { return query },
    get visible() { return visible },
    get isSearchActive() { return visible && query.length > 0 },
    get matchCount() { return totalMatchCount },
    get currentIndex() { return currentIndex },

    open,
    close,
    goToNext,
    goToPrev,
    handleKeydown,
    handleRootKeydown,
    handleDoubleClick,
    handleContainerClick,

    setQuery(value: string) { query = value },
  }
}
