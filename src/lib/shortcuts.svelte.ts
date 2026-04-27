import { isInputFocused } from './domUtils'

export interface ShortcutHandler {
  (e: KeyboardEvent): void
}

export interface ShortcutRegistry {
  register(key: string, handler: ShortcutHandler): void
  unregister(key: string): void
  handleKeydown(e: KeyboardEvent): void
}

interface ShortcutCandidate {
  shortcutKey: string
  key: string
  hasModifier: boolean
}

const physicalShortcutKeysByCode = new Map<string, string>([
  ['Digit0', '0'],
  ['Digit1', '1'],
  ['Digit2', '2'],
  ['Digit3', '3'],
  ['Digit4', '4'],
  ['Digit5', '5'],
  ['Digit6', '6'],
  ['Digit7', '7'],
  ['Digit8', '8'],
  ['Digit9', '9'],
  ['Backquote', '`'],
  ['Minus', '-'],
  ['Equal', '='],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['Backslash', '\\'],
  ['Semicolon', ';'],
  ['Quote', "'"],
  ['Comma', ','],
  ['Period', '.'],
  ['Slash', '/'],
])

export function useShortcutRegistry(): ShortcutRegistry {
  let shortcuts = $state<Map<string, ShortcutHandler>>(new Map())

  function hasImplicitShift(key: string): boolean {
    return key.length === 1 && !/[a-z0-9]/i.test(key)
  }

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

  function buildShortcutCandidate(
    key: string,
    metaKey: boolean,
    includeShift: boolean,
    ctrlKey: boolean,
    altKey: boolean
  ): ShortcutCandidate {
    const normalizedKey = normalizeShortcutKey(key)
    let shortcutKey = ''
    if (metaKey) shortcutKey += '⌘'
    if (ctrlKey) shortcutKey += '⌃'
    if (altKey) shortcutKey += '⌥'
    if (includeShift) shortcutKey += '⇧'
    shortcutKey += normalizedKey
    return {
      shortcutKey,
      key: normalizedKey,
      hasModifier: metaKey || ctrlKey || altKey || includeShift,
    }
  }

  function parseShortcut(
    key: string,
    metaKey: boolean,
    shiftKey: boolean,
    ctrlKey: boolean,
    altKey: boolean
  ): ShortcutCandidate {
    return buildShortcutCandidate(key, metaKey, shiftKey && !hasImplicitShift(key), ctrlKey, altKey)
  }

  function parsePhysicalShortcut(e: KeyboardEvent): ShortcutCandidate | null {
    const key = physicalShortcutKeysByCode.get(e.code)
    if (!key) return null

    return buildShortcutCandidate(key, e.metaKey, e.shiftKey, e.ctrlKey, e.altKey)
  }

  function getShortcutCandidates(e: KeyboardEvent): ShortcutCandidate[] {
    const candidates = [parseShortcut(e.key, e.metaKey, e.shiftKey, e.ctrlKey, e.altKey)]
    const physicalCandidate = parsePhysicalShortcut(e)

    if (physicalCandidate && !candidates.some(candidate => candidate.shortcutKey === physicalCandidate.shortcutKey)) {
      candidates.push(physicalCandidate)
    }

    return candidates
  }

  function handleKeydown(e: KeyboardEvent): void {
    const candidates = getShortcutCandidates(e)
    const match = candidates
      .map(candidate => ({ candidate, handler: shortcuts.get(candidate.shortcutKey) }))
      .find((entry): entry is { candidate: ShortcutCandidate; handler: ShortcutHandler } => Boolean(entry.handler))

    if (!match) return

    if (isPlainKey(match.candidate.key) && !match.candidate.hasModifier && isInputFocused()) {
      return
    }

    e.preventDefault()
    match.handler(e)
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
