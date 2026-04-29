import { describe, expect, it, vi } from 'vitest'
import type { ShortcutRegistry } from './shortcuts.svelte'
import { registerAppShortcuts } from './appShortcuts'

function createRegistry() {
  const handlers = new Map<string, (event?: KeyboardEvent) => void>()
  const registry: ShortcutRegistry = {
    register: vi.fn((key: string, handler: (event?: KeyboardEvent) => void) => {
      handlers.set(key.toLowerCase(), handler)
    }),
    unregister: vi.fn(),
    handleKeydown: vi.fn(),
  }
  return { registry, handlers }
}

describe('registerAppShortcuts', () => {
  it('registers global shell shortcuts with their actions', () => {
    const { registry, handlers } = createRegistry()
    const showShortcuts = vi.fn()
    const openActionPalette = vi.fn()
    const toggleProjectSwitcher = vi.fn()
    const toggleSidebar = vi.fn()
    const openNewTaskDialog = vi.fn()
    const goBack = vi.fn()
    const toggleVoiceRecording = vi.fn()
    const toggleCommandPalette = vi.fn()
    const toggleFileQuickOpen = vi.fn()
    const resetToBoard = vi.fn()
    const navigateToSettings = vi.fn()
    const cycleActiveProject = vi.fn()

    registerAppShortcuts(registry, {
      showShortcuts,
      openActionPalette,
      toggleProjectSwitcher,
      toggleSidebar,
      openNewTaskDialog,
      goBack,
      toggleVoiceRecording,
      toggleCommandPalette,
      toggleFileQuickOpen,
      canToggleFileQuickOpen: () => true,
      resetToBoard,
      navigateToSettings,
      cycleActiveProject,
    })

    handlers.get('?')?.()
    handlers.get('⌘k')?.()
    handlers.get('⌘⇧p')?.()
    handlers.get('⌘b')?.()
    handlers.get('⌘n')?.()
    handlers.get('⌘[')?.()
    handlers.get('⌘d')?.()
    handlers.get('⌘⇧f')?.()
    handlers.get('⌘⇧o')?.()
    handlers.get('⌘h')?.()
    handlers.get('⌘,')?.()
    handlers.get('⌃n')?.()
    handlers.get('⌃p')?.()
    handlers.get('1')?.()
    handlers.get('2')?.()

    expect(showShortcuts).toHaveBeenCalledOnce()
    expect(openActionPalette).toHaveBeenCalledOnce()
    expect(toggleProjectSwitcher).toHaveBeenCalledOnce()
    expect(toggleSidebar).toHaveBeenCalledOnce()
    expect(openNewTaskDialog).toHaveBeenCalledOnce()
    expect(goBack).toHaveBeenCalledOnce()
    expect(toggleVoiceRecording).toHaveBeenCalledOnce()
    expect(toggleCommandPalette).toHaveBeenCalledOnce()
    expect(toggleFileQuickOpen).toHaveBeenCalledOnce()
    expect(resetToBoard).toHaveBeenCalledOnce()
    expect(navigateToSettings).toHaveBeenCalledOnce()
    expect(cycleActiveProject).toHaveBeenNthCalledWith(1, 'next', { boardOnly: true })
    expect(cycleActiveProject).toHaveBeenNthCalledWith(2, 'previous', { boardOnly: true })
    expect(cycleActiveProject).toHaveBeenNthCalledWith(3, 'previous')
    expect(cycleActiveProject).toHaveBeenNthCalledWith(4, 'next')
  })

  it('does not toggle file quick open while modal state blocks it', () => {
    const { registry, handlers } = createRegistry()
    const toggleFileQuickOpen = vi.fn()

    registerAppShortcuts(registry, {
      showShortcuts: vi.fn(),
      openActionPalette: vi.fn(),
      toggleProjectSwitcher: vi.fn(),
      toggleSidebar: vi.fn(),
      openNewTaskDialog: vi.fn(),
      goBack: vi.fn(),
      toggleVoiceRecording: vi.fn(),
      toggleCommandPalette: vi.fn(),
      toggleFileQuickOpen,
      canToggleFileQuickOpen: () => false,
      resetToBoard: vi.fn(),
      navigateToSettings: vi.fn(),
      cycleActiveProject: vi.fn(),
    })

    handlers.get('⌘⇧o')?.()
    handlers.get('⌃⇧o')?.()

    expect(toggleFileQuickOpen).not.toHaveBeenCalled()
  })
})
