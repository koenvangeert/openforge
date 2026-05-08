import type { OpenForgeDesktopBridge, DesktopUnlistenFn } from './desktopIpc'
import { quitApp as defaultQuitApp } from './ipc'

export interface DesktopCloseRequestEvent {
  preventDefault(): void
}

export interface DesktopWindowTarget {
  onCloseRequested(handler: (event: DesktopCloseRequestEvent) => void | Promise<void>): Promise<DesktopUnlistenFn>
  destroy(): Promise<void>
}

export interface CreateDesktopWindowDeps {
  electronBridge?: OpenForgeDesktopBridge | null
  quitApp?: () => void | Promise<void>
}

function currentElectronBridge(): OpenForgeDesktopBridge | null {
  if (typeof window === 'undefined') return null
  return window.openforge ?? null
}

export function createDesktopWindow(deps: CreateDesktopWindowDeps = {}): DesktopWindowTarget {
  const bridge = deps.electronBridge ?? currentElectronBridge()
  const requestQuit = deps.quitApp ?? defaultQuitApp

  if (!bridge) {
    throw new Error('Open Forge desktop window controls are unavailable; run the app in the Electron shell')
  }

  let isDestroying = false

  return {
    async onCloseRequested(handler) {
      const listener = (event: BeforeUnloadEvent) => {
        if (isDestroying) return

        handler({
          preventDefault() {
            event.preventDefault()
            event.returnValue = ''
          },
        })
      }
      window.addEventListener('beforeunload', listener)
      return () => window.removeEventListener('beforeunload', listener)
    },
    async destroy() {
      isDestroying = true
      await requestQuit()
    },
  }
}
