import { beforeEach, describe, it, expect, vi } from 'vitest'
import { useShortcutRegistry } from './shortcuts.svelte'

// Mock isInputFocused
vi.mock('./domUtils', () => ({
  isInputFocused: vi.fn(() => false),
}))

import { isInputFocused } from './domUtils'
const mockIsInputFocused = vi.mocked(isInputFocused)

describe('useShortcutRegistry', () => {
  beforeEach(() => {
    mockIsInputFocused.mockReset()
    mockIsInputFocused.mockReturnValue(false)
  })

  it('registers a handler that gets called when key matches', () => {
    const registry = useShortcutRegistry()
    const handler = vi.fn()

    registry.register('⌘H', handler)

    const event = new KeyboardEvent('keydown', {
      key: 'h',
      metaKey: true,
      shiftKey: false,
    })

    registry.handleKeydown(event)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('unregister removes a handler (no-op after unregister)', () => {
    const registry = useShortcutRegistry()
    const handler = vi.fn()

    registry.register('⌘H', handler)
    registry.unregister('⌘H')

    const event = new KeyboardEvent('keydown', {
      key: 'h',
      metaKey: true,
      shiftKey: false,
    })

    registry.handleKeydown(event)
    expect(handler).not.toHaveBeenCalled()
  })

  it('handleKeydown dispatches to correct handler for meta-key shortcut', () => {
    const registry = useShortcutRegistry()
    const handlerH = vi.fn()
    const handlerG = vi.fn()

    registry.register('⌘H', handlerH)
    registry.register('⌘G', handlerG)

    const eventH = new KeyboardEvent('keydown', {
      key: 'h',
      metaKey: true,
      shiftKey: false,
    })
    registry.handleKeydown(eventH)
    expect(handlerH).toHaveBeenCalledTimes(1)
    expect(handlerG).not.toHaveBeenCalled()

    const eventG = new KeyboardEvent('keydown', {
      key: 'g',
      metaKey: true,
      shiftKey: false,
    })
    registry.handleKeydown(eventG)
    expect(handlerG).toHaveBeenCalledTimes(1)
  })

  it('skips plain-key shortcuts when isInputFocused returns true', () => {
    const registry = useShortcutRegistry()
    const handler = vi.fn()

    registry.register('1', handler)

    mockIsInputFocused.mockReturnValueOnce(true)

    const event = new KeyboardEvent('keydown', {
      key: '1',
      metaKey: false,
    })

    registry.handleKeydown(event)
    expect(handler).not.toHaveBeenCalled()
  })

  it('allows plain-key shortcuts when isInputFocused returns false', () => {
    const registry = useShortcutRegistry()
    const handler = vi.fn()

    registry.register('1', handler)

    mockIsInputFocused.mockReturnValueOnce(false)

    const event = new KeyboardEvent('keydown', {
      key: '1',
      metaKey: false,
    })

    registry.handleKeydown(event)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not skip meta-key shortcuts even when isInputFocused returns true', () => {
    const registry = useShortcutRegistry()
    const handler = vi.fn()

    registry.register('⌘K', handler)

    mockIsInputFocused.mockReturnValueOnce(true)

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      shiftKey: false,
    })

    registry.handleKeydown(event)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('passes the event to the handler', () => {
    const registry = useShortcutRegistry()
    const handler = vi.fn()

    registry.register('⌘H', handler)

    const event = new KeyboardEvent('keydown', {
      key: 'h',
      metaKey: true,
      shiftKey: false,
    })

    registry.handleKeydown(event)
    expect(handler).toHaveBeenCalledWith(event)
  })

  it('prevents default on matched shortcuts', () => {
    const registry = useShortcutRegistry()
    const handler = vi.fn()

    registry.register('⌘H', handler)

    const event = new KeyboardEvent('keydown', {
      key: 'h',
      metaKey: true,
      shiftKey: false,
    })
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

    registry.handleKeydown(event)
    expect(preventDefaultSpy).toHaveBeenCalled()
  })

  it('does not prevent default on unmatched shortcuts', () => {
    const registry = useShortcutRegistry()

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: false,
    })
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

    registry.handleKeydown(event)
    expect(preventDefaultSpy).not.toHaveBeenCalled()
  })

  it('handles ? key for help dialog (plain key, checks isInputFocused)', () => {
    const registry = useShortcutRegistry()
    const handler = vi.fn()

    registry.register('?', handler)

    mockIsInputFocused.mockReturnValueOnce(false)

    const event = new KeyboardEvent('keydown', {
      key: '?',
      metaKey: false,
    })

    registry.handleKeydown(event)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('handles browser Shift+/ events for registered ? shortcuts', () => {
    const registry = useShortcutRegistry()
    const handler = vi.fn()

    registry.register('?', handler)

    mockIsInputFocused.mockReturnValueOnce(false)

    const event = new KeyboardEvent('keydown', {
      key: '?',
      shiftKey: true,
      metaKey: false,
    })

    registry.handleKeydown(event)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('matches Cmd+Shift+digit shortcuts by physical digit code when the layout reports a symbol key', () => {
    const registry = useShortcutRegistry()
    const handler = vi.fn()

    registry.register('⌘⇧1', handler)

    const event = new KeyboardEvent('keydown', {
      key: '!',
      code: 'Digit1',
      metaKey: true,
      shiftKey: true,
    })

    registry.handleKeydown(event)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('matches Cmd+digit shortcuts by physical digit code on layouts where the digit key emits punctuation', () => {
    const registry = useShortcutRegistry()
    const handler = vi.fn()

    registry.register('⌘1', handler)

    const event = new KeyboardEvent('keydown', {
      key: '&',
      code: 'Digit1',
      metaKey: true,
    })

    registry.handleKeydown(event)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not collapse shifted physical digit shortcuts onto unshifted digit registrations', () => {
    const registry = useShortcutRegistry()
    const handler = vi.fn()

    registry.register('⌘1', handler)

    const event = new KeyboardEvent('keydown', {
      key: '1',
      code: 'Digit1',
      metaKey: true,
      shiftKey: true,
    })

    registry.handleKeydown(event)
    expect(handler).not.toHaveBeenCalled()
  })

  it('still skips plain physical digit shortcuts when an input is focused', () => {
    const registry = useShortcutRegistry()
    const handler = vi.fn()

    registry.register('1', handler)
    mockIsInputFocused.mockReturnValueOnce(true)

    const event = new KeyboardEvent('keydown', {
      key: '&',
      code: 'Digit1',
    })

    registry.handleKeydown(event)
    expect(handler).not.toHaveBeenCalled()
  })

  it('matches non-letter physical-key shortcuts such as Cmd+[ across keyboard layouts', () => {
    const registry = useShortcutRegistry()
    const handler = vi.fn()

    registry.register('⌘[', handler)

    const event = new KeyboardEvent('keydown', {
      key: 'å',
      code: 'BracketLeft',
      metaKey: true,
    })

    registry.handleKeydown(event)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('matches shifted non-letter physical-key shortcuts such as Shift+Slash', () => {
    const registry = useShortcutRegistry()
    const handler = vi.fn()

    registry.register('⇧/', handler)

    const event = new KeyboardEvent('keydown', {
      key: '?',
      code: 'Slash',
      shiftKey: true,
    })

    registry.handleKeydown(event)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not match letter shortcuts by physical code', () => {
    const registry = useShortcutRegistry()
    const handler = vi.fn()

    registry.register('⌘q', handler)

    const event = new KeyboardEvent('keydown', {
      key: 'a',
      code: 'KeyQ',
      metaKey: true,
    })

    registry.handleKeydown(event)
    expect(handler).not.toHaveBeenCalled()
  })
})
