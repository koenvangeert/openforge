import { OPENFORGE_EVENT_CHANNEL } from './preloadApi.js'
import type { SidecarLaunchConfig } from './sidecar.js'

export interface OpenForgeEventEnvelope {
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
}

export interface AppEventForwarder {
  start(): Promise<void>
  ready(): Promise<void>
  stop(): void
  acceptChunk(chunk: string): void
}

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
      if (isEnvelope(parsed)) envelopes.push(parsed)
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
  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  function forward(envelope: OpenForgeEventEnvelope): void {
    for (const window of deps.windows()) {
      window.webContents.send(OPENFORGE_EVENT_CHANNEL, envelope)
    }
  }

  function acceptChunk(chunk: string): void {
    buffer += chunk
    const lastBoundary = buffer.lastIndexOf('\n\n')
    if (lastBoundary === -1) return

    const complete = buffer.slice(0, lastBoundary + 2)
    buffer = buffer.slice(lastBoundary + 2)
    for (const envelope of parseSseMessages(complete)) {
      forward(envelope)
    }
  }

  async function start(): Promise<void> {
    try {
      const response = await deps.fetch(`http://${deps.sidecarConfig.host}:${deps.sidecarConfig.port}/app/events`, {
        headers: { Authorization: `Bearer ${deps.sidecarConfig.token}` },
        signal: abortController.signal,
      })

      if (!response.ok) {
        const detail = await response.text()
        throw new Error(`failed to connect to Rust app event stream: ${detail}`)
      }

      resolveReady()

      if (!response.body) return

      const reader = response.body.getReader()
      try {
        while (!abortController.signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) acceptChunk(decoder.decode(value, { stream: true }))
        }
      } finally {
        reader.releaseLock()
      }
    } catch (error) {
      rejectReady(error)
      throw error
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
