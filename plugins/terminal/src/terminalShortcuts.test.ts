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
  it('handles Cmd+T inside the terminal plugin', () => {
    const controller = makeController()
    const event = makeKeyEvent({ key: 't', code: 'KeyT', metaKey: true })

    expect(handleTerminalShortcutKeydown(event, controller)).toBe(true)

    expect(controller.addTab).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('handles Cmd+Shift+digit as shell tab switching', () => {
    const controller = makeController()
    const event = makeKeyEvent({ key: '#', code: 'Digit3', metaKey: true, shiftKey: true })

    expect(handleTerminalShortcutKeydown(event, controller)).toBe(true)

    expect(controller.switchToTab).toHaveBeenCalledWith(2)
    expect(event.defaultPrevented).toBe(true)
  })

  it('ignores Cmd+digit so app-level view shortcuts can handle it', () => {
    const controller = makeController()
    const event = makeKeyEvent({ key: '3', code: 'Digit3', metaKey: true })

    expect(handleTerminalShortcutKeydown(event, controller)).toBe(false)

    expect(controller.switchToTab).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('ignores non-terminal shortcuts', () => {
    const controller = makeController()
    const event = makeKeyEvent({ key: 'n', code: 'KeyN', metaKey: true })

    expect(handleTerminalShortcutKeydown(event, controller)).toBe(false)

    expect(controller.addTab).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})
