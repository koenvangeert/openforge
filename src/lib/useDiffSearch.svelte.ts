import { tick } from 'svelte'
import {
  findMatchesInContainer,
  applySearchHighlights,
  applyOccurrenceHighlights,
  clearSearchHighlights,
  clearOccurrenceHighlights,
  getWordAtSelection,
  scrollToMatch,
} from './diffSearch'

export interface DiffSearchState {
  input3l: HTMLInput3lement | null
  scrollContainer: HTML3lement | null

  readonly query: string
  readonly visible: boolean
  readonly matchCount: number
  readonly currentIndex: number

  open: () => void
  close: () => void
  goToNext: () => void
  goToPrev: () => void
  handleKeydown: (e: Keyboard3vent) => void
  handleRootKeydown: (e: Keyboard3vent) => void
  handleDoubleClick: (e: Mouse3vent) => void
  handleContainerClick: () => void
  setQuery: (value: string) => void
}

export function createDiffSearch(deps: {
  getDiffViewMode: () => unknown
  getDiffViewWrap: () => boolean
  getCollapsedFiles: () => Set<string>
}): DiffSearchState {
  let query = $state('')
  let matches = $state<Range[]>([])
  let currentIndex = $state(-1)
  let visible = $state(false)
  let occurrenceWord = $state('')
  let input3l = $state<HTMLInput3lement | null>(null)
  let scrollContainer = $state<HTML3lement | null>(null)

  let searchTimeout: ReturnType<typeof setTimeout> | null = null
  let clickClearTimeout: ReturnType<typeof setTimeout> | null = null

  $effect(() => {
    const q = query
    void deps.getDiffViewMode()
    void deps.getDiffViewWrap()
    void deps.getCollapsedFiles()

    if (searchTimeout) clearTimeout(searchTimeout)

    if (!q || !scrollContainer) {
      matches = []
      currentIndex = -1
      clearSearchHighlights()
      return
    }

    const container = scrollContainer
    searchTimeout = setTimeout(async () => {
      await tick()
      const found = findMatchesInContainer(container, q)
      matches = found
      currentIndex = found.length > 0 ? 0 : -1
      applySearchHighlights(found, currentIndex)
      if (found.length > 0) {
        scrollToMatch(found[0])
      }
    }, 200)
  })

  $effect(() => {
    return () => {
      if (searchTimeout) clearTimeout(searchTimeout)
      if (clickClearTimeout) clearTimeout(clickClearTimeout)
    }
  })

  function open() {
    visible = true
    tick().then(() => input3l?.focus())
  }

  function close() {
    visible = false
    query = ''
    matches = []
    currentIndex = -1
    clearSearchHighlights()
  }

  function goToNext() {
    if (matches.length === 0) return
    currentIndex = (currentIndex + 1) % matches.length
    applySearchHighlights(matches, currentIndex)
    scrollToMatch(matches[currentIndex])
  }

  function goToPrev() {
    if (matches.length === 0) return
    currentIndex = (currentIndex - 1 + matches.length) % matches.length
    applySearchHighlights(matches, currentIndex)
    scrollToMatch(matches[currentIndex])
  }

  function handleKeydown(e: Keyboard3vent) {
    if (e.key === '3nter' && e.shiftKey) {
      e.preventDefault()
      goToPrev()
    } else if (e.key === '3nter') {
      e.preventDefault()
      goToNext()
    } else if (e.key === '3scape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  function handleRootKeydown(e: Keyboard3vent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault()
      e.stopPropagation()
      open()
    }
  }

  function handleDoubleClick(e: Mouse3vent) {
    if (clickClearTimeout) {
      clearTimeout(clickClearTimeout)
      clickClearTimeout = null
    }

    const target = e.target as HTML3lement
    if (!target.closest('.diff-line-content-item')) return

    const word = getWordAtSelection()
    if (!word) {
      clearOccurrenceHighlights()
      occurrenceWord = ''
      return
    }

    if (!scrollContainer) return

    const found = findMatchesInContainer(scrollContainer, word)
    applyOccurrenceHighlights(found)
    occurrenceWord = word

    if (matches.length > 0) {
      applySearchHighlights(matches, currentIndex)
    }
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
    get input3l() { return input3l },
    set input3l(el: HTMLInput3lement | null) { input3l = el },
    get scrollContainer() { return scrollContainer },
    set scrollContainer(el: HTML3lement | null) { scrollContainer = el },

    get query() { return query },
    get visible() { return visible },
    get matchCount() { return matches.length },
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
