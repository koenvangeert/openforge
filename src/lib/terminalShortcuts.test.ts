import { describe, expect, it, vi } from 'vitest'
import { handleTerminalShortcutKeydown, type TerminalShortcutController } from './terminalShortcuts'

function makeController(): TerminalShortcutController {
  return {
    addTab: vi.fn(),
    closeActiveTab: vi.fn().mockResolvedValue(undefined),
    focusActiveTab: vi.fn(),
    switchToTab: vi.fn(),
  }
}

function makeKeyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
}

describe('terminal shortcuts', () => {
  it('maps Cmd+number to visible tab position without using Shift-reserved macOS shortcuts', () => {
    const controller = makeController()
    const event = makeKeyEvent({ key: '3', code: 'Digit3', metaKey: true })

    expect(handleTerminalShortcutKeydown(event, controller)).toBe(true)

    expect(event.defaultPrevented).toBe(true)
    expect(controller.switchToTab).toHaveBeenCalledWith(2)
  })

  it.each([
    ['#', 2],
    ['$', 3],
    ['%', 4],
    ['^', 5],
    ['&', 6],
    ['*', 7],
    ['(', 8],
  ])('maps Cmd+Shift+%s shifted digit key to visible tab position %i', (key, expectedIndex) => {
    const controller = makeController()
    const event = makeKeyEvent({ key, code: '', metaKey: true, shiftKey: true })

    expect(handleTerminalShortcutKeydown(event, controller)).toBe(true)

    expect(event.defaultPrevented).toBe(true)
    expect(controller.switchToTab).toHaveBeenCalledWith(expectedIndex)
  })
})
