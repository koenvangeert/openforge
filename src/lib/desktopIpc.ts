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

function requireElectronBridge(): OpenForgeDesktopBridge {
  const bridge = electronBridge()
  if (!bridge) {
    throw new Error('Open Forge desktop bridge is unavailable; run the app in the Electron shell')
  }
  return bridge
}

export function isElectronDesktopBridgeAvailable(): boolean {
  return electronBridge() !== null
}

export async function invokeDesktopCommand<T>(command: string): Promise<T>
export async function invokeDesktopCommand<T>(command: string, payload: unknown): Promise<T>
export async function invokeDesktopCommand<T>(command: string, payload?: unknown): Promise<T> {
  return requireElectronBridge().invoke(command, payload ?? null) as Promise<T>
}

export async function listenDesktopEvent<T>(
  eventName: string,
  handler: (event: DesktopEvent<T>) => void | Promise<void>,
): Promise<DesktopUnlistenFn> {
  const unsubscribe = requireElectronBridge().onEvent(eventName, (payload) => {
    void handler({ event: eventName, payload: payload as T })
  })

  return () => unsubscribe()
}

export {}
