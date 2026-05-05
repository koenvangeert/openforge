import { describe, expect, it, vi } from 'vitest'
import { OPENFORGE_APP_EVENTS_RECONNECTED_EVENT, OPENFORGE_EVENT_CHANNEL } from './preloadApi'
import { createAppEventForwarder, parseSseMessages } from './eventForwarder'
import type { SidecarLaunchConfig } from './sidecar'

function sidecarConfig(): SidecarLaunchConfig {
  return {
    command: 'openforge-sidecar',
    args: [],
    env: {},
    host: '127.0.0.1',
    port: 17642,
    token: 'launch-token',
    healthUrl: 'http://127.0.0.1:17642/app/health',
  }
}

function eventStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function failingStream(error: Error): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(error)
    },
  })
}

describe('Electron app event forwarding', () => {
  it('parses SSE data frames into openforge event envelopes', () => {
    expect(parseSseMessages('event: openforge-event\ndata: {"eventName":"pty-output-T-1","payload":{"data":"hi","instance_id":7}}\n\n')).toEqual([
      { eventName: 'pty-output-T-1', payload: { data: 'hi', instance_id: 7 } },
    ])
  })

  it('parses CRLF-delimited SSE frames when accepting streamed chunks', () => {
    const send = vi.fn()
    const forwarder = createAppEventForwarder({
      sidecarConfig: sidecarConfig(),
      fetch: vi.fn(),
      windows: () => [{ webContents: { send } }],
    })

    forwarder.acceptChunk('event: openforge-event\r\ndata: {"eventName":"pty-output-T-1","payload":{"data":"hi","instance_id":7}}\r\n\r\n')

    expect(send).toHaveBeenCalledWith(OPENFORGE_EVENT_CHANNEL, {
      eventName: 'pty-output-T-1',
      payload: { data: 'hi', instance_id: 7 },
    })
  })

  it('forwards Rust app events to renderer openforge:event envelopes', () => {
    const send = vi.fn()
    const forwarder = createAppEventForwarder({
      sidecarConfig: sidecarConfig(),
      fetch: vi.fn(),
      windows: () => [{ webContents: { send } }],
    })

    forwarder.acceptChunk('event: openforge-event\ndata: {"eventName":"pty-exit-T-1-shell-2","payload":{"instance_id":42}}\n\n')

    expect(send).toHaveBeenCalledWith(OPENFORGE_EVENT_CHANNEL, {
      eventName: 'pty-exit-T-1-shell-2',
      payload: { instance_id: 42 },
    })
  })

  it('marks the event stream ready after the authenticated SSE connection opens', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      body: null,
      text: async () => '',
    }))
    const forwarder = createAppEventForwarder({
      sidecarConfig: sidecarConfig(),
      fetch,
      windows: () => [],
    })

    await forwarder.start()
    await expect(forwarder.ready()).resolves.toBeUndefined()
  })

  it('connects to authenticated Rust app events stream without exposing HTTP to renderer', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      body: null,
      text: async () => '',
    }))
    const forwarder = createAppEventForwarder({
      sidecarConfig: sidecarConfig(),
      fetch,
      windows: () => [],
    })

    await forwarder.start()

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/events', {
      headers: { Authorization: 'Bearer launch-token' },
      signal: expect.any(AbortSignal),
    })
    forwarder.stop()
  })

  it('reconnects after an idle stream ends and forwards later PTY events', async () => {
    const send = vi.fn()
    let forwarder: ReturnType<typeof createAppEventForwarder>
    const sleep = vi.fn(async () => {
      if (sleep.mock.calls.length >= 2) forwarder.stop()
    })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        body: eventStream([]),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        body: eventStream([
          'event: openforge-event\ndata: {"eventName":"pty-output-T-1","payload":{"data":"after reconnect","instance_id":8}}\n\n',
        ]),
        text: async () => '',
      })

    forwarder = createAppEventForwarder({
      sidecarConfig: sidecarConfig(),
      fetch,
      windows: () => [{ webContents: { send } }],
      sleep,
      reconnectDelayMs: 0,
    })

    await forwarder.start()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith(OPENFORGE_EVENT_CHANNEL, expect.objectContaining({
      eventName: OPENFORGE_APP_EVENTS_RECONNECTED_EVENT,
    }))
    expect(send).toHaveBeenCalledWith(OPENFORGE_EVENT_CHANNEL, {
      eventName: 'pty-output-T-1',
      payload: { data: 'after reconnect', instance_id: 8 },
    })
  })

  it('reconnects after a post-ready stream error and forwards later PTY events', async () => {
    const send = vi.fn()
    let forwarder: ReturnType<typeof createAppEventForwarder>
    const sleep = vi.fn(async () => {
      if (sleep.mock.calls.length >= 2) forwarder.stop()
    })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        body: failingStream(new Error('socket closed after idle')),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        body: eventStream([
          'event: openforge-event\ndata: {"eventName":"pty-output-T-2","payload":{"data":"recovered","instance_id":9}}\n\n',
        ]),
        text: async () => '',
      })

    forwarder = createAppEventForwarder({
      sidecarConfig: sidecarConfig(),
      fetch,
      windows: () => [{ webContents: { send } }],
      sleep,
      reconnectDelayMs: 0,
    })

    await forwarder.start()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith(OPENFORGE_EVENT_CHANNEL, {
      eventName: 'pty-output-T-2',
      payload: { data: 'recovered', instance_id: 9 },
    })
  })

  it('treats an intentional stop abort as a clean event stream shutdown', async () => {
    const releaseLock = vi.fn()
    const fetch = vi.fn(async (_url: string, init: { signal: AbortSignal }) => ({
      ok: true,
      body: {
        getReader: () => ({
          read: () => new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
            init.signal.addEventListener('abort', () => {
              reject(new DOMException('This operation was aborted', 'AbortError'))
            }, { once: true })
          }),
          releaseLock,
        }),
      } as unknown as ReadableStream<Uint8Array>,
      text: async () => '',
    }))
    const forwarder = createAppEventForwarder({
      sidecarConfig: sidecarConfig(),
      fetch,
      windows: () => [],
    })

    const run = forwarder.start()
    await expect(forwarder.ready()).resolves.toBeUndefined()

    forwarder.stop()

    await expect(run).resolves.toBeUndefined()
    await expect(forwarder.ready()).resolves.toBeUndefined()
    expect(releaseLock).toHaveBeenCalled()
  })
})
