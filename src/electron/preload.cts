const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

const OPENFORGE_INVOKE_CHANNEL = 'openforge:invoke'
const OPENFORGE_EVENT_CHANNEL = 'openforge:event'

interface EventEnvelope {
  eventName: string
  payload: unknown
}

function isEventEnvelope(value: unknown): value is EventEnvelope {
  return typeof value === 'object'
    && value !== null
    && 'eventName' in value
    && typeof (value as { eventName: unknown }).eventName === 'string'
    && 'payload' in value
}

const openForgeApi = Object.freeze({
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

contextBridge.exposeInMainWorld('openforge', openForgeApi)
