import { describe, it, expect, vi } from 'vitest'
import { useListNavigation } from './useListNavigation.svelte'

describe('useListNavigation', () => {
  it('handles wrap-around navigation down', () => {
    let selectedIndex = 2
    const config = {
      get itemCount() { return 3 },
      get selectedIndex() { return selectedIndex },
      set selectedIndex(val) { selectedIndex = val },
      wrap: true,
    }
    const { handleKeydown } = useListNavigation(config)
    
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown' })
    vi.spyOn(event, 'preventDefault')
    vi.spyOn(event, 'stopPropagation')
    
    const handled = handleKeydown(event)
    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(selectedIndex).toBe(0)
  })

  it('handles clamping navigation up', () => {
    let selectedIndex = 0
    const config = {
      get itemCount() { return 3 },
      get selectedIndex() { return selectedIndex },
      set selectedIndex(val) { selectedIndex = val },
      wrap: false,
    }
    const { handleKeydown } = useListNavigation(config)
    
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp' })
    vi.spyOn(event, 'preventDefault')
    
    const handled = handleKeydown(event)
    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(selectedIndex).toBe(0)
  })

  it('handles vim-style navigation down (Ctrl+J)', () => {
    let selectedIndex = 0
    const config = {
      get itemCount() { return 3 },
      get selectedIndex() { return selectedIndex },
      set selectedIndex(val) { selectedIndex = val },
    }
    const { handleKeydown } = useListNavigation(config)
    
    const event = new KeyboardEvent('keydown', { key: 'j', ctrlKey: true })
    const handled = handleKeydown(event)
    expect(handled).toBe(true)
    expect(selectedIndex).toBe(1)
  })

  it('triggers onSelect for Enter', () => {
    const onSelect = vi.fn()
    const config = {
      get itemCount() { return 3 },
      get selectedIndex() { return 0 },
      set selectedIndex(_val) {},
      onSelect
    }
    const { handleKeydown } = useListNavigation(config)
    
    const event = new KeyboardEvent('keydown', { key: 'Enter' })
    const handled = handleKeydown(event)
    expect(handled).toBe(true)
    expect(onSelect).toHaveBeenCalled()
  })

  it('triggers onCancel for Escape', () => {
    const onCancel = vi.fn()
    const config = {
      get itemCount() { return 3 },
      get selectedIndex() { return 0 },
      set selectedIndex(_val) {},
      onCancel
    }
    const { handleKeydown } = useListNavigation(config)
    
    const event = new KeyboardEvent('keydown', { key: 'Escape' })
    const handled = handleKeydown(event)
    expect(handled).toBe(true)
    expect(onCancel).toHaveBeenCalled()
  })

  it('returns false for unhandled keys', () => {
    const config = {
      get itemCount() { return 3 },
      get selectedIndex() { return 0 },
      set selectedIndex(_val) {}
    }
    const { handleKeydown } = useListNavigation(config)
    
    const event = new KeyboardEvent('keydown', { key: 'a' })
    const handled = handleKeydown(event)
    expect(handled).toBe(false)
  })

  it('does nothing if list is empty (except Escape)', () => {
    let selectedIndex = 0
    const onCancel = vi.fn()
    const config = {
      get itemCount() { return 0 },
      get selectedIndex() { return selectedIndex },
      set selectedIndex(val) { selectedIndex = val },
      onCancel
    }
    const { handleKeydown } = useListNavigation(config)
    
    const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown' })
    expect(handleKeydown(downEvent)).toBe(false)
    expect(selectedIndex).toBe(0)

    const escEvent = new KeyboardEvent('keydown', { key: 'Escape' })
    expect(handleKeydown(escEvent)).toBe(true)
    expect(onCancel).toHaveBeenCalled()
  })
})
