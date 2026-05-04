import { getCurrentWindow } from '@tauri-apps/api/window'
import type { OpenForgeDesktopBridge, DesktopUnlistenFn } from './desktopIpc'

export interface DesktopCloseRequestEvent {
  preventDefault(): void
}

export interface DesktopWindowTarget {
  onCloseRequested(handler: (event: DesktopCloseRequestEvent) => void | Promise<void>): Promise<DesktopUnlistenFn>
  destroy(): Promise<void>
}

interface TauriWindowTarget {
  onCloseRequested(handler: (event: DesktopCloseRequestEvent) => void | Promise<void>): Promise<DesktopUnlistenFn>
  destroy(): Promise<void>
}

export interface CreateDesktopWindowDeps {
  electronBridge?: OpenForgeDesktopBridge | null
  close?: () => void
  getCurrentWindow?: () => TauriWindowTarget
}

function currentElectronBridge(): OpenForgeDesktopBridge | null {
  if (typeof window === 'undefined') return null
  return window.openforge ?? null
}

export function createDesktopWindow(deps: CreateDesktopWindowDeps = {}): DesktopWindowTarget {
  const bridge = deps.electronBridge ?? currentElectronBridge()
  const close = deps.close ?? (() => window.close())
  const getWindow = deps.getCurrentWindow ?? getCurrentWindow

  if (bridge) {
    return {
      async onCloseRequested() {
        return () => undefined
      },
      async destroy() {
        close()
      },
    }
  }

  const tauriWindow = getWindow()
  return {
    onCloseRequested: (handler) => tauriWindow.onCloseRequested(handler),
    destroy: () => tauriWindow.destroy(),
  }
}
