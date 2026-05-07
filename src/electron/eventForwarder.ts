import { OPENFORGE_APP_EVENTS_RECONNECTED_EVENT, OPENFORGE_EVENT_CHANNEL } from './preloadApi.js'
import type { SidecarLaunchConfig } from './sidecar.js'

export interface OpenForgeEventEnvelope {
  id?: string
  eventName: string
  payload: unknown
}

export interface WebContentsLike {
  send(channel: string, payload: unknown): void
}

export interface BrowserWindowLike {
  webContents: WebContentsLike
}

export interface AppEventFetchResponse {
  ok: boolean
  body: ReadableStream<Uint8Array> | null
  text(): Promise<string>
}

export type AppEventFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<AppEventFetchResponse>

export interface AppEventForwarderDeps {
  sidecarConfig: SidecarLaunchConfig
  fetch: AppEventFetch
  windows: () => readonly BrowserWindowLike[]
  sleep?: (ms: number) => Promise<void>
  reconnectDelayMs?: number
  onEvent?: (envelope: OpenForgeEventEnvelope) => void
}

export interface AppEventForwarder {
  start(): Promise<void>
  ready(): Promise<void>
  stop(): void
  acceptChunk(chunk: string): void
}

const DEFAULT_RECONNECT_DELAY_MS = 1_000

function isEnvelope(value: unknown): value is OpenForgeEventEnvelope {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { eventName?: unknown }).eventName === 'string'
    && 'payload' in value
}

export function parseSseMessages(chunk: string): OpenForgeEventEnvelope[] {
  const envelopes: OpenForgeEventEnvelope[] = []
  const frames = chunk.split(/\r?\n\r?\n/)

  for (const frame of frames) {
    const dataLines = frame
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice('data:'.length).trimStart())

    if (dataLines.length === 0) continue

    try {
      const parsed = JSON.parse(dataLines.join('\n'))
      if (isEnvelope(parsed)) {
        const idLine = frame
          .split(/\r?\n/)
          .find(line => line.startsWith('id:'))
        const id = idLine?.slice('id:'.length).trimStart()
        envelopes.push(id ? { ...parsed, id } : parsed)
      }
    } catch {
      // Ignore malformed frames; the stream remains alive for later valid events.
    }
  }

  return envelopes
}

export function createAppEventForwarder(deps: AppEventForwarderDeps): AppEventForwarder {
  const abortController = new AbortController()
  const decoder = new TextDecoder()
  let buffer = ''
  let lastEventId: string | null = null
  let readySettled = false
  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  function markReady(): void {
    if (readySettled) return
    readySettled = true
    resolveReady()
  }

  function failReady(error: unknown): void {
    if (readySettled) return
    readySettled = true
    rejectReady(error)
  }

  function isIntentionalAbort(error: unknown): boolean {
    return abortController.signal.aborted
      && typeof error === 'object'
      && error !== null
      && (error as { name?: unknown }).name === 'AbortError'
  }

  function forward(envelope: OpenForgeEventEnvelope): void {
    if (typeof envelope.id === 'string' && envelope.id.length > 0) {
      lastEventId = envelope.id
    }
    deps.onEvent?.(envelope)
    for (const window of deps.windows()) {
      window.webContents.send(OPENFORGE_EVENT_CHANNEL, envelope)
    }
  }

  function lastCompleteFrameBoundaryEnd(text: string): number {
    let boundaryEnd = -1
    const boundaryPattern = /\r?\n\r?\n/g
    let match: RegExpExecArray | null = null
    while ((match = boundaryPattern.exec(text)) !== null) {
      boundaryEnd = match.index + match[0].length
    }
    return boundaryEnd
  }

  function acceptChunk(chunk: string): void {
    buffer += chunk
    const boundaryEnd = lastCompleteFrameBoundaryEnd(buffer)
    if (boundaryEnd === -1) return

    const complete = buffer.slice(0, boundaryEnd)
    buffer = buffer.slice(boundaryEnd)
    for (const envelope of parseSseMessages(complete)) {
      forward(envelope)
    }
  }

  function forwardReconnectNotice(attempt: number): void {
    forward({
      eventName: OPENFORGE_APP_EVENTS_RECONNECTED_EVENT,
      payload: {
        attempt,
        reconnectedAt: new Date().toISOString(),
      },
    })
  }

  async function readEventStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    try {
      while (!abortController.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) acceptChunk(decoder.decode(value, { stream: true }))
      }
    } finally {
      reader.releaseLock()
    }
  }

  async function waitBeforeReconnect(): Promise<void> {
    const delay = deps.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS
    await (deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))))(delay)
  }

  async function start(): Promise<void> {
    let hasConnected = false
    let reconnectAttempt = 0

    while (!abortController.signal.aborted) {
      try {
        const headers: Record<string, string> = { Authorization: `Bearer ${deps.sidecarConfig.token}` }
        if (lastEventId) headers['Last-Event-ID'] = lastEventId

        const response = await deps.fetch(`http://${deps.sidecarConfig.host}:${deps.sidecarConfig.port}/app/events`, {
          headers,
          signal: abortController.signal,
        })

        if (!response.ok) {
          const detail = await response.text()
          throw new Error(`failed to connect to Rust app event stream: ${detail}`)
        }

        const isReconnect = hasConnected
        hasConnected = true
        markReady()

        if (isReconnect) {
          reconnectAttempt += 1
          forwardReconnectNotice(reconnectAttempt)
        }

        if (!response.body) return

        await readEventStream(response.body)
      } catch (error) {
        if (isIntentionalAbort(error)) {
          markReady()
          return
        }

        if (!readySettled) {
          failReady(error)
          throw error
        }

        console.error('[electron] Rust app event stream disconnected; reconnecting:', error)
      }

      if (!abortController.signal.aborted) {
        await waitBeforeReconnect()
      }
    }
  }

  return {
    start,
    ready(): Promise<void> {
      return readyPromise
    },
    stop(): void {
      abortController.abort()
    },
    acceptChunk,
  }
}
