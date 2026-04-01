import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useVimNavigation } from './useVimNavigation.svelte'

// Mock domUtils to control isInputFocused
vi.mock('./domUtils', () => ({
  isInputFocused: vi.fn(() => false),
}))

import { isInputFocused } from './domUtils'
const mockIsInputFocused = vi.mocked(isInputFocused)

function makeKeyEvent(key: string, overrides: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    bubbles: true,
    cancelable: true,
    ...overrides,
  })
  vi.spyOn(event, 'preventDefault')
  vi.spyOn(event, 'stopPropagation')
  return event
}

describe('useVimNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsInputFocused.mockReturnValue(false)
  })

  it('initializes with focusedIndex 0', () => {
    const nav = useVimNavigation({ getItemCount: () => 5 })
    expect(nav.focusedIndex).toBe(0)
  })

  describe('j/k navigation', () => {
    it('j moves focus down', () => {
      const nav = useVimNavigation({ getItemCount: () => 5 })
      nav.handleKeydown(makeKeyEvent('j'))
      expect(nav.focusedIndex).toBe(1)
    })

    it('k moves focus up', () => {
      const nav = useVimNavigation({ getItemCount: () => 5 })
      nav.setFocusedIndex(3)
      nav.handleKeydown(makeKeyEvent('k'))
      expect(nav.focusedIndex).toBe(2)
    })

    it('j clamps at last item', () => {
      const nav = useVimNavigation({ getItemCount: () => 3 })
      nav.setFocusedIndex(2)
      nav.handleKeydown(makeKeyEvent('j'))
      expect(nav.focusedIndex).toBe(2)
    })

    it('k clamps at first item', () => {
      const nav = useVimNavigation({ getItemCount: () => 3 })
      nav.handleKeydown(makeKeyEvent('k'))
      expect(nav.focusedIndex).toBe(0)
    })

    it('j/k do nothing when item count is 0', () => {
      const nav = useVimNavigation({ getItemCount: () => 0 })
      nav.handleKeydown(makeKeyEvent('j'))
      expect(nav.focusedIndex).toBe(0)
      nav.handleKeydown(makeKeyEvent('k'))
      expect(nav.focusedIndex).toBe(0)
    })
  })

  describe('G and gg', () => {
    it('G jumps to last item', () => {
      const nav = useVimNavigation({ getItemCount: () => 5 })
      nav.handleKeydown(makeKeyEvent('G'))
      expect(nav.focusedIndex).toBe(4)
    })

    it('gg jumps to first item', () => {
      const nav = useVimNavigation({ getItemCount: () => 5 })
      nav.setFocusedIndex(4)
      nav.handleKeydown(makeKeyEvent('g'))
      nav.handleKeydown(makeKeyEvent('g'))
      expect(nav.focusedIndex).toBe(0)
    })
  })

  describe('Enter / select', () => {
    it('Enter calls onSelect with focused index', () => {
      const onSelect = vi.fn()
      const nav = useVimNavigation({ getItemCount: () => 5, onSelect })
      nav.setFocusedIndex(2)
      nav.handleKeydown(makeKeyEvent('Enter'))
      expect(onSelect).toHaveBeenCalledWith(2)
    })

    it('Enter does nothing when no items', () => {
      const onSelect = vi.fn()
      const nav = useVimNavigation({ getItemCount: () => 0, onSelect })
      nav.handleKeydown(makeKeyEvent('Enter'))
      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  describe('Escape / q', () => {
    it('Escape calls onBack', () => {
      const onBack = vi.fn()
      const nav = useVimNavigation({ getItemCount: () => 5, onBack })
      nav.handleKeydown(makeKeyEvent('Escape'))
      expect(onBack).toHaveBeenCalled()
    })

    it('q calls onBack', () => {
      const onBack = vi.fn()
      const nav = useVimNavigation({ getItemCount: () => 5, onBack })
      nav.handleKeydown(makeKeyEvent('q'))
      expect(onBack).toHaveBeenCalled()
    })
  })

  describe('x / action', () => {
    it('x calls onAction with focused index', () => {
      const onAction = vi.fn()
      const nav = useVimNavigation({ getItemCount: () => 5, onAction })
      nav.setFocusedIndex(1)
      nav.handleKeydown(makeKeyEvent('x'))
      expect(onAction).toHaveBeenCalledWith(1)
    })
  })

  describe('h/l (left/right)', () => {
    it('h calls onLeft', () => {
      const onLeft = vi.fn()
      const nav = useVimNavigation({ getItemCount: () => 5, onLeft })
      nav.handleKeydown(makeKeyEvent('h'))
      expect(onLeft).toHaveBeenCalled()
    })

    it('l calls onRight', () => {
      const onRight = vi.fn()
      const nav = useVimNavigation({ getItemCount: () => 5, onRight })
      nav.handleKeydown(makeKeyEvent('l'))
      expect(onRight).toHaveBeenCalled()
    })
  })

  describe('input focus guard', () => {
    it('skips all keys when input is focused', () => {
      mockIsInputFocused.mockReturnValue(true)
      const onSelect = vi.fn()
      const nav = useVimNavigation({ getItemCount: () => 5, onSelect })
      nav.handleKeydown(makeKeyEvent('j'))
      nav.handleKeydown(makeKeyEvent('Enter'))
      expect(nav.focusedIndex).toBe(0)
      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  describe('modifier guard', () => {
    it('skips keys with meta/ctrl/alt modifiers', () => {
      const nav = useVimNavigation({ getItemCount: () => 5 })
      nav.handleKeydown(makeKeyEvent('j', { metaKey: true }))
      expect(nav.focusedIndex).toBe(0)
      nav.handleKeydown(makeKeyEvent('j', { ctrlKey: true }))
      expect(nav.focusedIndex).toBe(0)
    })
  })

  describe('setFocusedIndex', () => {
    it('clamps to valid range', () => {
      const nav = useVimNavigation({ getItemCount: () => 3 })
      nav.setFocusedIndex(10)
      expect(nav.focusedIndex).toBe(2)
      nav.setFocusedIndex(-1)
      expect(nav.focusedIndex).toBe(0)
    })
  })
})
