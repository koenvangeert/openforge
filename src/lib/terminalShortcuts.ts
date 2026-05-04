export interface TerminalShortcutController {
  addTab(): void
  closeActiveTab(): Promise<void>
  focusActiveTab(): void
  switchToTab(tabPosition: number): void
}

const shiftedDigitKeyMap = new Map<string, number>([
  ['!', 1],
  ['@', 2],
  ['#', 3],
  ['$', 4],
  ['%', 5],
  ['^', 6],
  ['&', 7],
  ['*', 8],
  ['(', 9],
])

function getShortcutDigit(event: KeyboardEvent): number | null {
  const codeMatch = event.code.match(/^(?:Digit|Numpad)([1-9])$/)
  if (codeMatch) return Number(codeMatch[1])

  if (/^[1-9]$/.test(event.key)) return Number(event.key)

  return shiftedDigitKeyMap.get(event.key) ?? null
}

export function handleTerminalShortcutKeydown(event: KeyboardEvent, controller: TerminalShortcutController): boolean {
  if (!event.metaKey || event.ctrlKey || event.altKey) return false

  if (event.shiftKey) {
    const digit = getShortcutDigit(event)
    if (digit === null) return false

    event.preventDefault()
    event.stopPropagation()
    controller.switchToTab(digit - 1)
    return true
  }

  const key = event.key.toLowerCase()
  if (key === 't') {
    event.preventDefault()
    event.stopPropagation()
    controller.addTab()
    return true
  }

  if (key === 'e') {
    event.preventDefault()
    event.stopPropagation()
    controller.focusActiveTab()
    return true
  }

  if (key === 'w') {
    event.preventDefault()
    event.stopPropagation()
    void controller.closeActiveTab()
    return true
  }

  return false
}
