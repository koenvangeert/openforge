import type { ShortcutRegistry } from './shortcuts.svelte'

export interface AppShortcutHandlers {
  showShortcuts(): void
  openActionPalette(): void | Promise<void>
  toggleProjectSwitcher(): void
  toggleSidebar(): void
  openNewTaskDialog(): void
  goBack(): void
  toggleVoiceRecording(): void
  toggleCommandPalette(): void
  toggleFileQuickOpen(): void
  canToggleFileQuickOpen(): boolean
  resetToBoard(): void
  navigateToSettings(): void
  cycleActiveProject(direction: 'previous' | 'next', options?: { boardOnly?: boolean }): void
}

export function registerAppShortcuts(shortcuts: ShortcutRegistry, handlers: AppShortcutHandlers): void {
  shortcuts.register('?', () => {
    handlers.showShortcuts()
  })

  shortcuts.register('⌘k', () => {
    void handlers.openActionPalette()
  })

  shortcuts.register('⌘⇧p', () => {
    handlers.toggleProjectSwitcher()
  })

  shortcuts.register('⌘b', () => {
    handlers.toggleSidebar()
  })

  shortcuts.register('⌘n', () => {
    handlers.openNewTaskDialog()
  })

  shortcuts.register('⌘[', () => { handlers.goBack() })
  shortcuts.register('⌘arrowleft', () => { handlers.goBack() })
  shortcuts.register('⌃[', () => { handlers.goBack() })
  shortcuts.register('⌃arrowleft', () => { handlers.goBack() })

  shortcuts.register('⌘d', () => {
    handlers.toggleVoiceRecording()
  })
  shortcuts.register('⌃d', () => {
    handlers.toggleVoiceRecording()
  })

  shortcuts.register('⌘⇧f', () => {
    handlers.toggleCommandPalette()
  })

  const toggleFileQuickOpen = () => {
    if (!handlers.canToggleFileQuickOpen()) return
    handlers.toggleFileQuickOpen()
  }
  shortcuts.register('⌘⇧o', toggleFileQuickOpen)
  shortcuts.register('⌃⇧o', toggleFileQuickOpen)

  shortcuts.register('⌘h', () => {
    handlers.resetToBoard()
  })

  shortcuts.register('⌘,', () => {
    handlers.navigateToSettings()
  })

  shortcuts.register('⌃n', () => {
    handlers.cycleActiveProject('next', { boardOnly: true })
  })

  shortcuts.register('⌃p', () => {
    handlers.cycleActiveProject('previous', { boardOnly: true })
  })

  shortcuts.register('1', () => {
    handlers.cycleActiveProject('previous')
  })

  shortcuts.register('2', () => {
    handlers.cycleActiveProject('next')
  })
}
