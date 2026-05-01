import { handleTerminalShortcutKeydown, type TerminalShortcutController } from './terminalShortcuts'

export interface TerminalTabsShortcutTarget {
  addTab(): void
  closeActiveTab(): Promise<void>
  focusActiveTab(): void
  switchToTab(tabIndex: number): void
}

export interface TerminalShortcutControllerOptions {
  ignoreWhenDetached?: boolean
}

export interface TerminalShortcutKeydownTarget {
  addEventListener(type: 'keydown', listener: EventListener, options?: AddEventListenerOptions): void
  removeEventListener(type: 'keydown', listener: EventListener, options?: AddEventListenerOptions): void
}

export interface TerminalShortcutControllerWiring {
  terminalTabsRef: TerminalTabsShortcutTarget | null
  controller: TerminalShortcutController
  handleWindowKeydown(event: KeyboardEvent): boolean
  registerWindowKeydown(target?: TerminalShortcutKeydownTarget): () => void
}

export function createTerminalShortcutController(
  options: TerminalShortcutControllerOptions = {},
): TerminalShortcutControllerWiring {
  let terminalTabsRef: TerminalTabsShortcutTarget | null = null

  const controller: TerminalShortcutController = {
    addTab() {
      terminalTabsRef?.addTab()
    },
    async closeActiveTab() {
      await terminalTabsRef?.closeActiveTab()
    },
    focusActiveTab() {
      terminalTabsRef?.focusActiveTab()
    },
    switchToTab(tabIndex: number) {
      terminalTabsRef?.switchToTab(tabIndex)
    },
  }

  function handleWindowKeydown(event: KeyboardEvent): boolean {
    if (options.ignoreWhenDetached === true && terminalTabsRef === null) return false

    return handleTerminalShortcutKeydown(event, controller)
  }

  function registerWindowKeydown(target: TerminalShortcutKeydownTarget = window): () => void {
    const listener: EventListener = (event) => {
      if (event instanceof KeyboardEvent) {
        handleWindowKeydown(event)
      }
    }
    const listenerOptions = { capture: true }

    target.addEventListener('keydown', listener, listenerOptions)

    return () => {
      target.removeEventListener('keydown', listener, listenerOptions)
    }
  }

  return {
    get terminalTabsRef() {
      return terminalTabsRef
    },
    set terminalTabsRef(value: TerminalTabsShortcutTarget | null) {
      terminalTabsRef = value
    },
    controller,
    handleWindowKeydown,
    registerWindowKeydown,
  }
}
