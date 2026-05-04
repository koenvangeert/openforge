import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'

export type DesktopUnlistenFn = () => void

export interface DesktopEvent<T> {
  event: string
  payload: T
}

export interface OpenForgeDesktopBridge {
  readonly version: 1
  invoke(command: string, payload?: unknown): Promise<unknown>
  onEvent(eventName: string, handler: (payload: unknown) => void): DesktopUnlistenFn
}

declare global {
  interface Window {
    openforge?: OpenForgeDesktopBridge
  }
}

function electronBridge(): OpenForgeDesktopBridge | null {
  if (typeof window === 'undefined') return null
  return window.openforge ?? null
}

export function isElectronDesktopBridgeAvailable(): boolean {
  return electronBridge() !== null
}

export async function invokeDesktopCommand<T>(command: string): Promise<T>
export async function invokeDesktopCommand<T>(command: string, payload: unknown): Promise<T>
export async function invokeDesktopCommand<T>(command: string, payload?: unknown): Promise<T> {
  const bridge = electronBridge()
  if (bridge) {
    return bridge.invoke(command, payload ?? null) as Promise<T>
  }

  if (payload === undefined) {
    return tauriInvoke<T>(command)
  }
  return tauriInvoke<T>(command, payload as Parameters<typeof tauriInvoke<T>>[1])
}

export async function listenDesktopEvent<T>(
  eventName: string,
  handler: (event: DesktopEvent<T>) => void | Promise<void>,
): Promise<DesktopUnlistenFn> {
  const bridge = electronBridge()
  if (!bridge) {
    return tauriListen<T>(eventName, handler as Parameters<typeof tauriListen<T>>[1])
  }

  const unsubscribe = bridge.onEvent(eventName, (payload) => {
    void handler({ event: eventName, payload: payload as T })
  })

  return () => unsubscribe()
}

export {}
