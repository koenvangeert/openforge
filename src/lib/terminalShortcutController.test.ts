import { describe, expect, it, vi } from 'vitest'
import {
  createTerminalShortcutController,
  type TerminalTabsShortcutTarget,
} from './terminalShortcutController'

function makeTerminalTabsTarget(): TerminalTabsShortcutTarget {
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

describe('terminal shortcut controller wiring', () => {
  it('forwards shortcut controller actions to the current TerminalTabs ref', async () => {
    const shortcuts = createTerminalShortcutController()
    const firstTarget = makeTerminalTabsTarget()
    const latestTarget = makeTerminalTabsTarget()

    shortcuts.terminalTabsRef = firstTarget

    shortcuts.controller.addTab()
    await shortcuts.controller.closeActiveTab()
    shortcuts.controller.focusActiveTab()
    shortcuts.controller.switchToTab(2)

    expect(firstTarget.addTab).toHaveBeenCalledTimes(1)
    expect(firstTarget.closeActiveTab).toHaveBeenCalledTimes(1)
    expect(firstTarget.focusActiveTab).toHaveBeenCalledTimes(1)
    expect(firstTarget.switchToTab).toHaveBeenCalledWith(2)

    shortcuts.terminalTabsRef = latestTarget

    shortcuts.controller.addTab()
    shortcuts.controller.switchToTab(0)

    expect(firstTarget.addTab).toHaveBeenCalledTimes(1)
    expect(firstTarget.switchToTab).toHaveBeenCalledTimes(1)
    expect(latestTarget.addTab).toHaveBeenCalledTimes(1)
    expect(latestTarget.switchToTab).toHaveBeenCalledWith(0)
  })

  it('consumes matching shortcuts safely when no terminal ref is attached by default', async () => {
    const shortcuts = createTerminalShortcutController()
    const event = makeKeyEvent({ key: 't', code: 'KeyT', metaKey: true })

    expect(shortcuts.handleWindowKeydown(event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    await expect(shortcuts.controller.closeActiveTab()).resolves.toBeUndefined()
  })

  it('ignores matching shortcuts without preventing default when configured to ignore detached refs', () => {
    const shortcuts = createTerminalShortcutController({ ignoreWhenDetached: true })
    const event = makeKeyEvent({ key: 't', code: 'KeyT', metaKey: true })

    expect(shortcuts.handleWindowKeydown(event)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
  })

  it('registers and removes a capture-phase window keydown listener with the same listener and options', () => {
    const shortcuts = createTerminalShortcutController()
    const target = new EventTarget()
    const terminalTabs = makeTerminalTabsTarget()
    const addEventListener = vi.spyOn(target, 'addEventListener')
    const removeEventListener = vi.spyOn(target, 'removeEventListener')
    shortcuts.terminalTabsRef = terminalTabs

    const cleanup = shortcuts.registerWindowKeydown(target)

    expect(addEventListener).toHaveBeenCalledTimes(1)
    const [eventName, listener, options] = addEventListener.mock.calls[0]
    expect(eventName).toBe('keydown')
    expect(options).toEqual({ capture: true })

    target.dispatchEvent(makeKeyEvent({ key: 't', code: 'KeyT', metaKey: true }))
    expect(terminalTabs.addTab).toHaveBeenCalledTimes(1)

    cleanup()

    expect(removeEventListener).toHaveBeenCalledTimes(1)
    expect(removeEventListener).toHaveBeenCalledWith('keydown', listener, options)

    target.dispatchEvent(makeKeyEvent({ key: 't', code: 'KeyT', metaKey: true }))
    expect(terminalTabs.addTab).toHaveBeenCalledTimes(1)
  })
})
