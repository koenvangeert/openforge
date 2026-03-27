import { isInputFocused } from './domUtils'

export interface ShortcutHandler {
  (e: KeyboardEvent): void
}

export interface ShortcutRegistry {
  register(key: string, handler: ShortcutHandler): void
  unregister(key: string): void
  handleKeydown(e: KeyboardEvent): void
}

export function useShortcutRegistry(): ShortcutRegistry {
  let shortcuts = $state<Map<string, ShortcutHandler>>(new Map())

  function isPlainKey(key: string): boolean {
    const plainKeys = new Set([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
      '?', '/', '.',
      'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
      'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    ])
    return plainKeys.has(key.toLowerCase())
  }

  function normalizeShortcutKey(key: string): string {
    return key.toLowerCase()
  }

  function parseShortcut(
    key: string,
    metaKey: boolean,
    shiftKey: boolean,
    ctrlKey: boolean,
    altKey: boolean
  ): string {
    let shortcutKey = ''
    if (metaKey) shortcutKey += '⌘'
    if (ctrlKey) shortcutKey += '⌃'
    if (altKey) shortcutKey += '⌥'
    if (shiftKey) shortcutKey += '⇧'
    shortcutKey += normalizeShortcutKey(key)
    return shortcutKey
  }

  function handleKeydown(e: KeyboardEvent): void {
    const { key, metaKey, shiftKey, ctrlKey, altKey } = e

    const hasModifier = metaKey || ctrlKey || altKey || shiftKey
    const isPlain = isPlainKey(key)

    if (isPlain && !hasModifier && isInputFocused()) {
      return
    }

    const shortcutKey = parseShortcut(key, metaKey, shiftKey, ctrlKey, altKey)
    const handler = shortcuts.get(shortcutKey)

    if (handler) {
      e.preventDefault()
      handler(e)
    }
  }

  function register(key: string, handler: ShortcutHandler): void {
    shortcuts.set(normalizeShortcutKey(key), handler)
  }

  function unregister(key: string): void {
    shortcuts.delete(normalizeShortcutKey(key))
  }

  return {
    register,
    unregister,
    handleKeydown,
  }
}
