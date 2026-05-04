export const OPENFORGE_INVOKE_CHANNEL = 'openforge:invoke'
export const OPENFORGE_EVENT_CHANNEL = 'openforge:event'

export interface PreloadIpcRenderer {
  invoke(channel: string, payload: unknown): Promise<unknown>
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void
  off(channel: string, listener: (event: unknown, payload: unknown) => void): void
}

export interface OpenForgePreloadApi {
  readonly version: 1
  invoke(command: string, payload?: unknown): Promise<unknown>
  onEvent(eventName: string, handler: (payload: unknown) => void): () => void
}

function isEventEnvelope(value: unknown): value is { eventName: string; payload: unknown } {
  return typeof value === 'object'
    && value !== null
    && 'eventName' in value
    && typeof (value as { eventName: unknown }).eventName === 'string'
    && 'payload' in value
}

export function createOpenForgePreloadApi(ipcRenderer: PreloadIpcRenderer): OpenForgePreloadApi {
  return Object.freeze({
    version: 1 as const,
    invoke(command: string, payload: unknown = null): Promise<unknown> {
      return ipcRenderer.invoke(OPENFORGE_INVOKE_CHANNEL, { command, payload })
    },
    onEvent(eventName: string, handler: (payload: unknown) => void): () => void {
      const listener = (_event: unknown, envelope: unknown): void => {
        if (!isEventEnvelope(envelope) || envelope.eventName !== eventName) return
        handler(envelope.payload)
      }

      ipcRenderer.on(OPENFORGE_EVENT_CHANNEL, listener)
      return () => ipcRenderer.off(OPENFORGE_EVENT_CHANNEL, listener)
    },
  })
}
