import { describe, expect, it, vi } from 'vitest'
import { OPENFORGE_EVENT_CHANNEL } from './preloadApi'
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

describe('Electron app event forwarding', () => {
  it('parses SSE data frames into openforge event envelopes', () => {
    expect(parseSseMessages('event: openforge-event\ndata: {"eventName":"pty-output-T-1","payload":{"data":"hi","instance_id":7}}\n\n')).toEqual([
      { eventName: 'pty-output-T-1', payload: { data: 'hi', instance_id: 7 } },
    ])
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
})
