export interface TerminalShortcutController {
  addTab(): void
  closeActiveTab(): Promise<void>
  focusActiveTab(): void
  switchToTab(tabIndex: number): void
}

export function handleTerminalShortcutKeydown(event: KeyboardEvent, controller: TerminalShortcutController): boolean {
  if (!event.metaKey || event.ctrlKey || event.altKey) return false

  if (event.shiftKey) {
    const match = event.code.match(/^Digit([1-9])$/)
    if (!match) return false

    event.preventDefault()
    event.stopPropagation()
    controller.switchToTab(Number(match[1]) - 1)
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
